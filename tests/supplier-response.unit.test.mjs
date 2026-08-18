import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_SUPPLIER_AVAILABILITY,
  DEFAULT_SUPPLIER_RESPONSE_STATUS,
  canTransitionSupplierResponse,
  isSupplierResponseTerminal,
  supplierAvailabilityStates,
  supplierConditionCodes,
  supplierResponseCurrencies,
  supplierResponseStatusValues,
  supplierResponseTargets,
  supplierResponseTerminalStatuses,
  supplierSourceKinds,
} from "../db/price-check/domain/supplier-response-policy.ts";
import {
  SUPPLIER_LEAD_TIME_MAX_DAYS,
  SUPPLIER_NAME_MAX,
  SUPPLIER_TEXT_MAX,
  validateSupplierResponse,
  validateSupplierResponseStatus,
} from "../lib/marketplace/admin/supplier-validation.ts";
import { supplierResponses, marketplaceContacts } from "../db/price-check/schema.ts";
import { roleCan } from "../lib/price-check/admin/policy.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const repo = read("db", "price-check", "repositories", "supplier-response-repository.ts");
const routesLib = read("lib", "marketplace", "admin", "supplier-routes.ts");
const panel = read("components", "admin", "SupplierResponseActions.tsx");
const buyDetail = read("components", "admin", "BuyRequestDetail.tsx");
const detailRepo = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const createRoute = read("app", "api", "admin", "marketplace", "buy-requests", "[id]", "supplier-responses", "route.ts");
const statusRoute = read("app", "api", "admin", "marketplace", "buy-requests", "[id]", "supplier-responses", "[responseId]", "status", "route.ts");

const ULID = "0123456789ABCDEFGHJKMNP0TV";
const nonregistered = { supplierKind: "nonregistered_supplier", supplierNameSnapshot: "Acme Rotables Ltd" };

/* ------------------------------------------------------------------ policy */

test("the policy vocabularies match the schema enums exactly", () => {
  assert.deepEqual([...supplierResponseStatusValues], [...supplierResponses.status.enumValues]);
  assert.deepEqual([...supplierSourceKinds], [...supplierResponses.supplierKind.enumValues]);
  assert.deepEqual([...supplierAvailabilityStates], [...supplierResponses.availabilityState.enumValues]);
  assert.deepEqual([...supplierConditionCodes], [...marketplaceContacts.id ? supplierResponses.statedCondition.enumValues : []]);
  assert.equal(DEFAULT_SUPPLIER_RESPONSE_STATUS, "received");
  assert.equal(DEFAULT_SUPPLIER_AVAILABILITY, "subject_to_confirmation");
  // The schema's own default is the same, so an omitted claim records no claim.
  assert.equal(supplierResponses.availabilityState.default, "subject_to_confirmation");
  assert.equal(supplierResponses.status.default, "received");
});

test("the full transition matrix is exactly the declared graph", () => {
  const expected = {
    received: ["under_review", "shortlisted", "declined", "withdrawn", "expired"],
    under_review: ["shortlisted", "declined", "withdrawn", "expired"],
    shortlisted: ["selected", "declined", "withdrawn", "expired"],
    selected: ["declined", "withdrawn", "expired"],
    declined: [], withdrawn: [], expired: [],
  };
  for (const from of supplierResponseStatusValues) {
    assert.deepEqual([...supplierResponseTargets(from)], expected[from], from);
    for (const to of supplierResponseStatusValues) {
      assert.equal(canTransitionSupplierResponse(from, to), expected[from].includes(to), `${from} -> ${to}`);
    }
    // No self-transition anywhere.
    assert.equal(canTransitionSupplierResponse(from, from), false, from);
  }
});

test("terminal supplier responses cannot be resurrected", () => {
  assert.deepEqual([...supplierResponseTerminalStatuses], ["declined", "withdrawn", "expired"]);
  for (const terminal of supplierResponseTerminalStatuses) {
    assert.equal(isSupplierResponseTerminal(terminal), true);
    assert.deepEqual([...supplierResponseTargets(terminal)], []);
    for (const to of supplierResponseStatusValues) {
      assert.equal(canTransitionSupplierResponse(terminal, to), false, `${terminal} -> ${to}`);
    }
  }
  for (const open of ["received", "under_review", "shortlisted", "selected"]) {
    assert.equal(isSupplierResponseTerminal(open), false, open);
  }
  // An unknown state is a dead end, never a default.
  assert.deepEqual([...supplierResponseTargets("not_a_status")], []);
  assert.equal(canTransitionSupplierResponse("not_a_status", "selected"), false);
});

/* -------------------------------------------------------------- validation */

test("the nonregistered path needs only a supplier name", () => {
  const result = validateSupplierResponse(nonregistered);
  assert.equal(result.ok, true);
  assert.equal(result.data.supplierKind, "nonregistered_supplier");
  assert.equal(result.data.supplierContactId, null);
  assert.equal(result.data.supplierNameSnapshot, "Acme Rotables Ltd");
  // Everything else is optional and defaults conservatively.
  assert.equal(result.data.supplierUnitCost, null);
  assert.equal(result.data.currencyCode, null);
  assert.equal(result.data.quoteOnRequest, true, "no cost means quote on request");
  assert.equal(result.data.availabilityState, "subject_to_confirmation");
  assert.equal(result.data.supplierContactSnapshot, null);
  assert.equal(result.data.supplierCountry, null);
  assert.equal(result.data.expiresAt, null);
});

test("the registered path needs a contact id and refuses a stray one", () => {
  const ok = validateSupplierResponse({ supplierKind: "registered_contact", supplierContactId: ULID });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.supplierContactId, ULID);

  for (const [label, body] of [
    ["missing contact", { supplierKind: "registered_contact" }],
    ["null contact", { supplierKind: "registered_contact", supplierContactId: null }],
    ["malformed contact", { supplierKind: "registered_contact", supplierContactId: "nope" }],
    ["lowercase contact", { supplierKind: "registered_contact", supplierContactId: ULID.toLowerCase() }],
  ]) {
    assert.equal(validateSupplierResponse(body).ok, false, label);
  }
  // A nonregistered supplier may not carry a registered contact id.
  assert.equal(validateSupplierResponse({ ...nonregistered, supplierContactId: ULID }).ok, false);
  // …and must have a name.
  assert.equal(validateSupplierResponse({ supplierKind: "nonregistered_supplier" }).ok, false);
  assert.equal(validateSupplierResponse({ supplierKind: "nonregistered_supplier", supplierNameSnapshot: "   " }).ok, false);
  assert.equal(validateSupplierResponse({ supplierKind: "bogus", supplierNameSnapshot: "x" }).ok, false);
});

test("pricing follows the schema's cost, currency and quote-on-request rules", () => {
  const priced = validateSupplierResponse({ ...nonregistered, supplierUnitCost: "1800.50", currencyCode: "USD" });
  assert.equal(priced.ok, true);
  assert.equal(priced.data.supplierUnitCost, "1800.5");
  assert.equal(priced.data.currencyCode, "USD");
  assert.equal(priced.data.quoteOnRequest, false, "a stated cost is not a quote on request");

  // A cost without a currency is a number nobody can act on.
  assert.equal(validateSupplierResponse({ ...nonregistered, supplierUnitCost: "1800" }).ok, false);
  // quote_on_request false with no cost violates the schema check.
  assert.equal(validateSupplierResponse({ ...nonregistered, quoteOnRequest: false }).ok, false);
  // An explicit quote-on-request alongside a cost is allowed and honoured.
  const both = validateSupplierResponse({ ...nonregistered, supplierUnitCost: "10", currencyCode: "EUR", quoteOnRequest: true });
  assert.equal(both.data.quoteOnRequest, true);

  for (const [label, body] of [
    ["negative cost", { ...nonregistered, supplierUnitCost: "-1", currencyCode: "USD" }],
    ["absurd cost", { ...nonregistered, supplierUnitCost: "999999999999", currencyCode: "USD" }],
    ["non-numeric cost", { ...nonregistered, supplierUnitCost: "free", currencyCode: "USD" }],
    ["unsupported currency", { ...nonregistered, supplierUnitCost: "10", currencyCode: "BTC" }],
    ["negative quantity", { ...nonregistered, quantityAvailable: "-2" }],
    ["non-boolean quote", { ...nonregistered, quoteOnRequest: "yes" }],
  ]) {
    assert.equal(validateSupplierResponse(body).ok, false, label);
  }
  for (const currency of supplierResponseCurrencies) {
    assert.equal(validateSupplierResponse({ ...nonregistered, supplierUnitCost: "5", currencyCode: currency }).ok, true, currency);
  }
});

test("every enum value is accepted and every non-value refused", () => {
  for (const state of supplierAvailabilityStates) {
    const result = validateSupplierResponse({ ...nonregistered, availabilityState: state });
    assert.equal(result.ok, true, state);
    assert.equal(result.data.availabilityState, state);
  }
  assert.equal(validateSupplierResponse({ ...nonregistered, availabilityState: "civilon_confirmed" }).ok, false);
  assert.equal(validateSupplierResponse({ ...nonregistered, availabilityState: "guaranteed" }).ok, false);

  for (const code of supplierConditionCodes) {
    assert.equal(validateSupplierResponse({ ...nonregistered, statedCondition: code }).ok, true, code);
  }
  assert.equal(validateSupplierResponse({ ...nonregistered, statedCondition: "CERTIFIED" }).ok, false);
});

test("text, country, lead time and expiry are bounded and normalised", () => {
  const result = validateSupplierResponse({
    ...nonregistered,
    supplierCountry: "gb",
    offeredPartNumber: "  BR-PART-4100  ",
    locationText: " London hub ",
    leadTimeDays: 14,
    documentsSummary: "Trace paperwork on file",
    shippingNotes: "Can ship direct",
    expiresAt: "2026-09-01T00:00:00Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.supplierCountry, "GB", "country is upper-cased");
  assert.equal(result.data.offeredPartNumber, "BR-PART-4100", "text is trimmed");
  assert.equal(result.data.locationText, "London hub");
  assert.equal(result.data.leadTimeDays, 14);
  assert.ok(result.data.expiresAt instanceof Date);

  const NUL = String.fromCharCode(0);
  for (const [label, body] of [
    ["three-letter country", { ...nonregistered, supplierCountry: "GBR" }],
    ["numeric country", { ...nonregistered, supplierCountry: "12" }],
    ["over-long name", { ...nonregistered, supplierNameSnapshot: "a".repeat(SUPPLIER_NAME_MAX + 1) }],
    ["over-long documents", { ...nonregistered, documentsSummary: "a".repeat(SUPPLIER_TEXT_MAX + 1) }],
    ["control character", { ...nonregistered, documentsSummary: `a${NUL}b` }],
    ["fractional lead time", { ...nonregistered, leadTimeDays: 1.5 }],
    ["negative lead time", { ...nonregistered, leadTimeDays: -1 }],
    ["absurd lead time", { ...nonregistered, leadTimeDays: SUPPLIER_LEAD_TIME_MAX_DAYS + 1 }],
    ["bad expiry", { ...nonregistered, expiresAt: "not-a-date" }],
    ["numeric name", { ...nonregistered, supplierNameSnapshot: 12 }],
  ]) {
    assert.equal(validateSupplierResponse(body).ok, false, label);
  }
});

test("unknown keys are rejected, including anything file-shaped", () => {
  assert.equal(validateSupplierResponse(null).ok, false);
  assert.equal(validateSupplierResponse([]).ok, false);
  assert.equal(validateSupplierResponse("x").ok, false);
  for (const key of [
    "attachmentHandles", "objectKey", "file", "upload", "receivedAt", "status",
    "recordedByAdminUserId", "buyRequestId", "id", "normalizedPartNumber",
  ]) {
    assert.equal(validateSupplierResponse({ ...nonregistered, [key]: "x" }).ok, false, key);
  }
});

test("supplier response status validation is strict", () => {
  assert.deepEqual(
    validateSupplierResponseStatus({ expectedStatus: "received", to: "shortlisted" }),
    { ok: true, data: { expectedStatus: "received", to: "shortlisted" } },
  );
  for (const [label, body] of [
    ["missing body", null],
    ["unknown key", { expectedStatus: "received", to: "shortlisted", force: true }],
    ["missing expected", { to: "shortlisted" }],
    ["unknown status", { expectedStatus: "received", to: "accepted" }],
    ["aggregate status", { expectedStatus: "received", to: "sourcing" }],
    ["no-op", { expectedStatus: "received", to: "received" }],
  ]) {
    assert.equal(validateSupplierResponseStatus(body).ok, false, label);
  }
});

/* ------------------------------------------------------------------ routes */

test("both routes are node runtime, POST only, staff-gated and origin-checked", () => {
  for (const [name, source] of [["create", createRoute], ["status", statusRoute]]) {
    assert.match(source, /export const runtime = "nodejs"/, name);
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.match(source, new RegExp(`export const ${method} = supplierMethodNotAllowed;`), `${name}: ${method}`);
    }
  }
  assert.match(createRoute, /export const POST = POST_supplierResponse;/);
  assert.match(statusRoute, /export const POST = POST_supplierResponseStatus;/);
  assert.equal((routesLib.match(/requireStaffApi\("record_supplier_response"\)/g) ?? []).length, 2);
  assert.equal((routesLib.match(/verifyAdminMutationOrigin\(request\)/g) ?? []).length, 2);
  assert.match(routesLib, /headers\.set\("Allow", "POST"\)/);
  // The origin is checked before the body is read, on both handlers.
  for (const handler of ["POST_supplierResponse", "POST_supplierResponseStatus"]) {
    const start = routesLib.indexOf(`export async function ${handler}(`);
    const body = routesLib.slice(start, routesLib.indexOf("\n}\n", start));
    assert.ok(body.indexOf("verifyAdminMutationOrigin(request)") < body.indexOf("readJsonBody"), handler);
  }
});

test("the routes are parent-bound, private and flag-free", () => {
  assert.match(routesLib, /if \(!isRecordId\(id\)\) return privateJson/);
  assert.match(routesLib, /if \(!isRecordId\(id\) \|\| !isRecordId\(responseId\)\)/);
  assert.match(routesLib, /buyRequestId: id,\s*supplierResponseId: responseId,/);
  for (const source of [routesLib, createRoute, statusRoute, repo, panel]) {
    assert.doesNotMatch(source, /isPriceCheckEnabled|isMarketplaceEnabled|isSellSubmissionEnabled|NEXT_PUBLIC_|process\.env/);
    assert.doesNotMatch(source, /getPriceCheckAdminAccess|requireAdminApi/);
  }
  // Generic errors only; no driver or provider detail escapes.
  assert.doesNotMatch(routesLib, /error\.message|String\(error\)|console\./);
  assert.equal((routesLib.match(/return new Response\(/g) ?? []).length, 1);
});

test("AUDITOR cannot record a supplier response; working roles can", () => {
  assert.equal(roleCan("AUDITOR", "record_supplier_response"), false);
  for (const role of ["ANALYST", "REVIEWER", "ADMIN"]) {
    assert.equal(roleCan(role, "record_supplier_response"), true, role);
  }
});

/* ------------------------------------------------------ containment / leaks */

test("nothing here writes a buyer offer, the Buy Request, or the outbox", () => {
  for (const source of [repo, routesLib, panel]) {
    assert.doesNotMatch(source, /buyerOffers|civilonSaleUnitPrice|deliveryOption/);
    assert.doesNotMatch(source, /notificationOutbox|enqueueNotification|PostmarkTransactionalEmailProvider|TransactionalEmail|sendMail/);
  }
  // The repository reads the Buy Request only to confirm the parent exists.
  assert.match(repo, /const \[parent\] = await db\.select\(\{ id: buyRequests\.id \}\)/);
  assert.doesNotMatch(repo, /update\(buyRequests\)|insert\(buyRequests\)|delete\(buyRequests\)/);
  assert.doesNotMatch(repo, /update\(marketplaceContacts\)|insert\(marketplaceContacts\)/);
  // Exactly two transactions, each with its own audit append.
  assert.equal((repo.match(/return db\.transaction\(async \(tx\) => \{/g) ?? []).length, 2);
  assert.equal((repo.match(/await appendAudit\(tx, \{/g) ?? []).length, 2);
  assert.match(repo, /await tx\.insert\(auditEvents\)\.values\(\{/);
});

test("supplier data is reachable only from the authenticated admin surfaces", () => {
  // The whole repository tree: nothing outside the admin read/write path may
  // select from supplier_responses.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      if (/supplierResponses|supplierUnitCost|supplierNameSnapshot|supplierContactSnapshot/.test(source)) offenders.push(rel);
    }
  };
  for (const dir of ["app", "components", "lib", "db"]) walk(dir);

  const allowed = new Set([
    "db/price-check/schema.ts",
    "db/price-check/domain/supplier-response-policy.ts",
    "db/price-check/repositories/supplier-response-repository.ts",
    "db/price-check/repositories/marketplace-admin-repository.ts",
    // Slice 6: validates that the internal offer pointer belongs to the same
    // Buy Request, and labels the internal picker. It reads no supplier cost.
    "db/price-check/repositories/buyer-offer-repository.ts",
    "lib/marketplace/admin/supplier-validation.ts",
    "lib/marketplace/admin/supplier-routes.ts",
    "components/admin/BuyRequestDetail.tsx",
    "components/admin/SupplierResponseActions.tsx",
    "app/api/admin/marketplace/buy-requests/[id]/supplier-responses/route.ts",
    "app/api/admin/marketplace/buy-requests/[id]/supplier-responses/[responseId]/status/route.ts",
  ]);
  const unexpected = offenders.filter((file) => !allowed.has(file));
  assert.deepEqual(unexpected, [], `supplier data reached: ${unexpected.join(", ")}`);

  // Specifically: no public page, no public API, no e-mail template.
  for (const file of offenders) {
    assert.doesNotMatch(file, /^app\/api\/marketplace\//, file);
    assert.doesNotMatch(file, /^app\/buy-sell-aircraft-parts\//, file);
    assert.doesNotMatch(file, /^components\/marketplace\//, file);
    assert.doesNotMatch(file, /email/, file);
  }
});

test("the buyer-offer projection and block still carry no supplier field", () => {
  const start = detailRepo.indexOf("export type BuyerOfferRecord = {");
  const type = detailRepo.slice(start, detailRepo.indexOf("};", start));
  assert.doesNotMatch(type, /supplier/i);

  const blockStart = buyDetail.indexOf('aria-label="Civilon buyer offers"');
  const blockEnd = buyDetail.indexOf("<MarketplaceNotesPanel", blockStart);
  const block = buyDetail.slice(blockStart, blockEnd);
  assert.doesNotMatch(block, /supplierUnitCost|supplierNameSnapshot|supplierContactSnapshot|selectedSupplierResponseId|SupplierResponseActions/);
  // The controls live inside the internal sourcing section, above the offer block.
  assert.ok(buyDetail.indexOf("<SupplierResponseActions") < blockStart, "controls must sit in the internal section");
});

/* ---------------------------------------------------------------------- UI */

test("the panel is internal-only, offers no file input, and never claims confirmation", () => {
  assert.match(panel, /^"use client";/);
  assert.match(panel, /Internal sourcing\. Nothing here is sent to the supplier or the buyer\./);
  assert.match(panel, /Never shown to the buyer\./);
  assert.match(panel, /Text only\. Do not attach files here\./);
  // No file input of any kind.
  assert.doesNotMatch(panel, /type="file"|<input[^>]*file|FileReader|multipart\/form-data/);
  // Availability is always the supplier's claim.
  assert.match(panel, /The supplier&apos;s claim, not a Civilon confirmation/);
  assert.match(panel, /Subject to confirmation \(no claim recorded\)/);
  assert.match(panel, /Supplier claims available/);
  // Nothing states Civilon certifies, approves or guarantees.
  assert.doesNotMatch(panel, /\bcertifie[sd]\b|\bairworthiness\b|\bguarantee[sd]?\b|\bauthenticat(?:es|ed)\b/i);
  // The default source is the nonregistered supplier.
  assert.match(panel, /useState<"nonregistered_supplier" \| "registered_contact">\("nonregistered_supplier"\)/);
  assert.match(panel, /Nonregistered supplier \(contacted directly\)/);
  // Accessible feedback and a refresh, no analytics.
  assert.match(panel, /role="alert"/);
  assert.match(panel, /role="status"/);
  assert.match(panel, /router\.refresh\(\);/);
  assert.doesNotMatch(panel, /trackCivilonEvent|dataLayer|civilonAnalytics/);
});

test("the panel offers only graph-legal next states and hides terminal rows", () => {
  assert.match(panel, /const targets = supplierResponseTargets\(response\.status\);/);
  assert.match(panel, /if \(!targets\.length\) \{/);
  assert.match(panel, /\(final\)/);
  assert.match(panel, /expectedStatus: response\.status,/);
  // It computes no policy of its own.
  assert.doesNotMatch(panel, /canTransitionSupplierResponse|shortlisted"\s*:/);
});

test("only seller-capable, live contacts are offered as registered suppliers", () => {
  assert.match(repo, /eq\(marketplaceContacts\.actsAsSeller, true\)/);
  assert.match(repo, /isNull\(marketplaceContacts\.deletedAt\)/);
  assert.match(repo, /if \(!contact \|\| contact\.deletedAt \|\| !contact\.actsAsSeller\) \{/);
  // Only the naming fields are snapshotted; the contact's own address and
  // telephone stay on the contact record. Identifiers, not prose: the comment
  // above the snapshot legitimately mentions telephone.
  assert.doesNotMatch(repo, /marketplaceContacts\.(businessEmail|normalizedEmail|normalizedPhone|phone)\b/);
  assert.doesNotMatch(repo, /supplierContactSnapshot: contact\./);
  assert.match(panel, /Choose a seller-capable contact/);
});

test("received_at is server generated and status is never client supplied", () => {
  assert.match(repo, /receivedAt: now,/);
  assert.match(repo, /status: DEFAULT_SUPPLIER_RESPONSE_STATUS,/);
  assert.doesNotMatch(routesLib, /receivedAt/);
  // The validator has no way to accept either.
  assert.equal(validateSupplierResponse({ ...nonregistered, receivedAt: "2020-01-01" }).ok, false);
  assert.equal(validateSupplierResponse({ ...nonregistered, status: "selected" }).ok, false);
});
