import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  MARKETPLACE_AUDIT_LIMIT,
  marketplaceAggregateTypes,
} from "../db/price-check/repositories/marketplace-admin-repository.ts";
import {
  buyRequestAdminUrl,
  sellSubmissionAdminUrl,
} from "../lib/marketplace/verification.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const repository = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const buyDetail = read("components", "admin", "BuyRequestDetail.tsx");
const sellDetail = read("components", "admin", "SellSubmissionDetail.tsx");
const shared = read("components", "admin", "MarketplaceShared.tsx");
const listView = read("components", "admin", "MarketplaceListView.tsx");
const buyPage = read("app", "admin", "buy-requests", "page.tsx");
const sellPage = read("app", "admin", "sell-submissions", "page.tsx");
const buyDetailPage = read("app", "admin", "buy-requests", "[id]", "page.tsx");
const sellDetailPage = read("app", "admin", "sell-submissions", "[id]", "page.tsx");
const access = read("lib", "price-check", "admin", "marketplace-access.ts");

const renderedSurfaces = { buyDetail, sellDetail, shared, listView, buyPage, sellPage, buyDetailPage, sellDetailPage };

/** The detail section of the repository, where the record-bound reads live. */
const detailSection = (() => {
  const start = repository.indexOf("/* Record-bound detail reads ");
  assert.ok(start > 0, "repository must carry its detail section banner");
  return repository.slice(start);
})();

/* --------------------------------------------------------- no leaked internals */

test("no detail projection or rendered component can reach a storage key or a credential", () => {
  const forbidden = [
    "objectKey", "object_key", "storageProvider", "storage_provider", "contentDigest",
    "tokenHash", "keyedTokenHash", "tokenDerivationNonce", "idempotencyHash",
    "sourcePendingUploadId", "sanitizedMetadata",
    "emailVerificationTokens", "marketplaceUploadSessions", "marketplacePendingUploads",
    "MARKETPLACE_UPLOAD_BUCKET", "amazonaws", "s3://", "getSignedUrl",
  ];
  for (const token of forbidden) {
    assert.doesNotMatch(detailSection, new RegExp(token.replace(/[.:/]/g, "\\$&")), `detail reads must not reference ${token}`);
    for (const [name, source] of Object.entries(renderedSurfaces)) {
      assert.doesNotMatch(source, new RegExp(token.replace(/[.:/]/g, "\\$&")), `${name} must not reference ${token}`);
    }
  }

  // The evidence-request summary may read only the outbox's delivery state and
  // sent timestamp. Rendered surfaces receive those projected values, never the
  // outbox object or any routing/provider/lease data.
  for (const [name, source] of Object.entries(renderedSurfaces)) {
    assert.doesNotMatch(source, /notificationOutbox/, `${name} must not reference notificationOutbox`);
  }
  const requestQueryStart = detailSection.search(/db\.select\(\{\r?\n\s+id: marketplaceEvidenceRequests\.id,/);
  const requestQueryEnd = detailSection.indexOf(".limit(1)", requestQueryStart);
  assert.ok(requestQueryStart > 0 && requestQueryEnd > requestQueryStart, "the evidence-request query must be present");
  const requestQuery = detailSection.slice(requestQueryStart, requestQueryEnd);
  assert.match(requestQuery, /notificationOutbox\.state/);
  assert.match(requestQuery, /notificationOutbox\.sentAt/);
  for (const field of [
    "recipientReference", "providerMessageId", "leaseOwner", "leaseExpiresAt",
    "sanitizedFailureCode", "idempotencyKey", "templateVersion", "attemptCount",
  ]) {
    assert.doesNotMatch(requestQuery, new RegExp(`notificationOutbox\\.${field}`), `detail must not select outbox ${field}`);
  }
});

test("the detail projection stays metadata only", () => {
  // The component may link to the authenticated download route, but it holds no
  // key, does no signing, and offers no public or provider URL of its own.
  assert.doesNotMatch(sellDetail, /presign|GetObject|createPresigned|getSignedUrl|amazonaws|s3:/i);
  assert.doesNotMatch(sellDetail, /https?:\/\//);
  // The one anchor points at the record-bound admin route and nothing else.
  const hrefs = sellDetail.match(/href=\{`([^`]*)`\}/g) ?? [];
  assert.deepEqual(hrefs, [
    "href={`/api/admin/marketplace/sell-submissions/${submissionId}/attachments/${attachment.id}/download`}",
  ]);
  // The honest states are all rendered.
  for (const state of ["CLEAN", "PENDING", "QUARANTINED", "REJECTED", "FAILED"]) {
    assert.ok(sellDetail.includes(state), `evidence table must describe the ${state} scan state`);
  }
  assert.match(sellDetail, /const storedClean = attachment\.scanState === "CLEAN" && !attachment\.deletedAt/);
  // Stored-clean is necessary but no longer sufficient: the caller must also
  // hold `download_marketplace_evidence` before a link is rendered at all.
  assert.match(sellDetail, /const usable = storedClean && canDownload;/);
  assert.match(sellDetail, /Metadata only/);
});

test("evidence copy never claims Civilon certifies, approves or guarantees anything", () => {
  const banned = /\bcertifie[sd]\b|\bairworthiness approv|\bguarantee[sd]?\b|\bauthenticat(?:es|ed)\b|\bregulatory approval\b/i;
  for (const [name, source] of Object.entries(renderedSurfaces)) {
    const claims = source.match(banned) ?? [];
    for (const claim of claims) {
      // Only negations of the claim are permitted.
      const index = source.indexOf(claim);
      const window = source.slice(Math.max(0, index - 90), index + claim.length + 20);
      assert.match(window, /\bnot\b|\bdoes not\b|\bnever\b|\bno\b/i, `${name}: unqualified claim "${claim}"`);
    }
  }
  assert.match(sellDetail, /does not certify, authenticate or approve any part/);
  assert.match(sellDetail, /review is not regulatory approval/);
  assert.match(buyDetail, /subject to confirmation/i);
});

/* -------------------------------------------------- supplier / buyer separation */

const supplierOnlyFields = [
  "supplierKind", "supplierNameSnapshot", "supplierContactSnapshot",
  "supplierCountry", "supplierUnitCost", "availabilityState", "shippingNotes",
  "recordedByEmail",
];

test("the buyer offer type carries no supplier field and no supplier pointer", () => {
  const start = detailSection.indexOf("export type BuyerOfferRecord = {");
  const end = detailSection.indexOf("};", start);
  assert.ok(start > 0 && end > start, "BuyerOfferRecord must be declared");
  const type = detailSection.slice(start, end);
  for (const field of [...supplierOnlyFields, "selectedSupplierResponseId", "supplierResponseId"]) {
    assert.doesNotMatch(type, new RegExp(`\\b${field}\\b`), `BuyerOfferRecord must not carry ${field}`);
  }
  assert.match(type, /civilonSaleUnitPrice: string;/);
  assert.match(type, /deliveryOption: string;/);
});

test("the buyer offer query selects no supplier column", () => {
  const start = detailSection.search(/db\.select\(\{\r?\n\s+id: buyerOffers\.id,/);
  const end = detailSection.indexOf(".orderBy(desc(buyerOffers.version))", start);
  assert.ok(start > 0 && end > start, "the buyer offer query must be present");
  const query = detailSection.slice(start, end);
  assert.doesNotMatch(query, /supplier/i);
  assert.match(query, /buyerOffers\.civilonSaleUnitPrice/);
});

test("the two economic sides are returned as separate arrays, never combined", () => {
  assert.match(detailSection, /supplierResponses: SupplierResponseRecord\[\];/);
  assert.match(detailSection, /buyerOffers: BuyerOfferRecord\[\];/);
  // No flattened economics object and no derived margin: neither name appears as
  // a declared property or binding, and the two tables are never joined.
  assert.doesNotMatch(detailSection, /\b(margin|economics|combined|reconciled)\s*[:=]/i);
  assert.doesNotMatch(detailSection, /(const|let|type|interface)\s+\w*(Margin|Economics)\w*/i);
  assert.doesNotMatch(detailSection, /\.innerJoin\(supplierResponses|\.leftJoin\(supplierResponses/);
  assert.doesNotMatch(detailSection, /\.innerJoin\(buyerOffers|\.leftJoin\(buyerOffers/);
  // No arithmetic between the two sides anywhere in the repository or the UI.
  for (const source of [detailSection, buyDetail]) {
    assert.doesNotMatch(source, /civilonSaleUnitPrice\s*[-+*/]|supplierUnitCost\s*[-+*/]/);
    assert.doesNotMatch(source, /Number\([^)]*supplierUnitCost/);
  }
});

test("the rendered buyer-offer block contains no supplier field", () => {
  const start = buyDetail.indexOf('aria-label="Civilon buyer offers"');
  const end = buyDetail.indexOf("<MarketplaceNotesPanel", start);
  assert.ok(start > 0 && end > start, "the buyer offer panel must be present");
  const block = buyDetail.slice(start, end);
  for (const field of [...supplierOnlyFields, "selectedSupplierResponseId"]) {
    assert.doesNotMatch(block, new RegExp(`\\b${field}\\b`), `buyer offer panel must not render ${field}`);
  }
  assert.match(block, /offer\.civilonSaleUnitPrice/);
  assert.match(block, /carries no supplier identity, no supplier cost and no internal routing/);
});

test("the supplier block is marked internal and the buyer block is not", () => {
  assert.match(shared, /export const INTERNAL_ONLY_LABEL = "Internal — never shown to buyer";/);
  const supplierStart = buyDetail.indexOf('aria-label="Supplier responses"');
  const supplierEnd = buyDetail.indexOf('aria-label="Civilon buyer offers"');
  assert.ok(supplierStart > 0 && supplierEnd > supplierStart);
  assert.match(buyDetail.slice(supplierStart, supplierEnd), /<InternalOnlyBadge \/>/);
  assert.match(buyDetail.slice(supplierStart, supplierEnd), /must never reach the buyer/);
  // Internal notes are marked too.
  assert.match(shared, /<h2>Internal notes<\/h2><InternalOnlyBadge \/>/);
});

/* -------------------------------------------------------------- read-only slice */

test("this slice writes nothing", () => {
  for (const [name, source] of Object.entries(renderedSurfaces)) {
    assert.doesNotMatch(source, /method:\s*"POST"|fetch\(|useRouter|onClick=/, `${name} must not perform a write`);
  }
  assert.doesNotMatch(detailSection, /db\.insert|db\.update|db\.delete|\.transaction\(/);
});

test("detail reads distinguish a missing record from an infrastructure failure", () => {
  assert.equal((detailSection.match(/if \(!record\) return null;/g) ?? []).length, 2);
  for (const [name, page] of [["buy", buyDetailPage], ["sell", sellDetailPage]]) {
    assert.match(page, /if \(!detail\) notFound\(\);/, `${name} detail page must 404 a missing record`);
    assert.match(page, /\} catch \{\s*return <AdminAccessDenied unavailable \/>;\s*\}/, `${name} detail page must show the generic unavailable card on a fault`);
    // The id is shape-checked before it is used.
    assert.match(page, /const RECORD_ID_PATTERN = \/\^\[0-9A-HJKMNP-TV-Z\]\{26\}\$\//);
    assert.match(page, /if \(!RECORD_ID_PATTERN\.test\(id\)\) notFound\(\);/);
  }
});

/* ------------------------------------------------------------------- page guard */

test("marketplace pages use the product-independent guard and require view_marketplace", () => {
  assert.match(access, /const access = await getAdminAccess\(\)/);
  assert.match(access, /if \(!roleCan\(access\.user\.role, "view_marketplace"\)\) redirect\("\/admin\/access-denied"\)/);
  assert.match(access, /redirect\("\/admin\/login"\)/);
  assert.doesNotMatch(access, /getPriceCheckAdminAccess|isPriceCheckEnabled|isMarketplaceEnabled|isSellSubmissionEnabled|NEXT_PUBLIC_/);
  for (const [name, page] of Object.entries({ buyPage, sellPage, buyDetailPage, sellDetailPage })) {
    assert.match(page, /await requireMarketplacePageAccess\(\)/, `${name} must use the shared guard`);
    assert.match(page, /if \(!user\) return <AdminAccessDenied unavailable \/>;/, `${name} must fail closed`);
    assert.match(page, /export const dynamic = "force-dynamic"/, `${name} must not be cached`);
    assert.doesNotMatch(page, /isMarketplaceEnabled|isSellSubmissionEnabled|NEXT_PUBLIC_/, `${name} must not read a public flag`);
  }
});

test("no analytics is emitted from any marketplace admin surface", () => {
  for (const [name, source] of Object.entries(renderedSurfaces)) {
    assert.doesNotMatch(source, /trackCivilonEvent|dataLayer|civilonAnalytics/, `${name} must not emit analytics`);
  }
});

test("the lists are a projection of the same unified queue read", () => {
  for (const [name, page] of [["buy", buyPage], ["sell", sellPage]]) {
    assert.match(page, /repository\.listUnifiedAdminQueue\(priceCheckDb, filters\)/, `${name} list must reuse the queue read`);
    assert.match(page, /assignee: rawAssignee \|\| undefined,/, `${name} list must not pre-drop a malformed assignee`);
  }
  assert.match(buyPage, /type: "buy_request" as const/);
  assert.match(sellPage, /type: "sell_submission" as const/);
  assert.match(listView, /<a href=\{`\$\{basePath\}\/\$\{record\.id\}`\}>\{record\.publicReference\}<\/a>/);
});

/* ------------------------------------------------------- slice 7 email deep links */

test("internal email links are record bound and encode the id", () => {
  assert.equal(
    buyRequestAdminUrl("https://cvlon.com", "BR0000000000000000000000AB"),
    "https://cvlon.com/admin/buy-requests/BR0000000000000000000000AB",
  );
  assert.equal(
    sellSubmissionAdminUrl("https://cvlon.com/", "SS0000000000000000000000CD"),
    "https://cvlon.com/admin/sell-submissions/SS0000000000000000000000CD",
  );
  assert.equal(
    sellSubmissionAdminUrl("https://cvlon.com", "../price-checks"),
    "https://cvlon.com/admin/sell-submissions/..%2Fprice-checks",
  );
});

test("the internal handlers pass the record id and nothing else new", () => {
  const buyHandlers = read("lib", "marketplace", "email", "buy-request-handlers.ts");
  const sellHandlers = read("lib", "marketplace", "email", "sell-submission-handlers.ts");
  assert.match(buyHandlers, /adminUrl: buyRequestAdminUrl\(marketplaceOrigin\(\), notice\.id\),/);
  assert.match(sellHandlers, /adminUrl: sellSubmissionAdminUrl\(marketplaceOrigin\(\), notice\.id\),/);
  // Approved-origin validation is untouched, and no new content enters the
  // internal mail. Scoped to the internal handler: the *verify* handler
  // legitimately addresses the customer's own business email.
  for (const [name, source] of [["buy", buyHandlers], ["sell", sellHandlers]]) {
    assert.match(source, /marketplaceOrigin\(\)/, `${name} must keep approved-origin validation`);
    const start = source.indexOf("InternalNotificationHandler: NotificationHandler = {");
    assert.ok(start > 0, `${name} internal handler must be present`);
    const internal = source.slice(start);
    assert.match(internal, /reference: notice\.publicReference,\s*status: notice\.status,\s*submittedAt: notice\.submittedAt,/);
    assert.doesNotMatch(
      internal,
      /originalPartNumber|description|companyName|displayFilename|businessEmail|quantity|askingUnitPrice/,
      `${name} internal notice must carry no request content`,
    );
  }
  // No caller is left pointing at the old shared destination.
  const verification = read("lib", "marketplace", "verification.ts");
  assert.doesNotMatch(verification, /marketplaceAdminUrl/);
  assert.doesNotMatch(verification, /\/admin\/price-checks/);
});

/* --------------------------------------------------------------------- vocabulary */

test("the aggregate vocabulary matches the schema enum and the audit cap is bounded", () => {
  assert.deepEqual([...marketplaceAggregateTypes], ["buy_request", "sell_submission"]);
  assert.equal(MARKETPLACE_AUDIT_LIMIT, 200);
  assert.match(detailSection, /\.limit\(MARKETPLACE_AUDIT_LIMIT\)/);
});
