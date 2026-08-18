import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  BUYER_OFFER_DISCLOSURE,
  DEFAULT_BUYER_OFFER_DELIVERY,
  DEFAULT_BUYER_OFFER_STATUS,
  buyerOfferConditionCodes,
  buyerOfferCurrencies,
  buyerOfferDeliveryOptions,
  buyerOfferStatusValues,
  buyerOfferTargets,
  buyerOfferTerminalStatuses,
  buyerOfferTimestampFor,
  canTransitionBuyerOffer,
  isBuyerOfferTerminal,
} from "../db/price-check/domain/buyer-offer-policy.ts";
import {
  OFFER_LEAD_TIME_MAX_DAYS,
  OFFER_TEXT_MAX,
  validateBuyerOffer,
  validateBuyerOfferStatus,
} from "../lib/marketplace/admin/buyer-offer-validation.ts";
import {
  BUYER_OFFER_SNAPSHOT_KEYS,
  buildBuyerOfferSnapshot,
} from "../lib/marketplace/buyer-offer-snapshot.ts";
import { buyerOffers } from "../db/price-check/schema.ts";
import { roleCan } from "../lib/price-check/admin/policy.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const repo = read("db", "price-check", "repositories", "buyer-offer-repository.ts");
const routesLib = read("lib", "marketplace", "admin", "buyer-offer-routes.ts");
const panel = read("components", "admin", "BuyerOfferActions.tsx");
const snapshot = read("lib", "marketplace", "buyer-offer-snapshot.ts");
const buyDetail = read("components", "admin", "BuyRequestDetail.tsx");
const detailRepo = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const createRoute = read("app", "api", "admin", "marketplace", "buy-requests", "[id]", "buyer-offers", "route.ts");
const statusRoute = read("app", "api", "admin", "marketplace", "buy-requests", "[id]", "buyer-offers", "[offerId]", "status", "route.ts");
const sendRoute = read("app", "api", "admin", "marketplace", "buy-requests", "[id]", "buyer-offers", "[offerId]", "send", "route.ts");

const ULID = "0123456789ABCDEFGHJKMNP0TV";
const valid = { civilonSaleUnitPrice: "2400", currencyCode: "USD", quantity: "2" };

/* ------------------------------------------------------------------ policy */

test("the policy vocabularies match the schema enums exactly", () => {
  assert.deepEqual([...buyerOfferStatusValues], [...buyerOffers.status.enumValues]);
  assert.deepEqual([...buyerOfferDeliveryOptions], [...buyerOffers.deliveryOption.enumValues]);
  assert.deepEqual([...buyerOfferConditionCodes], [...buyerOffers.statedCondition.enumValues]);
  assert.equal(DEFAULT_BUYER_OFFER_STATUS, "draft");
  assert.equal(DEFAULT_BUYER_OFFER_DELIVERY, "not_determined");
  assert.equal(buyerOffers.status.default, "draft");
  assert.equal(buyerOffers.deliveryOption.default, "not_determined");
});

test("supplier_direct is not a delivery option anywhere", () => {
  assert.equal(buyerOfferDeliveryOptions.includes("supplier_direct"), false);
  assert.equal(buyerOffers.deliveryOption.enumValues.includes("supplier_direct"), false);
  assert.deepEqual([...buyerOfferDeliveryOptions], ["door_delivery", "port_of_entry", "nj_pickup", "not_determined"]);
  for (const source of [repo, routesLib, panel, snapshot, buyDetail]) {
    assert.doesNotMatch(source, /supplier_direct/);
  }
  assert.equal(validateBuyerOffer({ ...valid, deliveryOption: "supplier_direct" }).ok, false);
});

test("the full transition matrix is exactly the declared graph", () => {
  // `draft` has one outbound edge because the schema's sent_state and
  // draft_not_sent checks make draft <=> sent_at IS NULL. See the policy module.
  const expected = {
    draft: ["sent"],
    sent: ["accepted", "declined", "expired", "withdrawn", "superseded"],
    accepted: [], declined: [], expired: [], superseded: [], withdrawn: [],
  };
  for (const from of buyerOfferStatusValues) {
    assert.deepEqual([...buyerOfferTargets(from)], expected[from], from);
    for (const to of buyerOfferStatusValues) {
      assert.equal(canTransitionBuyerOffer(from, to), expected[from].includes(to), `${from} -> ${to}`);
    }
    assert.equal(canTransitionBuyerOffer(from, from), false, from);
  }
  assert.deepEqual([...buyerOfferTargets("not_a_status")], []);
});

test("terminal offers never resurrect", () => {
  assert.deepEqual([...buyerOfferTerminalStatuses], ["accepted", "declined", "expired", "superseded", "withdrawn"]);
  for (const terminal of buyerOfferTerminalStatuses) {
    assert.equal(isBuyerOfferTerminal(terminal), true);
    assert.deepEqual([...buyerOfferTargets(terminal)], []);
    for (const to of buyerOfferStatusValues) {
      assert.equal(canTransitionBuyerOffer(terminal, to), false, `${terminal} -> ${to}`);
    }
  }
  assert.equal(isBuyerOfferTerminal("draft"), false);
  assert.equal(isBuyerOfferTerminal("sent"), false);
});

test("only real events stamp a timestamp", () => {
  assert.equal(buyerOfferTimestampFor("sent"), "sentAt");
  assert.equal(buyerOfferTimestampFor("accepted"), "respondedAt");
  assert.equal(buyerOfferTimestampFor("declined"), "respondedAt");
  assert.equal(buyerOfferTimestampFor("superseded"), "supersededAt");
  // Expiry and withdrawal are not buyer responses and must not invent one.
  assert.equal(buyerOfferTimestampFor("expired"), null);
  assert.equal(buyerOfferTimestampFor("withdrawn"), null);
  assert.equal(buyerOfferTimestampFor("draft"), null);
});

/* -------------------------------------------------------------- validation */

test("a minimal offer needs only price, currency and quantity", () => {
  const result = validateBuyerOffer(valid);
  assert.equal(result.ok, true);
  assert.equal(result.data.civilonSaleUnitPrice, "2400.00");
  assert.equal(result.data.currencyCode, "USD");
  assert.equal(result.data.quantity, "2.00");
  assert.equal(result.data.deliveryOption, "not_determined");
  assert.equal(result.data.selectedSupplierResponseId, null);
  assert.equal(result.data.statedCondition, null);
  assert.equal(result.data.expiresAt, null);
});

test("price and quantity follow the schema's own checks", () => {
  // buyer_offers_sale_price_nonnegative_chk allows zero.
  assert.equal(validateBuyerOffer({ ...valid, civilonSaleUnitPrice: "0" }).ok, true);
  // buyer_offers_quantity_positive_chk does not.
  assert.equal(validateBuyerOffer({ ...valid, quantity: "0" }).ok, false);
  for (const [label, body] of [
    ["negative price", { ...valid, civilonSaleUnitPrice: "-1" }],
    ["missing price", { currencyCode: "USD", quantity: "2" }],
    ["non-numeric price", { ...valid, civilonSaleUnitPrice: "free" }],
    ["absurd price", { ...valid, civilonSaleUnitPrice: "999999999999" }],
    ["negative quantity", { ...valid, quantity: "-2" }],
    ["missing quantity", { civilonSaleUnitPrice: "1", currencyCode: "USD" }],
    ["missing currency", { civilonSaleUnitPrice: "1", quantity: "2" }],
    ["unsupported currency", { ...valid, currencyCode: "BTC" }],
  ]) {
    assert.equal(validateBuyerOffer(body).ok, false, label);
  }
  for (const currency of buyerOfferCurrencies) {
    assert.equal(validateBuyerOffer({ ...valid, currencyCode: currency }).ok, true, currency);
  }
});

test("no markup, margin or threshold input is accepted", () => {
  // The commercial rule's basis is unresolved, so nothing here computes a price.
  for (const key of [
    "supplierUnitCost", "markup", "marginPercent", "commission", "feePercent",
    "thresholdBasis", "supplierResponseId", "buyerEmail", "status", "version",
    "sentAt", "respondedAt", "supersededAt", "buyRequestId", "id",
  ]) {
    assert.equal(validateBuyerOffer({ ...valid, [key]: "1" }).ok, false, key);
  }
  // Identifiers and arithmetic, not prose: the comments legitimately say there
  // is no markup field, and that sentence must not be what makes this pass.
  for (const source of [repo, routesLib, panel]) {
    assert.doesNotMatch(source, /(markup|margin|commission|feePercent)\s*[:=(]/i);
    assert.doesNotMatch(source, /0\.15|0\.08|50_?000/);
    assert.doesNotMatch(source, /civilonSaleUnitPrice\s*[-+*/]|supplierUnitCost/);
  }
});

test("every enum value round-trips and non-values are refused", () => {
  for (const option of buyerOfferDeliveryOptions) {
    const result = validateBuyerOffer({ ...valid, deliveryOption: option });
    assert.equal(result.ok, true, option);
    assert.equal(result.data.deliveryOption, option);
  }
  for (const code of buyerOfferConditionCodes) {
    assert.equal(validateBuyerOffer({ ...valid, statedCondition: code }).ok, true, code);
  }
  assert.equal(validateBuyerOffer({ ...valid, statedCondition: "CERTIFIED" }).ok, false);
  assert.equal(validateBuyerOffer({ ...valid, deliveryOption: "anywhere" }).ok, false);
});

test("text, lead time, expiry and the internal pointer are bounded", () => {
  const NUL = String.fromCharCode(0);
  const ok = validateBuyerOffer({
    ...valid,
    documentsSummary: "  Trace paperwork where available  ",
    shippingAndExportScope: "Delivered duty unpaid",
    leadTimeDays: 21,
    expiresAt: "2026-09-01T00:00:00Z",
    selectedSupplierResponseId: ULID,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.documentsSummary, "Trace paperwork where available");
  assert.equal(ok.data.leadTimeDays, 21);
  assert.ok(ok.data.expiresAt instanceof Date);
  assert.equal(ok.data.selectedSupplierResponseId, ULID);

  for (const [label, body] of [
    ["over-long documents", { ...valid, documentsSummary: "a".repeat(OFFER_TEXT_MAX + 1) }],
    ["control character", { ...valid, shippingAndExportScope: `a${NUL}b` }],
    ["fractional lead time", { ...valid, leadTimeDays: 1.5 }],
    ["negative lead time", { ...valid, leadTimeDays: -1 }],
    ["absurd lead time", { ...valid, leadTimeDays: OFFER_LEAD_TIME_MAX_DAYS + 1 }],
    ["bad expiry", { ...valid, expiresAt: "soon" }],
    ["malformed pointer", { ...valid, selectedSupplierResponseId: "nope" }],
    ["array body", []],
    ["null body", null],
  ]) {
    assert.equal(validateBuyerOffer(body).ok, false, label);
  }
});

test("offer status validation is strict", () => {
  assert.deepEqual(
    validateBuyerOfferStatus({ expectedStatus: "draft", to: "sent" }),
    { ok: true, data: { expectedStatus: "draft", to: "sent" } },
  );
  for (const [label, body] of [
    ["missing body", null],
    ["unknown key", { expectedStatus: "draft", to: "sent", force: true }],
    ["unknown status", { expectedStatus: "draft", to: "posted" }],
    ["supplier status", { expectedStatus: "draft", to: "shortlisted" }],
    ["no-op", { expectedStatus: "sent", to: "sent" }],
  ]) {
    assert.equal(validateBuyerOfferStatus(body).ok, false, label);
  }
});

/* ---------------------------------------------------- buyer-facing snapshot */

test("the buyer-facing snapshot has a frozen, supplier-free key set", () => {
  assert.deepEqual([...BUYER_OFFER_SNAPSHOT_KEYS], [
    "reference", "version", "saleUnitPrice", "currencyCode", "quantity",
    "statedCondition", "documentsSummary", "deliveryOption",
    "shippingAndExportScope", "leadTimeDays", "expiresAt", "disclosure",
  ]);
  assert.ok(Object.isFrozen(BUYER_OFFER_SNAPSHOT_KEYS));

  const built = buildBuyerOfferSnapshot({
    reference: "BR-ABCDEFGHJK",
    version: 2,
    saleUnitPrice: "2400.00",
    currencyCode: "USD",
    quantity: "2.00",
    statedCondition: "SV",
    documentsSummary: "Trace paperwork where available",
    deliveryOption: "nj_pickup",
    shippingAndExportScope: "Delivered duty unpaid",
    leadTimeDays: 21,
    expiresAt: new Date("2026-09-01T00:00:00Z"),
  });
  // The exact key set, no more and no fewer.
  assert.deepEqual(Object.keys(built).sort(), [...BUYER_OFFER_SNAPSHOT_KEYS].sort());
  assert.ok(Object.isFrozen(built));
  assert.equal(built.reference, "BR-ABCDEFGHJK", "the public reference, never an internal id");
  assert.equal(built.disclosure, BUYER_OFFER_DISCLOSURE);

  // Nothing supplier-shaped, and no internal pointer, can appear.
  for (const forbidden of [
    "supplierUnitCost", "supplierNameSnapshot", "supplierContactSnapshot",
    "supplierCountry", "supplierKind", "selectedSupplierResponseId",
    "locationText", "shippingNotes", "availabilityState", "buyRequestId",
    "createdByAdminUserId", "status", "sentAt", "respondedAt", "supersededAt",
  ]) {
    assert.equal(BUYER_OFFER_SNAPSHOT_KEYS.includes(forbidden), false, forbidden);
    assert.equal(forbidden in built, false, forbidden);
  }
  // The builder declares no supplier property and reads none. Identifiers, not
  // prose: the doc comment legitimately explains what it cannot carry.
  assert.doesNotMatch(snapshot, /supplier\w*\s*[:?]/i);
  assert.doesNotMatch(snapshot, /input\.supplier/i);
});

test("the disclosure states the limits plainly", () => {
  assert.match(BUYER_OFFER_DISCLOSURE, /Documentation varies/);
  assert.match(BUYER_OFFER_DISCLOSURE, /subject to confirmation/);
  assert.match(BUYER_OFFER_DISCLOSURE, /not a certification/);
  assert.match(BUYER_OFFER_DISCLOSURE, /airworthiness approval/);
  assert.match(BUYER_OFFER_DISCLOSURE, /regulatory approval/);
  assert.match(BUYER_OFFER_DISCLOSURE, /not a guarantee of authenticity or fitness/);
  assert.match(panel, /BUYER_OFFER_DISCLOSURE/);
});

/* ------------------------------------------------------------------ routes */

test("all offer admin routes are node runtime, POST only, and gated on manage_buyer_offer", () => {
  for (const [name, source] of [["create", createRoute], ["status", statusRoute], ["send", sendRoute]]) {
    assert.match(source, /export const runtime = "nodejs"/, name);
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.match(source, new RegExp(`export const ${method} = buyerOfferMethodNotAllowed;`), `${name}: ${method}`);
    }
  }
  assert.equal((routesLib.match(/requireStaffApi\("manage_buyer_offer"\)/g) ?? []).length, 3);
  assert.equal((routesLib.match(/verifyAdminMutationOrigin\(request\)/g) ?? []).length, 3);
  assert.match(routesLib, /headers\.set\("Allow", "POST"\)/);
  for (const handler of ["POST_buyerOffer", "POST_buyerOfferStatus", "POST_buyerOfferDelivery"]) {
    const start = routesLib.indexOf(`export async function ${handler}(`);
    const body = routesLib.slice(start, routesLib.indexOf("\n}\n", start));
    assert.ok(body.indexOf("verifyAdminMutationOrigin(request)") < body.indexOf("readJsonBody"), handler);
  }
  // REVIEWER and ADMIN only, as the policy matrix already says.
  assert.equal(roleCan("ANALYST", "manage_buyer_offer"), false);
  assert.equal(roleCan("AUDITOR", "manage_buyer_offer"), false);
  assert.equal(roleCan("REVIEWER", "manage_buyer_offer"), true);
  assert.equal(roleCan("ADMIN", "manage_buyer_offer"), true);
});

test("the routes are parent-bound and only the dedicated route may queue delivery", () => {
  assert.match(routesLib, /if \(!isRecordId\(id\) \|\| !isRecordId\(offerId\)\)/);
  assert.match(routesLib, /buyRequestId: id,\s*buyerOfferId: offerId,/);
  for (const source of [routesLib, createRoute, statusRoute, sendRoute, panel, snapshot]) {
    assert.doesNotMatch(source, /isPriceCheckEnabled|isMarketplaceEnabled|isSellSubmissionEnabled|NEXT_PUBLIC_|process\.env/);
    assert.doesNotMatch(source, /getPriceCheckAdminAccess|requireAdminApi/);
    assert.doesNotMatch(source, /PostmarkTransactionalEmailProvider|TransactionalEmail|sendMail|mailto:/);
  }
  assert.match(routesLib, /queueBuyerOfferDelivery/);
  assert.match(routesLib, /Use Send Civilon Offer for delivery/);
  assert.match(routesLib, /Buyer acceptance or decline can only come from the buyer's secure link/);
  assert.doesNotMatch(routesLib, /error\.message|String\(error\)|console\./);
  assert.equal((routesLib.match(/return new Response\(/g) ?? []).length, 1);
});

/* ------------------------------------------------------- write-path shape */

test("the repository keeps core writes transactional, audited, and supplier-cost free", () => {
  assert.ok((repo.match(/return db\.transaction\(async \(tx\) => \{/g) ?? []).length >= 4);
  assert.match(repo, /await tx\.insert\(auditEvents\)\.values\(\{/);
  // It never mutates the Buy Request or a supplier response.
  assert.doesNotMatch(repo, /update\(buyRequests\)|insert\(buyRequests\)|delete\(buyRequests\)/);
  assert.doesNotMatch(repo, /update\(supplierResponses\)|insert\(supplierResponses\)|delete\(supplierResponses\)/);
  // It never reads a supplier cost.
  assert.doesNotMatch(repo, /supplierUnitCost|documentsSummary: supplierResponses|shippingNotes/);
});

test("audit metadata is minimal and carries no price or supplier pointer", () => {
  const blocks = repo.match(/metadata: \{[\s\S]*?\}/g) ?? [];
  assert.ok(blocks.length >= 8, "draft, delivery, response and worker audits are present");
  for (const block of blocks) {
    assert.doesNotMatch(block, /civilonSaleUnitPrice|currencyCode|quantity|selectedSupplierResponseId/, block);
    assert.doesNotMatch(block, /supplierNameSnapshot|supplierUnitCost|businessEmail/, block);
  }
  assert.match(repo, /metadata: \{\s*buyerOfferId,\s*version: nextVersion,\s*deliveryOption: input\.offer\.deliveryOption,\s*\}/);
});

test("versioning and superseding are explicit about what they touch", () => {
  assert.match(repo, /const nextVersion = existing\.reduce\(\(highest, row\) => Math\.max\(highest, row\.version\), 0\) \+ 1;/);
  // An unsent draft is replaced on create, and the replacement is audited.
  assert.match(repo, /const draft = existing\.find\(\(row\) => row\.status === "draft"\);/);
  assert.match(repo, /BUYER_OFFER_DRAFT_REPLACED_ACTION/);
  // Nothing looks for a terminal status to modify.
  assert.doesNotMatch(repo, /row\.status === "accepted"|row\.status === "declined"|row\.status === "expired"/);

  // Creating a draft supersedes nothing: the buyer still holds the sent offer,
  // and this draft may never be sent.
  const create = repo.slice(repo.indexOf("export async function createBuyerOffer"), repo.indexOf("export async function changeBuyerOfferStatus"));
  // Statements, not prose: the doc comment legitimately explains why creating a
  // draft supersedes nothing, and that sentence must not be what makes this pass.
  assert.doesNotMatch(create, /status: "superseded"/, "createBuyerOffer must not supersede anything");
  assert.doesNotMatch(create, /supersededAt:/);
  assert.doesNotMatch(create, /BUYER_OFFER_SUPERSEDED_ACTION/);
  assert.doesNotMatch(create, /row\.status === "sent"/);
  // …and the misleading field is gone from the create result.
  assert.doesNotMatch(repo, /supersededOfferId/);

  // Superseding happens at the moment the replacement is actually sent, after
  // the fenced update has already succeeded.
  const send = repo.slice(repo.indexOf("export async function changeBuyerOfferStatus"));
  assert.match(send, /if \(input\.to === "sent"\) \{/);
  assert.match(send, /ne\(buyerOffers\.id, input\.buyerOfferId\),/);
  assert.match(send, /eq\(buyerOffers\.status, "sent"\),/);
  assert.match(send, /BUYER_OFFER_SUPERSEDED_ACTION/);
  assert.ok(
    send.indexOf('if (!updated.length)') < send.indexOf('if (input.to === "sent")'),
    "a stale send must return before anything is superseded",
  );
  // Parent-bound on the supersede too.
  assert.match(send, /eq\(buyerOffers\.buyRequestId, input\.buyRequestId\),\s*eq\(buyerOffers\.status, "sent"\),\s*\)\);/);
});

/* ---------------------------------------------------------------------- UI */

test("the offer panel shows buyer terms only and no supplier data", () => {
  assert.match(panel, /^"use client";/);
  assert.match(panel, /Civilon sale price, per unit/);
  assert.match(panel, /Entered explicitly, not calculated\./);
  assert.match(panel, /Never shown to the buyer\./);
  assert.match(panel, /Send Civilon Offer/);
  assert.match(panel, /secure accept\/decline link/);
  assert.doesNotMatch(panel, /Confirm I sent this offer to the buyer|Sent \(recorded by staff\)/);
  // No supplier field is rendered, and no arithmetic between the two sides.
  assert.doesNotMatch(panel, /supplierUnitCost|supplierNameSnapshot|supplierContactSnapshot|supplierCountry|locationText|shippingNotes|availabilityState/);
  assert.doesNotMatch(panel, /trackCivilonEvent|dataLayer|civilonAnalytics/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /role="status"/);
  assert.match(panel, /router\.refresh\(\);/);
  // The generic control cannot claim a send or buyer response.
  assert.match(panel, /\["expired", "withdrawn"\]/);
  assert.doesNotMatch(panel, /buyerOfferTargets\(openOffer\.status\)/);
  assert.doesNotMatch(panel, /canTransitionBuyerOffer/);
});

test("the offer controls sit in the buyer-facing section, below the supplier one", () => {
  const supplierIndex = buyDetail.indexOf('aria-label="Supplier responses"');
  const offerIndex = buyDetail.indexOf('aria-label="Civilon buyer offers"');
  const supplierControls = buyDetail.indexOf("<SupplierResponseActions");
  const offerControls = buyDetail.indexOf("<BuyerOfferActions");
  assert.ok(supplierIndex > 0 && offerIndex > supplierIndex);
  assert.ok(supplierControls > supplierIndex && supplierControls < offerIndex, "supplier controls stay internal");
  assert.ok(offerControls > offerIndex, "offer controls sit in the buyer-facing section");
});

test("the buyer-offer projection and rendered table still carry no supplier field", () => {
  const start = detailRepo.indexOf("export type BuyerOfferRecord = {");
  const type = detailRepo.slice(start, detailRepo.indexOf("};", start));
  assert.doesNotMatch(type, /supplier/i);
  assert.equal(type.includes("selectedSupplierResponseId"), false);

  const blockStart = buyDetail.indexOf('aria-label="Civilon buyer offers"');
  const tableEnd = buyDetail.indexOf("<BuyerOfferActions", blockStart);
  const table = buyDetail.slice(blockStart, tableEnd);
  for (const forbidden of [
    "supplierUnitCost", "supplierNameSnapshot", "supplierContactSnapshot",
    "supplierCountry", "selectedSupplierResponseId", "locationText", "shippingNotes",
  ]) {
    assert.doesNotMatch(table, new RegExp(forbidden), forbidden);
  }
});
