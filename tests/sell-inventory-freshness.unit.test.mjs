import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE,
  SELL_INVENTORY_FRESHNESS_CADENCE_DAYS,
  SELL_INVENTORY_FRESHNESS_CADENCE_MS,
  SELL_INVENTORY_FRESHNESS_ELIGIBLE_STATUSES,
  SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
  SELL_INVENTORY_FRESHNESS_SUBMISSION_KIND,
  SELL_INVENTORY_FRESHNESS_TTL_DAYS,
  SELL_INVENTORY_FRESHNESS_TTL_MS,
  isSellInventoryFreshnessEligibleStatus,
  isSellInventoryFreshnessResponse,
  isSellInventoryFreshnessStopResponse,
  isSellInventoryFreshnessSubmissionKind,
  sellInventoryFreshnessDeliveryState,
  sellInventoryFreshnessDueAt,
  sellInventoryFreshnessRequestState,
  sellInventoryFreshnessResponseLabels,
  sellInventoryFreshnessResponses,
  sellInventoryFreshnessStopResponses,
  sellInventoryFreshnessSubmissionState,
} from "../db/price-check/domain/sell-inventory-freshness.ts";
import {
  SELL_INVENTORY_FRESHNESS_TOKEN_PATTERN,
  SELL_INVENTORY_FRESHNESS_TOKEN_TTL_MS,
  deriveSellInventoryFreshnessToken,
  hashSellInventoryFreshnessToken,
  isSellInventoryFreshnessToken,
  newSellInventoryFreshnessNonce,
  sellInventoryFreshnessUrl,
} from "../lib/marketplace/sell-inventory-freshness-token.ts";
import {
  deriveSellEvidenceToken,
  hashSellEvidenceToken,
} from "../lib/marketplace/sell-evidence-token.ts";
import {
  deriveSellVerificationToken,
  deriveVerificationToken,
  hashVerificationToken,
} from "../lib/marketplace/verification.ts";
import { validateInventoryFreshnessRequest } from "../lib/marketplace/admin/validation.ts";
import { sellInventoryFreshnessEmail } from "../lib/marketplace/email/sell-inventory-freshness-templates.ts";
import {
  SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY,
  SELL_INVENTORY_FRESHNESS_PAGE_PATH,
  SELL_INVENTORY_FRESHNESS_RESPOND_API_PATH,
  SELL_INVENTORY_FRESHNESS_VIEW_API_PATH,
} from "../lib/marketplace/sell-inventory-freshness-contract.ts";
import { marketplaceNotificationHandlers, registeredNotificationTypes } from "../lib/notifications/registry.ts";
import { marketplaceCapabilities, roleCan } from "../lib/price-check/admin/policy.ts";
import { sellUploadOptions } from "../lib/marketplace/sell-upload-options.ts";
import { registerServerModuleHooks } from "./helpers/server-module-hooks.mjs";

// The composition layer is written for the bundler and uses the `@/*` alias, so
// it is loaded through the same hooks every other admin-composition test uses.
registerServerModuleHooks();
const { buildMarketplaceActionContext } = await import(
  "../lib/price-check/admin/marketplace-access.ts"
);

/**
 * Bulk-inventory freshness — the parts that are decidable without a database.
 *
 * Everything that is a *stored* fact — what the issue transaction writes, what a
 * response consumes, what a projection can select — is proved against real
 * Postgres in `sell-inventory-freshness.integration.test.mjs`. This file covers
 * the pure functions and the structural rules a running database cannot show:
 * the exact response allowlist, credential derivation and its domain separation,
 * the template's input surface, the route wiring, and which layer is allowed to
 * see a plaintext token.
 */

const root = path.resolve(import.meta.dirname, "..");
// Line endings are normalised because this checkout uses `core.autocrlf=true`:
// a source assertion anchored on "\n" would otherwise pass or fail on a git
// setting rather than on the code.
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), "utf8").replace(/\r\n/g, "\n");

/**
 * Source with comments removed, for the assertions that are about what the code
 * *does* rather than what it says. Several of these modules explain in prose
 * exactly which mechanism they refuse to use, and a naive scan would read the
 * refusal as the thing being refused.
 */
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const domain = read("db", "price-check", "domain", "sell-inventory-freshness.ts");
const repository = read("db", "price-check", "repositories", "sell-inventory-freshness-repository.ts");
const detailRepository = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const requestService = read("lib", "marketplace", "sell-inventory-freshness-request-service.ts");
const service = read("lib", "marketplace", "sell-inventory-freshness-service.ts");
const publicRoutes = read("lib", "marketplace", "sell-inventory-freshness-public-routes.ts");
const writeRoutes = read("lib", "marketplace", "admin", "write-routes.ts");
const handlers = read("lib", "marketplace", "email", "sell-inventory-freshness-handlers.ts");
const tokenModule = read("lib", "marketplace", "sell-inventory-freshness-token.ts");
const panel = read("components", "admin", "InventoryFreshnessPanel.tsx");
const sellDetail = read("components", "admin", "SellSubmissionDetail.tsx");
const publicPanel = read("components", "marketplace", "SellInventoryFreshness.tsx");
const publicPage = read("app", "buy-sell-aircraft-parts", "sell", "availability", "page.tsx");
const schema = read("db", "price-check", "schema.ts");
const guard = read("scripts", "apply-inventory-freshness-production-migration.mjs");
const sitemap = read("app", "sitemap.ts");
const globalCss = read("app", "globals.css");

const MIGRATION_DIRECTORY = "20260818200850_inventory_freshness_checks";
const migration = read(
  "db", "price-check", "migrations-netlify-archive", MIGRATION_DIRECTORY, "migration.sql",
);
/** The digest is computed over the bytes on disk, not the normalised text. */
const migrationBytes = fs.readFileSync(
  path.join(root, "db", "price-check", "migrations-netlify-archive", MIGRATION_DIRECTORY, "migration.sql"),
);

const KEY = "civilon-marketplace-verify-token-key-for-tests";
const OTHER_KEY = "civilon-marketplace-verify-token-key-alternate!!";

/* ------------------------------------------------------- baseline intake */

test("bulk intake is untouched: a spreadsheet plus optional shared photos", () => {
  // Stage 1 adds a question about an existing submission. It must not have
  // quietly changed what a bulk seller has to send in the first place.
  const inventory = sellUploadOptions.find((option) => option.value === "INVENTORY_SPREADSHEET");
  assert.ok(inventory, "the bulk inventory upload option still exists");
  assert.deepEqual([...inventory.mimes], [
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]);
  assert.match(inventory.accept, /\.csv/);
  assert.match(inventory.accept, /\.xlsx/);
  // Photos remain shared, optional and per-submission — never per line item.
  for (const value of ["PART_NUMBER_SERIAL_PHOTO", "CUSTODY_PART_PHOTO"]) {
    const option = sellUploadOptions.find((entry) => entry.value === value);
    assert.ok(option, value);
    assert.deepEqual([...option.mimes], ["image/jpeg", "image/png", "image/webp"]);
  }
  assert.match(
    sellUploadOptions.find((entry) => entry.value === "WAREHOUSE_BUSINESS_EVIDENCE").hint,
    /Optional/i,
  );
  // Nothing in this workflow introduces a per-item photo requirement, a public
  // listing, an inventory search, a seller directory or buyer visibility.
  for (const [name, source] of [
    ["domain", domain],
    ["repository", repository],
    ["public routes", publicRoutes],
    ["public panel", publicPanel],
    ["public page", publicPage],
    ["admin panel", panel],
  ]) {
    assert.doesNotMatch(source, /per-item photo|itemPhoto|photoPerItem/i, name);
    assert.doesNotMatch(source, /publicListing|listInventory|searchInventory|sellerDirectory/i, name);
  }
  // The private page is not in the sitemap, and nothing added it.
  assert.doesNotMatch(sitemap, /availability/);
  assert.match(publicPage, /robots: \{ index: false, follow: false, nocache: true \}/);
  assert.match(publicPage, /referrer: "no-referrer"/);
});

/* --------------------------------------------------------------- responses */

test("the response allowlist is exactly three values, and they are the stored ones", () => {
  assert.deepEqual([...sellInventoryFreshnessResponses], [
    "all_available",
    "some_changed",
    "none_available",
  ]);
  for (const rejected of [
    null, undefined, 42, "", "ALL_AVAILABLE", "all available", "maybe",
    "partially_available", "unknown", { toString: () => "all_available" },
  ]) {
    assert.equal(isSellInventoryFreshnessResponse(rejected), false, String(rejected));
  }
  // Every response has a seller-facing label, and no label claims anything about
  // what answering proves or what Civilon concludes.
  for (const response of sellInventoryFreshnessResponses) {
    const label = sellInventoryFreshnessResponseLabels[response];
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0, response);
    assert.doesNotMatch(label, /certif|approv|authentic|airworth|guarantee|verified|confirmed/i, response);
  }
  assert.equal(
    Object.keys(sellInventoryFreshnessResponseLabels).length,
    sellInventoryFreshnessResponses.length,
  );
  // The exact seller-facing wording the product specifies.
  assert.equal(sellInventoryFreshnessResponseLabels.all_available, "All inventory is still available");
  assert.equal(sellInventoryFreshnessResponseLabels.some_changed, "Some items changed");
  assert.equal(sellInventoryFreshnessResponseLabels.none_available, "This inventory is no longer available");
});

test("the two stop responses are exactly the ones that end an automated cadence", () => {
  assert.deepEqual([...sellInventoryFreshnessStopResponses], ["some_changed", "none_available"]);
  assert.equal(isSellInventoryFreshnessStopResponse("all_available"), false);
  assert.equal(isSellInventoryFreshnessStopResponse("some_changed"), true);
  assert.equal(isSellInventoryFreshnessStopResponse("none_available"), true);
  assert.equal(isSellInventoryFreshnessStopResponse(null), false);
});

/* ------------------------------------------------------------- eligibility */

test("manual eligibility is an allowlist of two statuses and one submission kind", () => {
  assert.deepEqual([...SELL_INVENTORY_FRESHNESS_ELIGIBLE_STATUSES], ["verified", "under_review"]);
  for (const status of ["verified", "under_review"]) {
    assert.equal(isSellInventoryFreshnessEligibleStatus(status), true, status);
  }
  // Every status Civilon must refuse, named individually so a widened enum
  // cannot silently become eligible.
  for (const status of [
    "pending_verification", "accepted", "declined", "closed", "spam", "withdrawn",
    "", null, undefined, "VERIFIED",
  ]) {
    assert.equal(isSellInventoryFreshnessEligibleStatus(status), false, String(status));
  }
  assert.equal(SELL_INVENTORY_FRESHNESS_SUBMISSION_KIND, "bulk_inventory");
  assert.equal(isSellInventoryFreshnessSubmissionKind("bulk_inventory"), true);
  assert.equal(isSellInventoryFreshnessSubmissionKind("single_part"), false);
  // The repository decides both against the stored row, and refusing never
  // writes: no status is changed on the way out.
  assert.match(repository, /if \(!isSellInventoryFreshnessSubmissionKind\(record\.submissionKind\)\)/);
  assert.match(repository, /if \(!isSellInventoryFreshnessEligibleStatus\(record\.status\)\)/);
  assert.match(repository, /if \(record\.contactVerificationState !== "VERIFIED" \|\| record\.contactDeletedAt\)/);
  const issue = repository.slice(
    repository.indexOf("export async function issueSellInventoryFreshnessCheck("),
    repository.indexOf("export async function loadSellInventoryFreshnessDelivery("),
  );
  // The status is read, and never written: refusing an ineligible record leaves
  // it exactly as it was found.
  assert.match(issue, /status: sellSubmissions\.status/);
  assert.doesNotMatch(issue, /\.update\(sellSubmissions\)/);
  assert.doesNotMatch(issue, /\.insert\(sellSubmissions\)|\.delete\(sellSubmissions\)/);
  // That read holds the submission row for the transaction — a lock, not a
  // write — so the scheduled producer, which locks the same row, cannot be
  // deciding about this record at the same moment. Staff wait rather than skip:
  // superseding whatever is found is what the button means.
  assert.match(issue, /\.for\("update", \{ of: sellSubmissions \}\)/);
  assert.doesNotMatch(issue, /skipLocked/);
  assert.doesNotMatch(issue, /of: marketplaceContacts/, "the contact is read, never locked");
  // No write anywhere in the file touches the submission or its attachments.
  for (const table of ["sellSubmissions", "sellSubmissionItems", "marketplaceAttachments", "marketplaceContacts"]) {
    assert.doesNotMatch(repository, new RegExp(`\\.(?:update|insert|delete)\\(${table}\\)`), table);
  }
});

/* ------------------------------------------------------------- timing */

test("the link lives 14 days and the cadence is 45 days", () => {
  assert.equal(SELL_INVENTORY_FRESHNESS_TTL_DAYS, 14);
  assert.equal(SELL_INVENTORY_FRESHNESS_TTL_MS, 14 * 24 * 60 * 60 * 1000);
  assert.equal(SELL_INVENTORY_FRESHNESS_TOKEN_TTL_MS, SELL_INVENTORY_FRESHNESS_TTL_MS);
  assert.equal(SELL_INVENTORY_FRESHNESS_CADENCE_DAYS, 45);
  assert.equal(SELL_INVENTORY_FRESHNESS_CADENCE_MS, 45 * 24 * 60 * 60 * 1000);
  // The two are different numbers and neither is derived from the other.
  assert.notEqual(SELL_INVENTORY_FRESHNESS_TTL_MS, SELL_INVENTORY_FRESHNESS_CADENCE_MS);
  // The service mints exactly the 14-day expiry.
  assert.match(
    requestService,
    /expiresAt: new Date\(now\.valueOf\(\) \+ SELL_INVENTORY_FRESHNESS_TOKEN_TTL_MS\)/,
  );
});

test("the manual path stays manual: the producer is an isolated surface", () => {
  // Stage 2 added an autonomous producer, and it is deliberately somewhere else.
  // Nothing on the staff-issued path may schedule, enqueue on a timer, or run
  // itself — a seller e-mail sent by this path is one a staff member asked for.
  for (const [name, source] of [
    ["domain", domain],
    ["repository", repository],
    ["request service", requestService],
    ["service", service],
    ["handlers", handlers],
    ["public routes", publicRoutes],
    ["write routes", writeRoutes],
  ]) {
    // Comments are stripped: several of these modules discuss the cadence in
    // prose, and a sentence about a schedule must not read as one.
    assert.doesNotMatch(stripComments(source), /setInterval|setTimeout|cron|schedule\(/i, name);
  }
  // The manual repository still supersedes, and still knows nothing about the
  // cadence: the producer borrows its audit vocabulary, not the reverse.
  assert.doesNotMatch(repository, /CADENCE/);
  assert.doesNotMatch(repository, /selectDue|issueAutomatic/);
  assert.match(domain, /SELL_INVENTORY_FRESHNESS_CADENCE_MS/);

  // The autonomous surface is exactly three files, none of which is on the
  // staff-issued path, and each of which exists.
  for (const parts of [
    ["db", "price-check", "repositories", "sell-inventory-freshness-cadence-repository.ts"],
    ["lib", "marketplace", "sell-inventory-freshness-cadence-service.ts"],
    ["netlify", "functions", "process-sell-inventory-freshness-cadence.ts"],
  ]) {
    assert.ok(read(...parts).length > 0, parts.join("/"));
  }
  // The schedule is declared in the function that runs, not in netlify.toml, so
  // the deploy configuration is unchanged by this workflow.
  const netlifyToml = read("netlify.toml");
  assert.doesNotMatch(netlifyToml, /freshness|availability/i);
  assert.match(
    read("netlify", "functions", "process-sell-inventory-freshness-cadence.ts"),
    /export const config = \{ schedule: "17 13,14 \* \* \*" \};/,
  );
  // The admin route is still the only staff way in, and the automatic path has
  // no route at all: nothing outside the schedule can trigger it.
  assert.match(writeRoutes, /export function createInventoryFreshnessRequestRoute\(/);
  for (const parts of [["app", "api", "admin", "marketplace", "sell-submissions", "[id]", "inventory-freshness", "route.ts"]]) {
    assert.doesNotMatch(read(...parts), /cadence|Automatic/i, parts.join("/"));
  }
});

/* ------------------------------------------------------------- lifecycle */

test("one check's state is derived from its stored timestamps", () => {
  const now = new Date("2026-08-18T12:00:00Z");
  const live = {
    respondedAt: null,
    revokedAt: null,
    expiresAt: new Date("2026-09-01T00:00:00Z"),
  };
  assert.equal(sellInventoryFreshnessRequestState(live, now), "awaiting_seller");
  assert.equal(sellInventoryFreshnessRequestState({ ...live, respondedAt: now }, now), "answered");
  assert.equal(sellInventoryFreshnessRequestState({ ...live, revokedAt: now }, now), "revoked");
  assert.equal(sellInventoryFreshnessRequestState({ ...live, expiresAt: now }, now), "expired");
  // An answer outranks expiry: a seller who replied before the link lapsed
  // still replied.
  assert.equal(
    sellInventoryFreshnessRequestState({ respondedAt: now, revokedAt: null, expiresAt: now }, now),
    "answered",
  );
});

test("the submission state follows the fixed precedence, and stop answers are sticky", () => {
  const now = new Date("2026-08-18T12:00:00Z");
  const issuedAt = new Date("2026-08-01T00:00:00Z");
  const base = {
    response: null,
    respondedAt: null,
    revokedAt: null,
    issuedAt,
    expiresAt: new Date("2026-09-01T00:00:00Z"),
  };

  assert.equal(sellInventoryFreshnessSubmissionState(null, now), "never_checked");
  assert.equal(sellInventoryFreshnessSubmissionState(base, now), "awaiting_seller");

  const answered = (response, respondedAt) => ({ ...base, response, respondedAt });
  // A stop answer outranks the timer in both directions of time.
  const longAgo = new Date("2026-08-02T00:00:00Z");
  const farFuture = new Date("2027-08-18T12:00:00Z");
  for (const stop of ["some_changed", "none_available"]) {
    assert.equal(sellInventoryFreshnessSubmissionState(answered(stop, longAgo), now), stop);
    assert.equal(sellInventoryFreshnessSubmissionState(answered(stop, longAgo), farFuture), stop,
      "a stop answer must not decay back to due as time passes");
  }
  // `all_available` is measured against the 45-day cadence from the answer.
  const respondedAt = new Date("2026-08-10T00:00:00Z");
  const current = answered("all_available", respondedAt);
  assert.equal(sellInventoryFreshnessSubmissionState(current, now), "current");
  assert.equal(
    sellInventoryFreshnessSubmissionState(
      current,
      new Date(respondedAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS),
    ),
    "due",
    "exactly at the anchor the record is due, not current",
  );
  assert.equal(
    sellInventoryFreshnessSubmissionState(
      current,
      new Date(respondedAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS - 1),
    ),
    "current",
  );
  // An unanswered link that lapsed starts the clock from the ask.
  const lapsed = { ...base, expiresAt: new Date("2026-08-15T00:00:00Z") };
  assert.equal(sellInventoryFreshnessSubmissionState(lapsed, now), "current");
  assert.equal(
    sellInventoryFreshnessSubmissionState(
      lapsed,
      new Date(issuedAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS),
    ),
    "due",
  );
  // A revoked, unanswered check is not "awaiting" anybody.
  assert.equal(
    sellInventoryFreshnessSubmissionState({ ...base, revokedAt: now }, now),
    "current",
  );
});

test("the cadence anchor is COALESCE(responded_at, issued_at) + 45 days", () => {
  const issuedAt = new Date("2026-08-01T00:00:00Z");
  const respondedAt = new Date("2026-08-10T00:00:00Z");
  assert.equal(
    sellInventoryFreshnessDueAt({ respondedAt: null, issuedAt }).valueOf(),
    issuedAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS,
  );
  assert.equal(
    sellInventoryFreshnessDueAt({ respondedAt, issuedAt }).valueOf(),
    respondedAt.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS,
  );
});

test("delivery is reported from the outbox state and never assumed", () => {
  assert.deepEqual(
    ["pending", "running", "succeeded", "failed", "dead_letter"].map(sellInventoryFreshnessDeliveryState),
    ["queued", "sending", "delivered", "retrying", "undeliverable"],
  );
  for (const unknown of [null, undefined, "", "invented_state"]) {
    assert.equal(sellInventoryFreshnessDeliveryState(unknown), "unrecorded", String(unknown));
  }
});

/* -------------------------------------------------------------- schema */

test("the stored table is additive and alters nothing that already exists", () => {
  // One CREATE TYPE and one CREATE TABLE. Every other statement names only the
  // new table.
  assert.match(migration, /CREATE TYPE "sell_inventory_freshness_response" AS ENUM\('all_available', 'some_changed', 'none_available'\)/);
  assert.match(migration, /CREATE TABLE "sell_inventory_freshness_checks"/);
  assert.equal((migration.match(/CREATE TABLE/g) ?? []).length, 1);
  assert.equal((migration.match(/CREATE TYPE/g) ?? []).length, 1);
  // No destructive or data-changing operation anywhere.
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE)\b/i);
  assert.doesNotMatch(migration, /^\s*(?:DELETE|UPDATE|INSERT)\b/im);
  // Every ALTER TABLE in the file is against the new table only, so no approved
  // table is widened and `sell_submissions` gains no freshness column.
  for (const [, table] of migration.matchAll(/ALTER TABLE "([^"]+)"/g)) {
    assert.equal(table, "sell_inventory_freshness_checks", `ALTER must not touch ${table}`);
  }
  for (const untouched of [
    "sell_submissions", "sell_submission_items", "marketplace_attachments",
    "marketplace_contacts", "marketplace_evidence_requests", "notification_outbox",
    "audit_events",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`ALTER TABLE "${untouched}"`), untouched);
  }
  // The schema declares no freshness column on `sell_submissions`.
  const sellSubmissionsTable = schema.slice(
    schema.indexOf('export const sellSubmissions = pgTable('),
    schema.indexOf('export const sellSubmissionItems = pgTable('),
  );
  assert.ok(sellSubmissionsTable.length > 0);
  assert.doesNotMatch(sellSubmissionsTable, /freshness|respondedAt|lastCheckedAt/i);
});

test("the migration and the schema agree on every freshness constraint and index", () => {
  const constraints = [...schema.matchAll(/"(sell_inventory_freshness_checks_[a-z_]+_chk)"/g)]
    .map((match) => match[1]);
  assert.ok(constraints.length >= 5, `expected the schema to declare the check constraints, saw ${constraints.length}`);
  for (const name of new Set(constraints)) {
    assert.match(migration, new RegExp(`CONSTRAINT "${name}" CHECK`), name);
  }
  // Every constraint the fixed decisions require, by name.
  for (const required of [
    "sell_inventory_freshness_checks_lifecycle_chk",
    "sell_inventory_freshness_checks_response_chk",
    "sell_inventory_freshness_checks_expiry_chk",
    "sell_inventory_freshness_checks_responded_order_chk",
    "sell_inventory_freshness_checks_attempt_chk",
  ]) {
    assert.ok(new Set(constraints).has(required), `schema must declare ${required}`);
  }
  for (const index of [
    "sell_inventory_freshness_checks_hash_uidx",
    "sell_inventory_freshness_checks_active_uidx",
  ]) {
    assert.match(schema, new RegExp(index), index);
    assert.match(migration, new RegExp(`CREATE UNIQUE INDEX "${index}"`), index);
  }
  // The one-live-check rule, with its exact partial predicate.
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "sell_inventory_freshness_checks_active_uidx" ON "sell_inventory_freshness_checks" \("sell_submission_id"\) WHERE "responded_at" is null and "revoked_at" is null/,
  );
  // `responded_at` is the agreed name; `consumed_at` belongs to the other table.
  assert.match(migration, /"responded_at" timestamp with time zone/);
  assert.doesNotMatch(migration, /"consumed_at"/);
  // The enum is stored as an enum column, not a free varchar.
  assert.match(migration, /"response" "sell_inventory_freshness_response"/);
});

/* ------------------------------------------------------------- credentials */

test("the credential is a 43-character base64url HMAC with a 14-day life", () => {
  const nonce = newSellInventoryFreshnessNonce();
  assert.match(nonce, /^[a-f0-9]{64}$/);

  const token = deriveSellInventoryFreshnessToken(KEY, nonce);
  assert.match(token, SELL_INVENTORY_FRESHNESS_TOKEN_PATTERN);
  assert.equal(token.length, 43);
  assert.equal(isSellInventoryFreshnessToken(token), true);
  // Deterministic in the nonce, so the handler can re-derive it at send time…
  assert.equal(deriveSellInventoryFreshnessToken(KEY, nonce), token);
  // …and nothing else is a credential.
  for (const value of [null, 42, "", "short", `${token}=`, `${token}A`, token.slice(0, 42)]) {
    assert.equal(isSellInventoryFreshnessToken(value), false, String(value));
  }
  assert.notEqual(deriveSellInventoryFreshnessToken(KEY, newSellInventoryFreshnessNonce()), token);
  assert.throws(
    () => deriveSellInventoryFreshnessToken(KEY, "not-a-nonce"),
    /SELL_INVENTORY_FRESHNESS_NONCE_INVALID/,
  );
  assert.throws(
    () => deriveSellInventoryFreshnessToken("short", nonce),
    /MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE/,
  );
  assert.throws(
    () => hashSellInventoryFreshnessToken("short", token),
    /MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE/,
  );
});

test("what is stored is a keyed hash of the token, not the token", () => {
  const nonce = newSellInventoryFreshnessNonce();
  const token = deriveSellInventoryFreshnessToken(KEY, nonce);
  const stored = hashSellInventoryFreshnessToken(KEY, token);

  assert.match(stored, /^[a-f0-9]{64}$/);
  assert.equal(stored.includes(token), false);
  assert.equal(token.includes(stored), false);
  assert.equal(hashSellInventoryFreshnessToken(KEY, token), stored);
  // The key is required to reproduce the lookup value, so a database dump on
  // its own is not replayable.
  assert.notEqual(hashSellInventoryFreshnessToken(OTHER_KEY, token), stored);
  assert.notEqual(deriveSellInventoryFreshnessToken(OTHER_KEY, nonce), token);
});

test("the freshness credential is domain-separated from every other credential", () => {
  const nonce = newSellInventoryFreshnessNonce();
  const freshness = deriveSellInventoryFreshnessToken(KEY, nonce);

  // 1. Its own derivation label: the same nonce yields a different token on the
  //    Buy, Sell verification and evidence paths, so none of those credentials
  //    is a value this label can produce.
  assert.notEqual(freshness, deriveVerificationToken(KEY, nonce));
  assert.notEqual(freshness, deriveSellVerificationToken(KEY, nonce));
  assert.notEqual(freshness, deriveSellEvidenceToken(KEY, nonce));

  // 2. Its own lookup label: even for the same token string, the stored hash
  //    lands in a namespace no other credential's hash can collide with.
  assert.notEqual(
    hashSellInventoryFreshnessToken(KEY, freshness),
    hashVerificationToken(KEY, freshness),
  );
  assert.notEqual(
    hashSellInventoryFreshnessToken(KEY, freshness),
    hashSellEvidenceToken(KEY, freshness),
  );

  // The labels are versioned and distinct from the evidence workflow's.
  assert.match(tokenModule, /const DERIVE_LABEL = "civilon-marketplace-sell-inventory-freshness-token:v1"/);
  assert.match(tokenModule, /const LOOKUP_LABEL = "civilon-marketplace-sell-inventory-freshness-lookup:v1"/);
  const evidenceToken = read("lib", "marketplace", "sell-evidence-token.ts");
  assert.doesNotMatch(evidenceToken, /inventory-freshness/);
  // The repository never re-derives a credential.
  assert.equal([...repository.matchAll(/civilon-marketplace-sell-inventory-freshness-[a-z]+:v\d+/g)].length, 0);
});

test("the emailed link carries the credential in the fragment, never the query", () => {
  const token = deriveSellInventoryFreshnessToken(KEY, newSellInventoryFreshnessNonce());
  const url = sellInventoryFreshnessUrl("https://cvlon.com/", token);

  assert.equal(
    url,
    `https://cvlon.com${SELL_INVENTORY_FRESHNESS_PAGE_PATH}#${SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY}=${encodeURIComponent(token)}`,
  );
  const parsed = new URL(url);
  assert.equal(parsed.search, "");
  assert.equal(parsed.pathname, SELL_INVENTORY_FRESHNESS_PAGE_PATH);
  assert.equal(parsed.hash, `#${SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY}=${encodeURIComponent(token)}`);
  assert.equal(parsed.searchParams.has(SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY), false);
  assert.equal(SELL_INVENTORY_FRESHNESS_PAGE_PATH, "/buy-sell-aircraft-parts/sell/availability");
});

test("only the request service ever holds a plaintext credential", () => {
  assert.match(
    requestService,
    /const keyedTokenHash = hashSellInventoryFreshnessToken\(\s*key,\s*deriveSellInventoryFreshnessToken\(key, nonce\),\s*\);/,
  );
  assert.doesNotMatch(requestService, /console\./);
  for (const [name, source] of [
    ["repository", repository],
    ["service", service],
    ["admin write routes", writeRoutes],
    ["admin panel", panel],
    ["Sell detail", sellDetail],
    ["detail repository", detailRepository],
  ]) {
    assert.doesNotMatch(source, /deriveSellInventoryFreshnessToken|sellInventoryFreshnessUrl/, name);
  }
  // The one other place a plaintext token exists is the send path, and it
  // re-derives from the stored nonce rather than reading a stored token.
  assert.match(
    handlers,
    /deriveSellInventoryFreshnessToken\(\s*marketplaceVerifyTokenKey\(\),\s*delivery\.tokenDerivationNonce,\s*\)/,
  );
  assert.doesNotMatch(handlers, /console\./);
});

/* ---------------------------------------------------------------- template */

test("the seller email is privacy-minimised and states its own boundaries", () => {
  const message = sellInventoryFreshnessEmail({
    from: "sales@cvlon.com",
    to: "seller@example.com",
    reference: "SS-2ABCD3EFGH",
    availabilityUrl: `https://cvlon.com${SELL_INVENTORY_FRESHNESS_PAGE_PATH}#${SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY}=abc`,
    expiresAt: new Date("2026-09-01T00:00:00Z"),
  });
  const body = `${message.subject}\n${message.textBody}\n${message.htmlBody}\n${JSON.stringify(message.metadata)}`;

  assert.equal(message.to, "seller@example.com");
  assert.equal(message.tag, "civilon-sell-inventory-freshness");
  // The reference is the only record identifier anywhere in the message, and it
  // is one the seller already has.
  assert.deepEqual(message.metadata, { reference: "SS-2ABCD3EFGH" });
  // Nothing about the inventory itself. The template is not handed a part
  // number, quantity, line count, price, currency, warehouse, location, company
  // or filename, so it cannot leak one.
  for (const forbidden of [
    "partNumber", "part number", "quantity", "currency", "USD", "warehouse",
    "location", "filename", "line item", "spreadsheet", "csv", "xlsx",
    "inventory list", "company",
  ]) {
    assert.equal(body.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
  // "buyer" appears exactly twice — once per body — and only to deny that
  // anything is shown to one.
  assert.equal((body.match(/buyer/gi) ?? []).length, 2);
  assert.match(message.textBody, /Nothing you answer is published, listed, or shown to a buyer/i);
  // No money figure of any kind, and "price" appears only to deny that one has
  // been agreed.
  assert.doesNotMatch(body, /[$€£]\s?\d|\d+(\.\d{2})?\s?(USD|EUR|GBP)/);
  assert.match(message.textBody, /Nothing in this email is an offer, an acceptance, or an agreed price/);
  // The link is a fragment credential.
  assert.match(message.textBody, new RegExp(`${SELL_INVENTORY_FRESHNESS_PAGE_PATH}#${SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY}=`));
  assert.match(message.htmlBody, /href="https:\/\/cvlon\.com\/buy-sell-aircraft-parts\/sell\/availability#token=abc"/);
  // The expiry is stated in both bodies.
  assert.match(message.textBody, /expires September 1, 2026/);
  assert.match(message.htmlBody, /expires September 1, 2026/);

  // Every boundary the message must carry, in both bodies.
  for (const claim of [
    /your own statement about your stock/i,
    /published, listed, or shown to a buyer/i,
    /not obliged to buy/i,
    /subject to confirmation/i,
    /Documentation varies by part and source/i,
    /guarantee of authenticity or fitness/i,
    /does not create an account/i,
    /airworthiness approval or any other regulatory approval/i,
    // The negation is carried by one "Neither … nor" sentence, so the whole
    // sentence is asserted rather than a fragment that could survive it being
    // rewritten into an affirmative claim.
    /Neither this question nor your answer certifies or authenticates anything, is airworthiness approval or any other regulatory approval, or is a guarantee of authenticity or fitness\./i,
  ]) {
    assert.match(message.textBody, claim, `text: ${claim}`);
    assert.match(message.htmlBody, claim, `html: ${claim}`);
  }
  // …and none of the things it must never claim.
  assert.doesNotMatch(body, /verified supplier|approved supplier|certified|we guarantee|confirmed available/i);
});

test("the template escapes every value it interpolates", () => {
  const message = sellInventoryFreshnessEmail({
    from: "sales@cvlon.com",
    to: "seller@example.com",
    reference: 'SS-<script>"&\'',
    availabilityUrl: 'https://cvlon.com/x#token="><script>',
    expiresAt: new Date("2026-09-01T00:00:00Z"),
  });
  assert.doesNotMatch(message.htmlBody, /<script>/);
  assert.match(message.htmlBody, /&lt;script&gt;/);
});

/* ---------------------------------------------------------------- delivery */

test("the notification handler is registered and owns its own aggregate", () => {
  assert.ok(
    registeredNotificationTypes(marketplaceNotificationHandlers).includes(SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE),
    "the freshness message type must have an owner",
  );
  const handler = marketplaceNotificationHandlers.find(
    (entry) => entry.messageType === SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
  );
  assert.ok(handler, "handler registered");
  assert.equal(handler.workflow, "marketplace");
  // Keyed to the check, not the submission, so a reissue cannot cause an older
  // queued message to go out carrying the newer check's link.
  assert.equal(handler.aggregateType, SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE);
  assert.equal(handler.aggregateType, "sell_inventory_freshness_check");
  assert.equal(SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE, "SELL_SUBMISSION_INVENTORY_FRESHNESS_CHECK");
  assert.equal(typeof handler.deliver, "function");
  assert.equal(typeof handler.recordFailure, "function");
  // Its message type is distinct from every other registered type.
  const all = registeredNotificationTypes();
  assert.equal(all.filter((type) => type === SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE).length, 1);
  assert.equal(new Set(all).size, all.length, "no two handlers may claim one type");
});

test("the handler records provider success and failure through its own repository", () => {
  assert.match(handlers, /markSellInventoryFreshnessNotificationSucceeded\(db, \{/);
  assert.match(handlers, /leaseOwner: context\.leaseOwner/);
  assert.match(handlers, /recordSellInventoryFreshnessNotificationFailure\(db, \{/);
  assert.match(handlers, /deadLetter: failure\.deadLetter/);
  // Success is only recorded while the caller still owns the lease.
  assert.match(repository, /eq\(notificationOutbox\.state, "running"\),\s*eq\(notificationOutbox\.leaseOwner, input\.leaseOwner\),/);
  assert.match(repository, /if \(!completed\) throw new Error\("SELL_INVENTORY_FRESHNESS_DELIVERY_LEASE_LOST"\);/);
  // A failure resolves its own submission rather than trusting the caller.
  const failure = repository.slice(repository.indexOf("export async function recordSellInventoryFreshnessNotificationFailure("));
  assert.match(failure, /select\(\{ sellSubmissionId: sellInventoryFreshnessChecks\.sellSubmissionId \}\)/);
  assert.match(failure, /if \(!record\) return;/);
});

test("a superseded check's queued email is terminalised rather than retried", () => {
  const start = repository.indexOf("export async function issueSellInventoryFreshnessCheck(");
  const body = repository.slice(start, repository.indexOf("\nexport ", start + 10));
  assert.match(body, /state: "dead_letter"/);
  assert.match(body, /sanitizedFailureCode: SELL_INVENTORY_FRESHNESS_SUPERSEDED_CODE/);
  assert.match(body, /inArray\(notificationOutbox\.state, \["pending", "failed"\]\)/);
  assert.ok(
    body.indexOf(".update(notificationOutbox)") > body.indexOf("const [superseded]"),
    "the outbox row is only terminalised once the credential is actually revoked",
  );
  assert.match(body, /eq\(notificationOutbox\.aggregateId, superseded\.id\)/);
  // A running row belongs to a worker holding the lease and is never taken; a
  // succeeded row is history and is never rewritten.
  assert.doesNotMatch(body, /notificationOutbox\.state, \["pending", "failed", "running"\]/);
  assert.doesNotMatch(body, /"succeeded"/);
  // The handler still refuses to load a check that is no longer live, which is
  // what protects a message that was already leased.
  assert.match(
    repository,
    /if \(record\.respondedAt \|\| record\.revokedAt \|\| record\.expiresAt\.valueOf\(\) <= now\.valueOf\(\)\) \{\s*throw new Error\("SELL_INVENTORY_FRESHNESS_UNAVAILABLE"\);/,
  );
});

/* ------------------------------------------------------------- projections */

test("the staff projection cannot select a credential or a recipient address", () => {
  const start = detailRepository.indexOf("export type SellInventoryFreshnessSummary = {");
  assert.ok(start > 0, "the summary type must exist");
  const summary = detailRepository.slice(start, detailRepository.indexOf("};", start));
  for (const forbidden of [
    "keyedTokenHash", "tokenDerivationNonce", "keyed_token_hash", "token_derivation_nonce",
    "businessEmail", "recipientReference", "idempotencyKey", "providerMessageId", "availabilityUrl",
  ]) {
    assert.equal(summary.includes(forbidden), false, `summary must not carry ${forbidden}`);
  }
  // …and the query behind it selects none of them either.
  const queryStart = detailRepository.indexOf("id: sellInventoryFreshnessChecks.id,");
  assert.ok(queryStart > 0, "the freshness projection must exist");
  const query = detailRepository.slice(queryStart, detailRepository.indexOf(".limit(1),", queryStart));
  for (const forbidden of [
    "keyedTokenHash", "tokenDerivationNonce", "recipientReference", "idempotencyKey",
    "providerMessageId", "contactId",
  ]) {
    assert.equal(query.includes(forbidden), false, `query must not select ${forbidden}`);
  }
  assert.match(query, /deliveryState: notificationOutbox\.state/);
  assert.match(query, /response: sellInventoryFreshnessChecks\.response/);
  // Latest-only, deterministically ordered.
  assert.match(query, /desc\(sellInventoryFreshnessChecks\.issuedAt\), desc\(sellInventoryFreshnessChecks\.id\)/);
  // The read repository stays read-only.
  assert.doesNotMatch(detailRepository, /db\.insert|db\.update|db\.delete|\.transaction\(/);
});

test("the seller-facing view is told only the reference and the expiry", () => {
  const start = publicRoutes.indexOf("export async function POST_sellInventoryFreshnessView(");
  const body = publicRoutes.slice(start, publicRoutes.indexOf("export async function POST_sellInventoryFreshnessRespond(", start));
  assert.match(body, /reference: snapshot\.publicReference/);
  assert.match(body, /expiresAt: snapshot\.expiresAt\.toISOString\(\)/);
  for (const forbidden of [
    "sellSubmissionId", "checkId", "contactId", "businessEmail", "status",
    "submissionKind", "response",
  ]) {
    assert.equal(body.includes(forbidden), false, `the view response must not carry ${forbidden}`);
  }
  // Reading is not answering: nothing in the view path records anything.
  assert.doesNotMatch(body, /respond|record/i);
  const view = service.slice(
    service.indexOf("export async function viewSellInventoryFreshnessCheck("),
    service.indexOf("export type SellInventoryFreshnessRespondResult"),
  );
  assert.match(view, /dependencies\.findLive\(/);
  assert.doesNotMatch(view, /dependencies\.respond/);
});

/* --------------------------------------------------------------- authority */

test("asking about availability is its own capability, and AUDITOR never has it", () => {
  assert.ok(marketplaceCapabilities.includes("request_inventory_freshness"));
  for (const role of ["ANALYST", "REVIEWER", "ADMIN"]) {
    assert.equal(roleCan(role, "request_inventory_freshness"), true, role);
  }
  // AUDITOR reads and nothing else.
  assert.equal(roleCan("AUDITOR", "request_inventory_freshness"), false);
  assert.equal(roleCan("AUDITOR", "view_marketplace"), true);
  // A separate flag, not a second reading of the evidence permission.
  assert.notEqual("request_inventory_freshness", "request_marketplace_evidence");
  const context = (role) =>
    buildMarketplaceActionContext({ role, aggregate: "sell_submission", currentStatus: "verified", staff: [] });
  assert.equal(context("AUDITOR").canRequestInventoryFreshness, false);
  assert.equal(context("ANALYST").canRequestInventoryFreshness, true);
  assert.equal(context("REVIEWER").canRequestInventoryFreshness, true);
  assert.equal(context("ADMIN").canRequestInventoryFreshness, true);
  // The two flags are computed from two different capabilities.
  const access = read("lib", "price-check", "admin", "marketplace-access.ts");
  assert.match(access, /canRequestEvidence: can\(input\.role, "request_marketplace_evidence"\)/);
  assert.match(access, /canRequestInventoryFreshness: can\(input\.role, "request_inventory_freshness"\)/);

  // The route enforces it before it reads a body or imports a service.
  const start = writeRoutes.indexOf("export function createInventoryFreshnessRequestRoute(");
  assert.ok(start > 0, "the route factory must exist");
  const body = writeRoutes.slice(start, writeRoutes.indexOf("\n}\n", start));
  assert.match(body, /requireStaffApi\("request_inventory_freshness"\)/);
  assert.ok(
    body.indexOf("verifyAdminMutationOrigin(request)") < body.indexOf("readJsonBody"),
    "origin is verified before the body is read",
  );
  assert.ok(
    body.indexOf("verifyAdminMutationOrigin(request)") < body.indexOf("sell-inventory-freshness-request-service"),
    "origin is verified before any service import",
  );
  assert.match(body, /if \(!isRecordId\(id\)\) return privateJson/);
  // The response says queued, and never carries a credential, URL or recipient.
  assert.match(body, /delivery: "queued"/);
  for (const forbidden of ["token", "url", "Url", "recipient", "businessEmail", "checkId"]) {
    assert.equal(body.includes(`${forbidden}:`), false, `the response must not carry ${forbidden}`);
  }
  assert.doesNotMatch(body, /has been emailed|Check sent|email(ed)? the seller/i);
});

test("the admin payload takes no fields and refuses any that are sent", () => {
  // An absent body and an empty object are the same intent.
  assert.deepEqual(validateInventoryFreshnessRequest(null), { ok: true, data: {} });
  assert.deepEqual(validateInventoryFreshnessRequest(undefined), { ok: true, data: {} });
  assert.deepEqual(validateInventoryFreshnessRequest({}), { ok: true, data: {} });
  for (const [label, body] of [
    ["array body", []],
    ["string body", "all_available"],
    ["number body", 7],
    ["a staff-supplied answer", { response: "all_available" }],
    ["a staff-supplied expiry", { expiresAt: "2027-01-01" }],
    ["a staff-supplied recipient", { to: "someone@example.com" }],
    ["a staff-supplied token", { token: "x" }],
    ["a staff-supplied record id", { sellSubmissionId: "x" }],
  ]) {
    assert.equal(validateInventoryFreshnessRequest(body).ok, false, label);
  }
});

/* -------------------------------------------------------------- API surface */

test("both public endpoints are POST-only and take the credential in the body", () => {
  for (const [name, source] of [
    ["view", read("app", "api", "marketplace", "sell-availability", "view", "route.ts")],
    ["respond", read("app", "api", "marketplace", "sell-availability", "respond", "route.ts")],
  ]) {
    assert.match(source, /export const runtime = "nodejs";/, name);
    assert.match(source, /export const POST = POST_sellInventoryFreshness(View|Respond);/, name);
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.match(
        source,
        new RegExp(`export const ${method} = sellInventoryFreshnessMethodNotAllowed;`),
        `${name}: ${method}`,
      );
    }
  }
  assert.equal(SELL_INVENTORY_FRESHNESS_VIEW_API_PATH, "/api/marketplace/sell-availability/view");
  assert.equal(SELL_INVENTORY_FRESHNESS_RESPOND_API_PATH, "/api/marketplace/sell-availability/respond");
  // The credential is read from the body, never from a path or query string.
  assert.match(publicRoutes, /typeof parsed\.token !== "string"/);
  assert.doesNotMatch(publicRoutes, /searchParams|request\.url/);
  // Every response is private and unindexable.
  assert.match(publicRoutes, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(publicRoutes, /"X-Robots-Tag": "noindex, nofollow, noarchive"/);
  assert.match(publicRoutes, /"Referrer-Policy": "no-referrer"/);
  assert.match(publicRoutes, /status: 405[\s\S]*?Allow: "POST"/);
  // The admin route is POST-only too.
  const adminRoute = read("app", "api", "admin", "marketplace", "sell-submissions", "[id]", "inventory-freshness", "route.ts");
  assert.match(adminRoute, /export const POST = createInventoryFreshnessRequestRoute\(\);/);
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    assert.match(adminRoute, new RegExp(`export const ${method} = methodNotAllowed;`), method);
  }
});

test("the respond endpoint accepts exactly two keys and only allowlisted answers", () => {
  // Exact key set, checked as a sorted join so an extra or missing key fails.
  assert.match(publicRoutes, /Object\.keys\(parsed\)\.sort\(\)\.join\(","\) !== "response,token"/);
  assert.match(publicRoutes, /!isSellInventoryFreshnessResponse\(parsed\.response\)/);
  // The view endpoint takes exactly one key.
  assert.match(publicRoutes, /Object\.keys\(parsed\)\.length !== 1/);
  // Both endpoints demand an approved Origin and refuse a missing one.
  assert.match(publicRoutes, /if \(!origin\) return false;/);
  assert.match(publicRoutes, /sec-fetch-site"\) === "cross-site"/);
  assert.equal((publicRoutes.match(/if \(!originAllowed\(request\)\) return unavailable\(\);/g) ?? []).length, 2);
  // Body size is bounded on both.
  assert.equal((publicRoutes.match(/readBody\(request, SELL_INVENTORY_FRESHNESS_[A-Z_]+_MAX_BODY_BYTES\)/g) ?? []).length, 2);
  // Nothing is echoed back but a bare status.
  assert.match(publicRoutes, /json\(\{ ok: true, status: "recorded" \}\)/);
  assert.doesNotMatch(publicRoutes, /reference: result|response: result/);
});

test("every refusal is the same opaque unavailable", () => {
  // One shared refusal, used everywhere, with no reason attached.
  assert.match(publicRoutes, /function unavailable\(\) \{\s*return json\(\{ ok: false, status: "unavailable" \}\);\s*\}/);
  // The service collapses every rejection into it.
  assert.equal((service.match(/return \{ outcome: "unavailable" \}/g) ?? []).length, 3);
  // The repository refuses replay uniformly rather than pretending a repeated
  // identical answer succeeded.
  const respond = repository.slice(
    repository.indexOf("export async function recordSellInventoryFreshnessResponse("),
    repository.indexOf("export async function markSellInventoryFreshnessNotificationSucceeded("),
  );
  assert.match(respond, /if \(check\.respondedAt \|\| check\.revokedAt\) return \{ outcome: "unavailable" as const \};/);
  // No branch compares a submitted answer with a stored one, which would be an
  // oracle over a three-value space.
  assert.doesNotMatch(respond, /check\.response === input\.response|input\.response === check\.response/);
  // The atomic write names the check's own unanswered state and attempt count.
  assert.match(respond, /eq\(sellInventoryFreshnessChecks\.attemptCount, check\.attemptCount\)/);
  assert.match(respond, /isNull\(sellInventoryFreshnessChecks\.respondedAt\)/);
  assert.match(respond, /isNull\(sellInventoryFreshnessChecks\.revokedAt\)/);
  assert.match(respond, /if \(!answered\) return \{ outcome: "unavailable" as const \};/);
  // Attempts are bounded.
  assert.match(respond, /if \(check\.attemptCount \+ 1 > check\.maxAttemptCount\)/);
});

/* ------------------------------------------------------------------- pages */

test("the seller page erases the fragment and answers only on an explicit press", () => {
  assert.match(publicPanel, /window\.history\.replaceState\(null, "", SELL_INVENTORY_FRESHNESS_PAGE_PATH\)/);
  // Erase happens before anything decides what to do with the value.
  assert.ok(
    publicPanel.indexOf("window.history.replaceState") < publicPanel.indexOf("token.current = value"),
    "the fragment is erased before the credential is acted on",
  );
  // The credential is never rendered, never written back to the URL, never put
  // in a form field.
  assert.doesNotMatch(publicPanel, /value=\{token\.current\}|defaultValue=\{token/);
  // Opening the page only reads. The answer POST is behind onClick.
  assert.match(publicPanel, /body: JSON\.stringify\(\{ token: value \}\)/);
  assert.match(publicPanel, /onClick=\{\(\) => void send\(\)\}/);
  assert.match(publicPanel, /body: JSON\.stringify\(\{ token: token\.current, response: chosen \}\)/);
  // Selecting a radio only sets state; it never sends.
  assert.match(publicPanel, /onChange=\{\(\) => setChosen\(response\)\}/);
  assert.doesNotMatch(publicPanel, /onChange=\{[^}]*send\(/);
  // Exactly three choices, rendered from the domain list rather than restated.
  assert.match(publicPanel, /sellInventoryFreshnessResponses\.map\(\(response\) =>/);
  assert.match(publicPanel, /type="radio"/);
  assert.doesNotMatch(publicPanel, /<textarea|type="text"/);
  // The credential is dropped once an answer is accepted, so an honest double
  // press cannot reach the uniform replay refusal.
  assert.match(publicPanel, /token\.current = "";\s*setAnswered\(chosen\);/);
  // Both panels are labelled and announce their own state.
  assert.match(publicPanel, /role="status" aria-live="polite"/);
  assert.match(publicPanel, /<p className="field-error" role="alert">/);
  assert.match(publicPanel, /htmlFor=\{`inventory-freshness-\$\{response\}`\}/);
  assert.match(publicPanel, /id=\{`inventory-freshness-\$\{response\}`\}/);
});

test("a transient view failure keeps the erased credential retryable in memory", () => {
  assert.match(publicPanel, /type Stage = [^;]*"load_error"/);
  assert.match(publicPanel, /setStage\("load_error"\)/);
  assert.match(publicPanel, /onClick=\{\(\) => void load\(token\.current\)\}/);
  assert.match(publicPanel, /Your answer has not been sent/);
  assert.doesNotMatch(publicPanel, /credential stays in memory and the seller can reload/);
});

test("the seller-facing copy states every required boundary", () => {
  const copy = `${publicPanel}\n${publicPage}`;
  for (const claim of [
    /no account is created|does not create an account/i,
    /published, listed, or shown to a buyer/i,
    /your own statement about your stock/i,
    /subject to confirmation/i,
    /not obliged to buy/i,
    /Documentation varies by part and source/i,
    /guarantee of authenticity or fitness/i,
    /airworthiness approval/i,
    /certification, authentication, regulatory/i,
  ]) {
    assert.match(copy, claim, String(claim));
  }
});

test("analytics carries the source page and nothing else", () => {
  for (const event of ["sell_inventory_freshness_opened", "sell_inventory_freshness_answered"]) {
    assert.match(
      publicPanel,
      new RegExp(`trackCivilonEvent\\("${event}", \\{\\s*source_page: SELL_INVENTORY_FRESHNESS_PAGE_PATH,\\s*\\}\\)`),
      event,
    );
  }
  // Exactly two events, and no per-answer event name that would encode the
  // seller's answer in the event stream.
  assert.equal((publicPanel.match(/trackCivilonEvent\(/g) ?? []).length, 2);
  const analytics = read("lib", "analytics.ts");
  for (const forbidden of ["all_available", "some_changed", "none_available"]) {
    assert.equal(analytics.includes(forbidden), false, `no analytics event may name ${forbidden}`);
  }
  // The payload of every call is exactly `{ source_page }`. Checked on the
  // argument object rather than the whole call, because the second event's own
  // *name* contains "answered".
  const payloads = [...publicPanel.matchAll(/trackCivilonEvent\("[a-z_]+", (\{[^}]*\})\)/g)]
    .map((match) => match[1]);
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.equal(payload.replace(/\s/g, ""), "{source_page:SELL_INVENTORY_FRESHNESS_PAGE_PATH,}");
    for (const forbidden of ["reference", "token", "chosen", "response", "check"]) {
      assert.equal(payload.includes(forbidden), false, `analytics payload must not carry ${forbidden}`);
    }
  }
});

/* ------------------------------------------------------------------- admin */

test("the freshness panel is rendered for bulk records only", () => {
  assert.match(sellDetail, /\{bulk && <InventoryFreshnessPanel/);
  assert.match(sellDetail, /const bulk = submission\.submissionKind === "bulk_inventory";/);
  // The evidence panel is still unconditional, so single-part detail keeps
  // exactly the panels it had.
  assert.match(sellDetail, /\n {8}<SellEvidenceRequestPanel/);
  // The three eligibility reasons the route re-decides are also what the page
  // shows, so a blocked record explains itself rather than offering a control
  // that would refuse.
  assert.match(sellDetail, /const freshnessBlockedReason = !actions\.canRequestInventoryFreshness/);
  assert.match(sellDetail, /Civilon only asks about availability while a submission is verified or under review\./);
  assert.match(sellDetail, /has not confirmed their email address/);
  // Every derivation is server-side and shares one `now`.
  assert.match(sellDetail, /const now = new Date\(\);/);
  assert.match(sellDetail, /sellInventoryFreshnessSubmissionState\(detail\.inventoryFreshness, now\)/);
  assert.match(sellDetail, /sellInventoryFreshnessRequestState\(detail\.inventoryFreshness, now\)/);
  assert.match(sellDetail, /sellInventoryFreshnessDeliveryState\(detail\.inventoryFreshness\.deliveryState\)/);
  // An unrecognised stored code degrades to "not answered" rather than crashing.
  assert.match(sellDetail, /isSellInventoryFreshnessResponse\(detail\.inventoryFreshness\.response\)/);
});

test("the admin panel separates recording, delivery and the seller's statement", () => {
  assert.match(panel, /delivery: SellInventoryFreshnessDeliveryState/);
  assert.match(panel, /setNotice\("Check recorded and the email queued\./);
  assert.doesNotMatch(panel, /The seller has been emailed|setNotice\("Check sent\./);
  assert.match(panel, /delivered: "Email accepted"/);
  assert.match(panel, /That is not a read receipt and not proof the seller opened or answered it\./);
  // Every delivery state has a label and a detail line, so an unmapped state
  // cannot render as blank.
  for (const state of ["queued", "sending", "delivered", "retrying", "undeliverable", "unrecorded"]) {
    assert.equal((panel.match(new RegExp(`${state}: "`, "g")) ?? []).length, 2, state);
  }
  // Every submission state and request state has a label.
  for (const state of ["never_checked", "awaiting_seller", "current", "due", "some_changed", "none_available"]) {
    assert.match(panel, new RegExp(`${state}: "`), state);
  }
  for (const state of ["awaiting_seller", "answered", "expired", "revoked"]) {
    assert.match(panel, new RegExp(`${state}: "`), state);
  }
  // A seller's answer is never described as a Civilon confirmation, and the
  // panel says what it is not.
  assert.match(panel, /It is their statement, not a Civilon confirmation/);
  // Whitespace-insensitive: this copy is wrapped prose in JSX.
  const panelProse = panel.replace(/\s+/g, " ");
  assert.match(panelProse, /it is not email verification, company verification, supplier approval, certification, authenticity proof, airworthiness or regulatory approval, a confirmation of availability, or any obligation for Civilon to buy/);
  assert.match(panelProse, /changes no status, no business review and no evidence review/);
  // The 45-day cadence is described as the schedule it now is, including what
  // the schedule will not do. The fuller wording is asserted in
  // `sell-inventory-freshness-cadence.unit.test.mjs`.
  assert.doesNotMatch(panelProse, /nothing is scheduled today/);
  assert.match(panelProse, /Civilon also asks on its own about every/);
  assert.match(panelProse, /never touches a link that is still live/);
  assert.match(panelProse, /It stops after two scheduled asks in a row go unanswered/);
  // The panel never renders a credential.
  for (const forbidden of ["keyedTokenHash", "tokenDerivationNonce", "token", "Url"]) {
    assert.equal(panel.includes(forbidden), false, `the panel must not mention ${forbidden}`);
  }
  // The two stop answers are visibly actionable.
  assert.match(panel, /const actionable = submissionState === "some_changed" \|\| submissionState === "none_available";/);
  assert.match(panel, /\{actionable && <p className="admin-callout" role="note">/);
  assert.match(panel, /Work from that, not\s*\n?\s*from the original list\./);
  // Reissue is possible and is labelled as asking again.
  assert.match(panel, /latest \? "Ask again and queue email" : "Ask the seller and queue email"/);
  assert.match(panel, /credentials: "same-origin"/);
});

test("every class the two new surfaces use is actually styled", () => {
  for (const name of [
    "admin-freshness-request-form",
    "marketplace-freshness-choices",
    "admin-callout",
    "admin-definition-grid",
    "admin-panel",
    "admin-status",
    "admin-error",
    "admin-success",
    "marketplace-verify-panel",
  ]) {
    assert.ok(globalCss.includes(`.${name}`), `.${name} must exist in globals.css`);
  }
  assert.match(panel, /className="wide"/);
  assert.ok(globalCss.includes(".admin-definition-grid .wide"));
  for (const state of ["never_checked", "awaiting_seller", "current", "due", "some_changed", "none_available"]) {
    assert.ok(globalCss.includes(`.admin-status.freshness-state-${state}`), state);
  }
  for (const state of ["awaiting_seller", "answered", "expired", "revoked"]) {
    assert.ok(globalCss.includes(`.admin-status.freshness-request-${state}`), state);
  }
  for (const state of ["queued", "sending", "delivered", "retrying", "undeliverable", "unrecorded"]) {
    assert.ok(globalCss.includes(`.admin-status.freshness-delivery-${state}`), state);
  }
  for (const response of sellInventoryFreshnessResponses) {
    assert.ok(globalCss.includes(`.admin-status.freshness-response-${response}`), response);
  }
});

/* --------------------------------------------------------- migration guard */

test("the production migration guard is dry-run by default and pinned to this migration", () => {
  assert.match(guard, new RegExp(`const MIGRATION_NAME = "${MIGRATION_DIRECTORY}";`));
  // The pinned digest is the digest of the bytes actually on disk.
  const digest = createHash("sha256").update(migrationBytes).digest("hex");
  assert.match(guard, new RegExp(`const EXPECTED_SHA256 = "${digest}";`), "the pinned digest must match the migration");
  const statementCount = migration.split(/-->\s*statement-breakpoint\s*/).map((s) => s.trim()).filter(Boolean).length;
  assert.match(guard, new RegExp(`const EXPECTED_STATEMENT_COUNT = ${statementCount};`));

  // Applying takes an explicit flag *and* an explicit environment confirmation.
  assert.match(guard, /const apply = process\.argv\.includes\("--apply"\);/);
  assert.match(guard, /if \(!apply\) \{/);
  assert.match(guard, /mode: "preflight"/);
  assert.match(guard, /process\.env\.CIVILON_APPLY_INVENTORY_FRESHNESS_MIGRATION !== "YES"/);
  // The target is pinned, and an apply demands the owner role.
  assert.match(guard, /const approvedRoles = apply \? \["netlifydb_owner"\] : \["netlifydb_readonly", "netlifydb_owner"\];/);
  assert.match(guard, /does not match the approved target/);
  // Ordering matters more than any of these checks individually: the target,
  // role, digest and statement checks all run before a connection object is
  // ever built, so a refusal is a refusal that never touched a database. This
  // is asserted statically rather than by pointing a test at the production
  // host, which is exactly what must never happen.
  const connectAt = guard.indexOf("const db = drizzle({ schema });");
  assert.ok(connectAt > 0, "the guard must build its connection in one place");
  for (const earlier of [
    "does not match the approved target",
    "const approvedRoles = apply ?",
    "is not approved for this mode",
    "migration digest is not approved",
    "destructive or data-changing operation",
    "must be left untouched",
    "if (statements.length !== EXPECTED_STATEMENT_COUNT)",
  ]) {
    const at = guard.indexOf(earlier);
    assert.ok(at > 0, `guard must contain: ${earlier}`);
    assert.ok(at < connectAt, `"${earlier}" must be checked before any connection is built`);
  }
  assert.equal((guard.match(/drizzle\(\{ schema \}\)/g) ?? []).length, 1);
  // Mismatch inside the transaction throws, which rolls the apply back.
  assert.match(guard, /await db\.transaction\(async \(tx\) => \{/);
  assert.match(guard, /assertComplete\(evidence\);/);
  assert.match(guard, /pg_advisory_xact_lock/);
  // Refuses a repeated or partial apply.
  assert.match(guard, /refusing a partial or repeated apply/);
  assert.match(guard, /refusing the apply/);
  // Destructive statements are refused outright, and the untouched tables are
  // named so an edited migration reaching for one fails loudly.
  assert.match(guard, /contains a destructive or data-changing operation/);
  for (const untouched of ["sell_submissions", "marketplace_evidence_requests", "notification_outbox"]) {
    assert.ok(guard.includes(`"${untouched}"`), `the guard must name ${untouched} as untouched`);
  }
  // No secret is ever logged: the connection string, the role and the token key
  // never reach a console call.
  const logged = [...guard.matchAll(/console\.log\(([\s\S]*?)\n\s*\}, null, 2\)\);/g)].map((m) => m[1]);
  assert.equal(logged.length, 2, "exactly the preflight and applied summaries are printed");
  for (const block of logged) {
    for (const forbidden of ["NETLIFY_DB_URL", "databaseUrl", "resolvedTarget", "role", "password", "connectionString"]) {
      assert.equal(block.includes(forbidden), false, `guard output must not include ${forbidden}`);
    }
  }
  assert.equal((guard.match(/console\./g) ?? []).length, 2);
});

/**
 * The untouched-table scan, exercised rather than merely read.
 *
 * The two expressions are lifted out of the shipped script and run, because a
 * refusal that is spelled correctly but matches nothing is indistinguishable
 * from a refusal that is absent — and it is the shape a guard silently fails
 * into. Both statement forms that could modify an approved table are checked,
 * and a `REFERENCES` clause is checked to *not* match: a new foreign key
 * pointing at an existing table is what additive means.
 */
test("the guard actually refuses an ALTER or an INDEX against an approved table", () => {
  const literal = (name) => {
    const match = guard.match(new RegExp(`const ${name} = new RegExp\\(\`([^\`]+)\``));
    assert.ok(match, `the guard must build its ${name} pattern from a template literal`);
    return match[1];
  };
  const build = (name, table) =>
    new RegExp(literal(name).replace(/\\\\/g, "\\").replace("${table}", table), "i");

  for (const table of ["sell_submissions", "marketplace_contacts", "notification_outbox"]) {
    const altered = build("altered", table);
    const indexed = build("indexed", table);
    assert.equal(altered.test(`ALTER TABLE "${table}" ADD COLUMN "freshness_state" text;`), true, table);
    assert.equal(altered.test(`alter table ${table} drop column x;`), true, table);
    assert.equal(indexed.test(`CREATE INDEX "x" ON "${table}" ("id");`), true, table);
    assert.equal(indexed.test(`CREATE UNIQUE INDEX "x" ON ${table} (id);`), true, table);
    // The migration Civilon actually ships names none of them as a target.
    assert.equal(altered.test(migration), false, `${table} must not be altered by this migration`);
    assert.equal(indexed.test(migration), false, `${table} must not be indexed by this migration`);
  }
  // A foreign key pointing at an existing table is additive, not a modification,
  // so the scan must leave the migration's own FK statements alone.
  assert.match(migration, /REFERENCES "sell_submissions"\("id"\)/);
  assert.match(migration, /REFERENCES "marketplace_contacts"\("id"\)/);
});

test("the guard's expected catalog is exactly what the migration creates", () => {
  // Every column named in the migration is in the guard's expected list, with
  // the nullability the migration gives it. A column added to one and not the
  // other is exactly the drift this pairing exists to catch.
  const createTable = migration.slice(
    migration.indexOf('CREATE TABLE "sell_inventory_freshness_checks" ('),
    migration.indexOf("CONSTRAINT \"sell_inventory_freshness_checks_expiry_chk\""),
  );
  const columns = [...createTable.matchAll(/^\t"([a-z_]+)" (.*)$/gm)].map(([, name, rest]) => ({
    name,
    nullable: /NOT NULL/.test(rest) || /PRIMARY KEY/.test(rest) ? "NO" : "YES",
  }));
  assert.equal(columns.length, 15, "the table has fifteen columns");
  for (const column of columns) {
    // The enum column's expectation is built from the ENUM_NAME constant, so
    // both the literal and the template form are accepted.
    assert.match(
      guard,
      new RegExp(`(?:"|\`)${column.name}:${column.nullable}:`),
      `${column.name} must be pinned as ${column.nullable}`,
    );
  }
  // Every index and named constraint in the migration is pinned too.
  for (const [, index] of migration.matchAll(/CREATE (?:UNIQUE )?INDEX "([a-z_0-9]+)"/g)) {
    assert.ok(guard.includes(`"${index}"`), `the guard must pin ${index}`);
  }
  for (const [, constraint] of migration.matchAll(/CONSTRAINT "([A-Za-z_0-9]+)"/g)) {
    assert.ok(guard.includes(`"${constraint}"`), `the guard must pin ${constraint}`);
  }
  // …plus the primary key, which the migration declares inline.
  assert.ok(guard.includes('"sell_inventory_freshness_checks_pkey"'));
  // The enum labels are pinned in declaration order.
  assert.match(guard, /const EXPECTED_ENUM_LABELS = Object\.freeze\(\[\s*"all_available",\s*"some_changed",\s*"none_available",\s*\]\);/);
});
