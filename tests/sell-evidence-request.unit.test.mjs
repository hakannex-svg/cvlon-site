import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  SELL_EVIDENCE_REQUEST_AGGREGATE_TYPE,
  SELL_EVIDENCE_REQUEST_MESSAGE_TYPE,
  isSellEvidenceRequestCategory,
  normalizeSellEvidenceCategories,
  sellEvidenceCategoryLabels,
  sellEvidenceDeliveryState,
  sellEvidenceRequestCategories,
  sellEvidenceRequestState,
} from "../db/price-check/domain/sell-evidence-request.ts";
import {
  SELL_EVIDENCE_TOKEN_PATTERN,
  SELL_EVIDENCE_TOKEN_TTL_MS,
  deriveSellEvidenceToken,
  hashSellEvidenceToken,
  isSellEvidenceToken,
  newSellEvidenceNonce,
  sellEvidenceUrl,
} from "../lib/marketplace/sell-evidence-token.ts";
import {
  deriveSellVerificationToken,
  deriveVerificationToken,
  hashVerificationToken,
} from "../lib/marketplace/verification.ts";
import { validateSellEvidenceRequest } from "../lib/marketplace/admin/validation.ts";
import { sellEvidenceRequestEmail } from "../lib/marketplace/email/sell-evidence-templates.ts";
import {
  SELL_EVIDENCE_FRAGMENT_KEY,
  SELL_EVIDENCE_PAGE_PATH,
  SELL_EVIDENCE_SUBMIT_API_PATH,
  SELL_EVIDENCE_VIEW_API_PATH,
} from "../lib/marketplace/sell-evidence-contract.ts";
import { marketplaceNotificationHandlers, registeredNotificationTypes } from "../lib/notifications/registry.ts";
import { marketplaceCapabilities, roleCan } from "../lib/price-check/admin/policy.ts";
import { registerServerModuleHooks } from "./helpers/server-module-hooks.mjs";

// The composition layer is written for the bundler and uses the `@/*` alias, so
// it is loaded through the same hooks every other admin-composition test uses.
registerServerModuleHooks();
const { buildMarketplaceActionContext } = await import(
  "../lib/price-check/admin/marketplace-access.ts"
);

/**
 * Follow-up seller evidence — the parts that are decidable without a database.
 *
 * Everything that is a *stored* fact — what the issue transaction writes, what a
 * redeem claims, what a projection can select — is proved against real Postgres
 * in `sell-evidence-request.integration.test.mjs`. This file covers the pure
 * functions and the structural rules a running database cannot show: the exact
 * category allowlist, credential derivation and its domain separation, the
 * template's input surface, and which layer is allowed to see a plaintext token.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const repository = read("db", "price-check", "repositories", "sell-evidence-request-repository.ts");
const detailRepository = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const requestService = read("lib", "marketplace", "sell-evidence-request-service.ts");
const service = read("lib", "marketplace", "sell-evidence-service.ts");
const publicRoutes = read("lib", "marketplace", "sell-evidence-public-routes.ts");
const writeRoutes = read("lib", "marketplace", "admin", "write-routes.ts");
const handlers = read("lib", "marketplace", "email", "sell-evidence-handlers.ts");
const panel = read("components", "admin", "SellEvidenceRequestPanel.tsx");
const sellDetail = read("components", "admin", "SellSubmissionDetail.tsx");
const publicPanel = read("components", "marketplace", "SellEvidenceRequest.tsx");
const uploads = read("components", "marketplace", "SellSubmissionUploads.tsx");
const schema = read("db", "price-check", "schema.ts");
const migration = read(
  "db", "price-check", "migrations-netlify-archive",
  "20260818181459_seller_evidence_requests", "migration.sql",
);
const globalCss = read("app", "globals.css");

const KEY = "civilon-marketplace-verify-token-key-for-tests";
const OTHER_KEY = "civilon-marketplace-verify-token-key-alternate!!";

/* ---------------------------------------------------------------- categories */

test("the requestable category set is exact and excludes OTHER", () => {
  assert.deepEqual([...sellEvidenceRequestCategories], [
    "WAREHOUSE_BUSINESS_EVIDENCE",
    "CUSTODY_PART_PHOTO",
    "PART_NUMBER_SERIAL_PHOTO",
    "RELEASE_SUPPORTING_DOCUMENT",
    "INVENTORY_SPREADSHEET",
  ]);
  // `OTHER` exists in the upload policy and is deliberately not requestable:
  // "send us something else" is not an instruction a seller can act on.
  assert.equal(isSellEvidenceRequestCategory("OTHER"), false);
  assert.equal(sellEvidenceRequestCategories.includes("OTHER"), false);
  // Every requestable category has a seller-facing label, and no label claims
  // anything about what sending the file proves.
  for (const category of sellEvidenceRequestCategories) {
    assert.equal(typeof sellEvidenceCategoryLabels[category], "string");
    assert.ok(sellEvidenceCategoryLabels[category].length > 0, category);
    assert.doesNotMatch(
      sellEvidenceCategoryLabels[category],
      /certif|approv|authentic|airworth|guarantee|verified/i,
      category,
    );
  }
  assert.equal(Object.keys(sellEvidenceCategoryLabels).length, sellEvidenceRequestCategories.length);
});

test("normalisation collapses duplicates, fixes order, and refuses anything else", () => {
  // Caller order and duplicates cannot reach storage.
  assert.deepEqual(
    normalizeSellEvidenceCategories(["INVENTORY_SPREADSHEET", "CUSTODY_PART_PHOTO", "INVENTORY_SPREADSHEET"]),
    ["CUSTODY_PART_PHOTO", "INVENTORY_SPREADSHEET"],
  );
  // The same set asked for two different ways normalises identically.
  assert.deepEqual(
    normalizeSellEvidenceCategories(["RELEASE_SUPPORTING_DOCUMENT", "CUSTODY_PART_PHOTO"]),
    normalizeSellEvidenceCategories(["CUSTODY_PART_PHOTO", "RELEASE_SUPPORTING_DOCUMENT"]),
  );
  assert.deepEqual(
    normalizeSellEvidenceCategories([...sellEvidenceRequestCategories].reverse()),
    [...sellEvidenceRequestCategories],
  );

  for (const rejected of [
    [],
    ["OTHER"],
    ["custody_part_photo"],
    ["CUSTODY_PART_PHOTO", "OTHER"],
    ["CUSTODY_PART_PHOTO", ""],
    [null],
    [42],
    [{ toString: () => "CUSTODY_PART_PHOTO" }],
    [...sellEvidenceRequestCategories, "CUSTODY_PART_PHOTO"],
  ]) {
    assert.equal(normalizeSellEvidenceCategories(rejected), null, JSON.stringify(rejected));
  }
});

test("the admin payload accepts one normalised categories array and nothing else", () => {
  assert.deepEqual(
    validateSellEvidenceRequest({ categories: ["INVENTORY_SPREADSHEET", "CUSTODY_PART_PHOTO", "CUSTODY_PART_PHOTO"] }),
    { ok: true, data: { categories: ["CUSTODY_PART_PHOTO", "INVENTORY_SPREADSHEET"] } },
  );
  for (const [label, body] of [
    ["missing body", null],
    ["array body", ["CUSTODY_PART_PHOTO"]],
    ["missing field", {}],
    ["empty list", { categories: [] }],
    ["not a list", { categories: "CUSTODY_PART_PHOTO" }],
    ["unknown category", { categories: ["SOMETHING_ELSE"] }],
    ["OTHER", { categories: ["OTHER"] }],
    ["extra field", { categories: ["CUSTODY_PART_PHOTO"], sellSubmissionId: "x" }],
    ["extra field naming the credential", { categories: ["CUSTODY_PART_PHOTO"], token: "x" }],
  ]) {
    assert.equal(validateSellEvidenceRequest(body).ok, false, label);
  }
});

test("the repository normalises at its own boundary rather than trusting the caller", () => {
  // A direct repository call is not required to have gone through the admin
  // validator, so the boundary does the normalisation itself and refuses an
  // empty or invalid set outright.
  assert.match(repository, /const categories = normalizeSellEvidenceCategories\(input\.categories\);/);
  assert.match(repository, /if \(!categories\) throw new Error\("SELL_EVIDENCE_CATEGORIES_INVALID"\);/);
  assert.doesNotMatch(repository, /const categories = \[\.\.\.input\.categories\]/);
});

/* -------------------------------------------------------------- constraint */

test("the stored category constraint names exactly the domain allowlist, in schema and migration alike", () => {
  const constraint = /marketplace_evidence_requests_categories_chk/;
  assert.match(schema, constraint);
  assert.match(migration, constraint);

  // The allowlist inside the constraint is the domain list and nothing else, in
  // both the generated migration and the schema the ORM builds from.
  for (const [name, source] of [["schema", schema], ["migration", migration]]) {
    const listed = [...source.matchAll(/array\[([^\]]+)\]::varchar\(40\)\[\]/g)]
      .flatMap((match) => match[1].split(",").map((entry) => entry.trim().replace(/^'|'$/g, "")));
    assert.deepEqual(
      [...listed].sort(),
      [...sellEvidenceRequestCategories].sort(),
      `${name} allowlist must equal the domain allowlist`,
    );
    assert.equal(listed.includes("OTHER"), false, `${name} must not allow OTHER`);
    // Cardinality rejects an empty array (unlike array_length, which yields
    // NULL and would make a CHECK pass) and caps the request at the allowlist.
    assert.match(
      source,
      new RegExp(`cardinality\\((?:"requested_categories"|\\$\\{table\\.requestedCategories\\})\\) between 1 and ${sellEvidenceRequestCategories.length}`),
      name,
    );
  }
});

test("the migration and the schema agree on every evidence-request constraint", () => {
  const constraints = [...schema.matchAll(/"(marketplace_evidence_requests_[a-z_]+_chk)"/g)]
    .map((match) => match[1]);
  assert.ok(constraints.length >= 6, `expected the schema to declare the check constraints, saw ${constraints.length}`);
  for (const name of new Set(constraints)) assert.match(migration, new RegExp(`CONSTRAINT "${name}" CHECK`), name);
  // …and the indexes, including the one that allows exactly one live request.
  for (const index of [
    "marketplace_evidence_requests_hash_uidx",
    "marketplace_evidence_requests_active_uidx",
  ]) {
    assert.match(schema, new RegExp(index), index);
    assert.match(migration, new RegExp(`CREATE UNIQUE INDEX "${index}"`), index);
  }
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "marketplace_evidence_requests_active_uidx" ON "marketplace_evidence_requests" \("sell_submission_id"\) WHERE "consumed_at" is null and "revoked_at" is null/,
  );
});

/* ------------------------------------------------------------- credentials */

test("the credential is a 43-character base64url HMAC with a 14-day life", () => {
  assert.equal(SELL_EVIDENCE_TOKEN_TTL_MS, 14 * 24 * 60 * 60 * 1000);
  const nonce = newSellEvidenceNonce();
  assert.match(nonce, /^[a-f0-9]{64}$/);

  const token = deriveSellEvidenceToken(KEY, nonce);
  assert.match(token, SELL_EVIDENCE_TOKEN_PATTERN);
  assert.equal(token.length, 43);
  assert.equal(isSellEvidenceToken(token), true);
  // Deterministic in the nonce, so the handler can re-derive it at send time…
  assert.equal(deriveSellEvidenceToken(KEY, nonce), token);
  // …and nothing else is a credential.
  for (const value of [null, 42, "", "short", `${token}=`, `${token}A`, token.slice(0, 42)]) {
    assert.equal(isSellEvidenceToken(value), false, String(value));
  }
  // Two nonces never collide.
  assert.notEqual(deriveSellEvidenceToken(KEY, newSellEvidenceNonce()), token);
  // A malformed nonce is refused rather than hashed.
  assert.throws(() => deriveSellEvidenceToken(KEY, "not-a-nonce"), /SELL_EVIDENCE_NONCE_INVALID/);
  // A short key is refused rather than silently weakening the credential.
  assert.throws(() => deriveSellEvidenceToken("short", nonce), /MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE/);
  assert.throws(() => hashSellEvidenceToken("short", token), /MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE/);
});

test("what is stored is a keyed hash of the token, not the token", () => {
  const nonce = newSellEvidenceNonce();
  const token = deriveSellEvidenceToken(KEY, nonce);
  const stored = hashSellEvidenceToken(KEY, token);

  assert.match(stored, /^[a-f0-9]{64}$/);
  assert.equal(stored.includes(token), false);
  assert.equal(token.includes(stored), false);
  assert.equal(hashSellEvidenceToken(KEY, token), stored);
  // The key is required to reproduce the lookup value, so a database dump on
  // its own is not replayable.
  assert.notEqual(hashSellEvidenceToken(OTHER_KEY, token), stored);
  assert.notEqual(deriveSellEvidenceToken(OTHER_KEY, nonce), token);
});

test("the evidence credential is domain-separated from every other marketplace credential", () => {
  const nonce = newSellEvidenceNonce();
  const evidence = deriveSellEvidenceToken(KEY, nonce);

  // 1. Its own derivation label: the same nonce yields a different token on the
  //    Buy and Sell verification paths, so a verification credential simply is
  //    not a value this label can produce.
  assert.notEqual(evidence, deriveVerificationToken(KEY, nonce));
  assert.notEqual(evidence, deriveSellVerificationToken(KEY, nonce));

  // 2. Its own lookup label: even for the same token string, the stored hash
  //    lands in a namespace no other credential's hash can collide with.
  assert.notEqual(hashSellEvidenceToken(KEY, evidence), hashVerificationToken(KEY, evidence));

  // The labels are versioned and distinct from each other.
  const labels = [...repository.matchAll(/civilon-marketplace-sell-evidence-[a-z]+:v\d+/g)];
  const tokenModule = read("lib", "marketplace", "sell-evidence-token.ts");
  assert.match(tokenModule, /const DERIVE_LABEL = "civilon-marketplace-sell-evidence-token:v1"/);
  assert.match(tokenModule, /const LOOKUP_LABEL = "civilon-marketplace-sell-evidence-lookup:v1"/);
  assert.equal(labels.length, 0, "the repository never re-derives a credential");
});

test("the emailed link carries the credential in the fragment, never the query", () => {
  const token = deriveSellEvidenceToken(KEY, newSellEvidenceNonce());
  const url = sellEvidenceUrl("https://cvlon.com/", token);

  assert.equal(url, `https://cvlon.com${SELL_EVIDENCE_PAGE_PATH}#${SELL_EVIDENCE_FRAGMENT_KEY}=${encodeURIComponent(token)}`);
  const parsed = new URL(url);
  // A fragment is never transmitted, so no access log, CDN log, Referer header
  // or analytics page-path can contain it.
  assert.equal(parsed.search, "");
  assert.equal(parsed.pathname, SELL_EVIDENCE_PAGE_PATH);
  assert.equal(parsed.hash, `#${SELL_EVIDENCE_FRAGMENT_KEY}=${encodeURIComponent(token)}`);
  assert.equal(parsed.searchParams.has(SELL_EVIDENCE_FRAGMENT_KEY), false);
});

test("only the request service ever holds a plaintext credential", () => {
  // Minted, hashed, and dropped in one function. Never returned, never logged.
  assert.match(requestService, /const keyedTokenHash = hashSellEvidenceToken\(key, deriveSellEvidenceToken\(key, nonce\)\);/);
  assert.doesNotMatch(requestService, /console\./);
  for (const [name, source] of [
    ["repository", repository],
    ["admin write routes", writeRoutes],
    ["admin panel", panel],
    ["Sell detail", sellDetail],
  ]) {
    assert.doesNotMatch(source, /deriveSellEvidenceToken|sellEvidenceUrl/, name);
  }
  // The one other place a plaintext token exists is the send path, and it
  // re-derives from the stored nonce rather than reading a stored token.
  assert.match(handlers, /deriveSellEvidenceToken\(\s*marketplaceVerifyTokenKey\(\),\s*delivery\.tokenDerivationNonce,\s*\)/);
  assert.doesNotMatch(handlers, /console\./);
});

/* ---------------------------------------------------------------- template */

test("the seller email is privacy-minimised and states its own boundaries", () => {
  const message = sellEvidenceRequestEmail({
    from: "sales@cvlon.com",
    to: "seller@example.com",
    reference: "SS-2ABCD3EFGH",
    categories: ["CUSTODY_PART_PHOTO", "RELEASE_SUPPORTING_DOCUMENT"],
    evidenceUrl: `https://cvlon.com${SELL_EVIDENCE_PAGE_PATH}#${SELL_EVIDENCE_FRAGMENT_KEY}=abc`,
    expiresAt: new Date("2026-09-01T00:00:00Z"),
  });
  const body = `${message.subject}\n${message.textBody}\n${message.htmlBody}\n${JSON.stringify(message.metadata)}`;

  assert.equal(message.to, "seller@example.com");
  assert.equal(message.tag, "civilon-sell-evidence-request");
  // The reference is the only record identifier anywhere in the message, and it
  // is one the seller already has.
  assert.deepEqual(message.metadata, { reference: "SS-2ABCD3EFGH" });
  assert.match(message.textBody, /Part or condition photo/);
  assert.match(message.textBody, /Supporting documentation/);
  // Nothing about the offer itself: the template is not handed a part number,
  // quantity, price, currency, location, company or filename, so it cannot leak
  // one. A category that was not requested does not appear either.
  assert.doesNotMatch(body, /Inventory list|Warehouse or business evidence/);
  for (const forbidden of ["partNumber", "part number", "quantity", "currency", "USD", "inventory"]) {
    assert.equal(body.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
  // "price" appears exactly once, and only to deny that one has been agreed.
  assert.equal((body.match(/price/gi) ?? []).length, 2, "price appears only in the boundary line, once per body");
  assert.match(message.textBody, /Nothing in this email is an offer, an acceptance, or an agreed price\./);
  // No money figure of any kind.
  assert.doesNotMatch(body, /[$€£]\s?\d|\d+(\.\d{2})?\s?(USD|EUR|GBP)/);
  // The link is a fragment credential.
  assert.match(message.textBody, new RegExp(`${SELL_EVIDENCE_PAGE_PATH}#${SELL_EVIDENCE_FRAGMENT_KEY}=`));
  assert.match(message.htmlBody, /href="https:\/\/cvlon\.com\/buy-sell-aircraft-parts\/sell\/evidence#token=abc"/);

  // Every boundary the message must carry, in both bodies.
  for (const claim of [
    /optional evidence/i,
    /nothing you send here is published, listed, or shown to a buyer/i,
    /not obliged to buy/i,
    /Documentation varies by part and source/i,
    /not a guarantee of authenticity or fitness/i,
    /does not create an account/i,
  ]) {
    assert.match(message.textBody, claim, `text: ${claim}`);
    assert.match(message.htmlBody, claim, `html: ${claim}`);
  }
  // …and none of the things it must never claim.
  assert.doesNotMatch(body, /verified supplier|approved supplier|certified|airworthiness approval of|we guarantee/i);
});

test("the template escapes every value it interpolates", () => {
  const message = sellEvidenceRequestEmail({
    from: "sales@cvlon.com",
    to: "seller@example.com",
    reference: 'SS-<script>"&\'',
    categories: ["CUSTODY_PART_PHOTO"],
    evidenceUrl: 'https://cvlon.com/x#token="><script>',
    expiresAt: new Date("2026-09-01T00:00:00Z"),
  });
  assert.doesNotMatch(message.htmlBody, /<script>/);
  assert.match(message.htmlBody, /&lt;script&gt;/);
});

/* ---------------------------------------------------------------- delivery */

test("the notification handler is registered and owns its own aggregate", () => {
  assert.ok(
    registeredNotificationTypes(marketplaceNotificationHandlers).includes(SELL_EVIDENCE_REQUEST_MESSAGE_TYPE),
    "the evidence request message type must have an owner",
  );
  const handler = marketplaceNotificationHandlers.find(
    (entry) => entry.messageType === SELL_EVIDENCE_REQUEST_MESSAGE_TYPE,
  );
  assert.ok(handler, "handler registered");
  assert.equal(handler.workflow, "marketplace");
  // Keyed to the request, not the submission, so a reissue cannot cause an
  // older queued message to go out carrying the newer request's link.
  assert.equal(handler.aggregateType, SELL_EVIDENCE_REQUEST_AGGREGATE_TYPE);
  assert.equal(handler.aggregateType, "sell_evidence_request");
  assert.equal(typeof handler.deliver, "function");
  assert.equal(typeof handler.recordFailure, "function");
});

test("delivery is reported from the outbox state and never assumed", () => {
  assert.deepEqual(
    ["pending", "running", "succeeded", "failed", "dead_letter"].map(sellEvidenceDeliveryState),
    ["queued", "sending", "delivered", "retrying", "undeliverable"],
  );
  // No row, or a state this build does not know, is reported as unknown rather
  // than guessed as sent.
  for (const unknown of [null, undefined, "", "invented_state"]) {
    assert.equal(sellEvidenceDeliveryState(unknown), "unrecorded", String(unknown));
  }
});

test("the admin surfaces distinguish a recorded request from a delivered email", () => {
  // The route knows one delivery fact and says exactly that.
  const start = writeRoutes.indexOf("export function createEvidenceRequestRoute(");
  const body = writeRoutes.slice(start, writeRoutes.indexOf("\n}\n", start));
  assert.match(body, /delivery: "queued"/);
  assert.doesNotMatch(body, /has been emailed|Request sent|email(ed)? the seller/i);

  // The panel derives its email row from the stored outbox state, and its
  // success notice claims a recording and a queue, not a delivery.
  assert.match(panel, /delivery: SellEvidenceDeliveryState/);
  assert.match(panel, /setNotice\("Request recorded and the email queued\./);
  assert.doesNotMatch(panel, /The seller has been emailed/);
  assert.doesNotMatch(panel, /setNotice\("Request sent\./);
  assert.match(panel, /delivered: "Email accepted"/);
  assert.match(panel, /That is not a read receipt/);
  // Every delivery state the domain defines has a label and a detail line, so
  // an unmapped state cannot render as blank.
  for (const state of ["queued", "sending", "delivered", "retrying", "undeliverable", "unrecorded"]) {
    assert.match(panel, new RegExp(`${state}: "`), state);
  }
  assert.match(sellDetail, /delivery: sellEvidenceDeliveryState\(detail\.evidenceRequest\.deliveryState\)/);
});

test("a superseded request's queued email is terminalised rather than retried", () => {
  const start = repository.indexOf("export async function issueSellEvidenceRequest(");
  const body = repository.slice(start, repository.indexOf("\nexport ", start + 10));
  // Inside the same transaction that revokes the credential.
  assert.match(body, /state: "dead_letter"/);
  assert.match(body, /sanitizedFailureCode: SELL_EVIDENCE_SUPERSEDED_CODE/);
  assert.match(body, /inArray\(notificationOutbox\.state, \["pending", "failed"\]\)/);
  assert.ok(
    body.indexOf(".update(notificationOutbox)") > body.indexOf("const [superseded]"),
    "the outbox row is only terminalised once the credential is actually revoked",
  );
  assert.match(body, /eq\(notificationOutbox\.aggregateId, superseded\.id\)/);
  // A running row belongs to a worker holding the lease and is never taken; a
  // succeeded row is history and is never rewritten.
  assert.doesNotMatch(body, /notificationOutbox\.state, \["pending", "failed", "running"\]/);

  // The handler still refuses to load a request that is no longer live, which
  // is what protects a message that was already leased.
  assert.match(
    repository,
    /if \(record\.consumedAt \|\| record\.revokedAt \|\| record\.expiresAt\.valueOf\(\) <= now\.valueOf\(\)\) \{\s*throw new Error\("SELL_EVIDENCE_REQUEST_UNAVAILABLE"\);/,
  );
});

/* ------------------------------------------------------------- projections */

test("the staff projection cannot select a credential or a recipient address", () => {
  const start = detailRepository.indexOf("export type SellEvidenceRequestSummary = {");
  const summary = detailRepository.slice(start, detailRepository.indexOf("};", start));
  for (const forbidden of [
    "keyedTokenHash", "tokenDerivationNonce", "keyed_token_hash", "token_derivation_nonce",
    "businessEmail", "recipientReference", "idempotencyKey", "providerMessageId", "evidenceUrl",
  ]) {
    assert.equal(summary.includes(forbidden), false, `summary must not carry ${forbidden}`);
  }
  // …and the query behind it selects none of them either.
  const query = detailRepository.slice(
    detailRepository.indexOf("id: marketplaceEvidenceRequests.id,"),
    detailRepository.indexOf(".limit(1),", detailRepository.indexOf("id: marketplaceEvidenceRequests.id,")),
  );
  for (const forbidden of [
    "keyedTokenHash", "tokenDerivationNonce", "recipientReference", "idempotencyKey", "providerMessageId",
  ]) {
    assert.equal(query.includes(forbidden), false, `query must not select ${forbidden}`);
  }
  assert.match(query, /deliveryState: notificationOutbox\.state/);
  // The read repository stays read-only even now that it joins the outbox.
  assert.doesNotMatch(detailRepository, /db\.insert|db\.update|db\.delete|\.transaction\(/);
});

test("the seller-facing view is told only the reference, the categories and the expiry", () => {
  const start = publicRoutes.indexOf("export async function POST_sellEvidenceView(");
  const body = publicRoutes.slice(start, publicRoutes.indexOf("\nfunction handleList", start));
  assert.match(body, /reference: snapshot\.publicReference/);
  assert.match(body, /categories: snapshot\.categories/);
  assert.match(body, /expiresAt: snapshot\.expiresAt\.toISOString\(\)/);
  for (const forbidden of ["sellSubmissionId", "evidenceRequestId", "contactId", "businessEmail", "status"]) {
    assert.equal(body.includes(forbidden), false, `the view response must not carry ${forbidden}`);
  }
  // Reading is not spending: nothing in the view path consumes anything.
  assert.doesNotMatch(body, /redeem|consume/i);
  assert.match(service, /export async function viewSellEvidenceRequest\(/);
  const view = service.slice(
    service.indexOf("export async function viewSellEvidenceRequest("),
    service.indexOf("export type SellEvidenceSubmitResult"),
  );
  assert.match(view, /dependencies\.findLive\(/);
  assert.doesNotMatch(view, /dependencies\.redeem|prepareAttachments/);
});

/* --------------------------------------------------------------- authority */

test("asking a seller for evidence is its own capability, and AUDITOR never has it", () => {
  assert.ok(marketplaceCapabilities.includes("request_marketplace_evidence"));
  for (const role of ["ANALYST", "REVIEWER", "ADMIN"]) {
    assert.equal(roleCan(role, "request_marketplace_evidence"), true, role);
  }
  // AUDITOR reads and nothing else.
  assert.equal(roleCan("AUDITOR", "request_marketplace_evidence"), false);
  assert.equal(roleCan("AUDITOR", "view_marketplace"), true);
  assert.equal(
    buildMarketplaceActionContext({ role: "AUDITOR", aggregate: "sell_submission", status: "verified" }).canRequestEvidence,
    false,
  );
  assert.equal(
    buildMarketplaceActionContext({ role: "ANALYST", aggregate: "sell_submission", status: "verified" }).canRequestEvidence,
    true,
  );
  // The route enforces it before it reads a body or imports a repository.
  const start = writeRoutes.indexOf("export function createEvidenceRequestRoute(");
  const body = writeRoutes.slice(start, writeRoutes.indexOf("\n}\n", start));
  assert.match(body, /requireStaffApi\("request_marketplace_evidence"\)/);
  assert.ok(
    body.indexOf("verifyAdminMutationOrigin(request)") < body.indexOf("readJsonBody"),
    "origin is verified before the body is read",
  );
});

/* ---------------------------------------------------------------- lifecycle */

test("the request lifecycle is derived from the stored timestamps", () => {
  const now = new Date("2026-08-18T12:00:00Z");
  const live = { consumedAt: null, revokedAt: null, expiresAt: new Date("2026-09-01T00:00:00Z") };
  assert.equal(sellEvidenceRequestState(live, now), "awaiting_seller");
  assert.equal(sellEvidenceRequestState({ ...live, consumedAt: now }, now), "submitted");
  assert.equal(sellEvidenceRequestState({ ...live, revokedAt: now }, now), "revoked");
  assert.equal(sellEvidenceRequestState({ ...live, expiresAt: now }, now), "expired");
  // Consumption outranks expiry: files that arrived before the link lapsed are
  // still files that arrived.
  assert.equal(
    sellEvidenceRequestState({ consumedAt: now, revokedAt: null, expiresAt: now }, now),
    "submitted",
  );
});

/* ------------------------------------------------------------------- pages */

test("the account-free page degrades instead of crashing on an unusable category list", () => {
  // A stored list that names nothing this build can offer produces the ordinary
  // refusal, not a page with a heading and no file control.
  assert.match(publicPanel, /if \(!request \|\| options\.length === 0\) return <UnavailablePanel \/>;/);
  assert.match(publicPanel, /function UnavailablePanel\(\)/);
  // The upload control never indexes an empty option list.
  assert.doesNotMatch(uploads, /useState<SellUploadPurpose>\(options\[0\]!\.value\)/);
  assert.match(uploads, /options\[0\]\?\.value \?\? sellUploadOptions\[0\]!\.value/);
  assert.match(uploads, /if \(options\.length === 0\) return null;/);
  // The credential is never rendered, never written back to the URL and never
  // given to analytics.
  assert.match(publicPanel, /window\.history\.replaceState\(null, "", SELL_EVIDENCE_PAGE_PATH\)/);
  for (const event of ["sell_evidence_request_opened", "sell_evidence_request_submitted"]) {
    assert.match(publicPanel, new RegExp(`trackCivilonEvent\\("${event}", \\{\\s*source_page: SELL_EVIDENCE_PAGE_PATH,\\s*\\}\\)`), event);
  }
  assert.doesNotMatch(publicPanel, /token: token\.current[^}]*source_page|source_page:[^}]*token/);
});

test("the account-free surface is labelled and announces its own state", () => {
  assert.match(publicPanel, /role="status" aria-live="polite"/);
  assert.match(publicPanel, /<p className="field-error" role="alert">/);
  assert.match(publicPanel, /aria-labelledby="sell-evidence-asked-for"/);
  assert.match(panel, /aria-label="Follow-up evidence request"/);
  assert.match(panel, /aria-label="Latest evidence request"/);
  assert.match(panel, /className="admin-error" role="alert"/);
  assert.match(panel, /className="admin-success" role="status"/);
  // Every checkbox is bound to its label.
  assert.match(panel, /htmlFor={`evidence-request-\$\{category\}`}/);
  assert.match(panel, /id={`evidence-request-\$\{category\}`}/);
});

test("every class the two new surfaces use is actually styled", () => {
  const classes = [
    "admin-evidence-request-form",
    "marketplace-evidence-request-list",
    "admin-definition-grid",
    "admin-panel",
    "admin-status",
    "admin-error",
    "admin-success",
    "marketplace-verify-panel",
  ];
  for (const name of classes) {
    assert.ok(globalCss.includes(`.${name}`), `.${name} must exist in globals.css`);
  }
  // The wide definition-grid cell uses the class the stylesheet defines, not a
  // near-miss that silently does nothing.
  assert.match(panel, /className="wide"/);
  assert.doesNotMatch(panel, /className="is-wide"/);
  assert.ok(globalCss.includes(".admin-definition-grid .wide"));
  // Every state badge the panel can render has a rule.
  for (const state of ["awaiting_seller", "submitted", "expired", "revoked"]) {
    assert.ok(globalCss.includes(`.admin-status.evidence-request-${state}`), state);
  }
  for (const state of ["queued", "sending", "delivered", "retrying", "undeliverable", "unrecorded"]) {
    assert.ok(globalCss.includes(`.admin-status.evidence-delivery-${state}`), state);
  }
});

test("a single-part record never pre-selects a bulk inventory list", () => {
  // Staff may still tick it deliberately — the checkbox is always offered —
  // but the default ask for one part must not be "send us your inventory".
  assert.match(sellDetail, /\(bulk \|\| category !== "INVENTORY_SPREADSHEET"\)/);
  assert.match(panel, /sellEvidenceRequestCategories\.map\(\(category\) =>/);
  assert.match(panel, /useState<SellEvidenceRequestCategory\[\]>\(\[\.\.\.missingCategories\]\)/);
});

/* -------------------------------------------------------------- API surface */

test("both public endpoints are POST-only and take the credential in the body", () => {
  for (const [name, source] of [
    ["view", read("app", "api", "marketplace", "sell-evidence", "view", "route.ts")],
    ["submit", read("app", "api", "marketplace", "sell-evidence", "submit", "route.ts")],
  ]) {
    assert.match(source, /export const runtime = "nodejs";/, name);
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.match(source, new RegExp(`export const ${method} = sellEvidenceMethodNotAllowed;`), `${name}: ${method}`);
    }
  }
  assert.equal(SELL_EVIDENCE_VIEW_API_PATH, "/api/marketplace/sell-evidence/view");
  assert.equal(SELL_EVIDENCE_SUBMIT_API_PATH, "/api/marketplace/sell-evidence/submit");
  // The credential is read from the body, never from a path or query string.
  assert.match(publicRoutes, /typeof parsed\.token !== "string"/);
  assert.doesNotMatch(publicRoutes, /searchParams|request\.url/);
  // Every response is private and unindexable.
  assert.match(publicRoutes, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(publicRoutes, /"X-Robots-Tag": "noindex, nofollow, noarchive"/);
  assert.match(publicRoutes, /"Referrer-Policy": "no-referrer"/);
});
