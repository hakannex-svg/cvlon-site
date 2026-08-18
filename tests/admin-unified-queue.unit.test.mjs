import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  UNASSIGNED_FILTER,
  UNIFIED_QUEUE_LIMIT,
  buyRequestStatuses,
  isAssigneeFilter,
  sellSubmissionStatuses,
  unifiedQueueAges,
  unifiedQueueTypes,
  unifiedQueueUrgencies,
  unifiedQueueVerificationStates,
} from "../db/price-check/repositories/marketplace-admin-repository.ts";
import { unifiedStatusLabel, unifiedTypeLabels } from "../lib/price-check/admin/display.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const repository = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const queuePage = read("app", "admin", "queue", "page.tsx");
const chrome = read("components", "admin", "AdminChrome.tsx");
const indexBarrel = read("db", "price-check", "repositories", "index.ts");

test("queue vocabularies match the schema and the Price Check cap", () => {
  assert.deepEqual([...unifiedQueueTypes], ["price_check", "buy_request", "sell_submission"]);
  assert.deepEqual([...unifiedQueueUrgencies], ["aog", "critical"]);
  assert.deepEqual([...unifiedQueueVerificationStates], ["verified", "pending"]);
  assert.deepEqual([...unifiedQueueAges], ["day", "week", "older"]);
  assert.equal(UNIFIED_QUEUE_LIMIT, 200);
  assert.equal(UNASSIGNED_FILTER, "unassigned");
});

test("status vocabularies are read from the schema enums, not duplicated", () => {
  assert.deepEqual([...buyRequestStatuses], [
    "pending_verification", "verified", "sourcing", "quoted", "converted", "closed", "spam", "withdrawn",
  ]);
  assert.deepEqual([...sellSubmissionStatuses], [
    "pending_verification", "verified", "under_review", "accepted", "declined", "closed", "spam", "withdrawn",
  ]);
  assert.match(repository, /buyRequests\.status\.enumValues/);
  assert.match(repository, /sellSubmissions\.status\.enumValues/);
});

/**
 * The repository holds both the queue and the record-bound detail reads. The
 * queue projection is far narrower than a detail projection, so its invariant
 * is asserted against the queue section alone; whole-file invariants that must
 * hold everywhere are asserted separately below.
 */
const queueSection = (() => {
  const start = repository.indexOf("/* Unified queue ");
  const end = repository.indexOf("/* Record-bound detail reads ");
  assert.ok(start > 0 && end > start, "repository must carry its section banners");
  return repository.slice(start, end);
})();

test("the queue projection never exposes notes, keys, supplier data or prices", () => {
  const forbidden = [
    "notes", "objectKey", "object_key", "supplierResponses", "supplierUnitCost",
    "buyerOffers", "civilonSaleUnitPrice", "askingUnitPrice", "unitPrice",
    "businessEmail", "normalizedEmail", "documentsSummary", "applicationNotes",
    "marketplaceAttachments", "marketplaceNotes",
  ];
  for (const token of forbidden) {
    assert.doesNotMatch(queueSection, new RegExp(`\\b${token}\\b`), `queue section must not reference ${token}`);
    assert.doesNotMatch(queuePage, new RegExp(`\\b${token}\\b`), `queue page must not reference ${token}`);
  }
});

test("no read in the repository can reach a storage key, a token or a hash", () => {
  // These hold for the whole file, detail reads included.
  for (const token of [
    "objectKey", "object_key", "storageProvider", "contentDigest",
    "tokenHash", "keyedTokenHash", "tokenDerivationNonce", "idempotencyHash",
    "notificationOutbox", "emailVerificationTokens", "marketplaceUploadSessions",
    "marketplacePendingUploads", "sanitizedMetadata",
    "MARKETPLACE_UPLOAD_BUCKET", "process.env",
  ]) {
    assert.doesNotMatch(repository, new RegExp(token.replace(".", "\\.")), `repository must not reference ${token}`);
  }
});

test("repository imports only the tables its projections need", () => {
  const start = repository.indexOf("import {\n  adminUsers");
  assert.ok(start > 0, "schema import block should be present");
  const importBlock = repository.slice(start, repository.indexOf("} from \"../schema.ts\""));
  for (const table of [
    "adminUsers", "auditEvents", "buyRequests", "buyerOffers", "marketplaceAttachments",
    "marketplaceContacts", "marketplaceNotes", "priceChecks", "requesters",
    "sellSubmissionItems", "sellSubmissions", "supplierResponses",
  ]) {
    assert.match(importBlock, new RegExp(`\\b${table}\\b`));
  }
  // Credential-bearing and delivery tables are never imported at all.
  assert.doesNotMatch(importBlock, /emailVerificationTokens|marketplaceUploadSessions|marketplacePendingUploads|notificationOutbox|resultAccessTokens|adminSessions/);
});

test("verification state comes from the contact record, never the aggregate timestamp", () => {
  // The aggregate's verified_at is stamped by the schema check constraint when
  // an ADMIN performs the operational override, so reading it as the customer's
  // own confirmation would report a staff action as a customer action.
  assert.match(repository, /export const VERIFIED_CONTACT_STATE = "VERIFIED";/);
  assert.match(repository, /return state === VERIFIED_CONTACT_STATE \? "verified" : "pending";/);
  // Both queue branches project and filter from the joined contact.
  assert.equal((repository.match(/verificationState: contactVerificationState\(row\.contactVerificationState\)/g) ?? []).length, 2);
  assert.equal((repository.match(/contactVerificationState: marketplaceContacts\.verificationState/g) ?? []).length, 2);
  assert.equal((repository.match(/eq\(marketplaceContacts\.verificationState, VERIFIED_CONTACT_STATE\)/g) ?? []).length, 2);
  assert.equal((repository.match(/ne\(marketplaceContacts\.verificationState, VERIFIED_CONTACT_STATE\)/g) ?? []).length, 2);
  // Both detail reads derive the same way.
  assert.equal((repository.match(/verificationState: contactVerificationState\(record\.contact\.verificationState\)/g) ?? []).length, 2);
  // No projection or filter may read the aggregate timestamp as a state again.
  assert.doesNotMatch(repository, /verificationState: \(row\.verifiedAt/);
  assert.doesNotMatch(repository, /verifiedAt \? "verified"/);
  assert.doesNotMatch(repository, /buyRequests\.verifiedAt\} is not null/);
  assert.doesNotMatch(repository, /sellSubmissions\.verifiedAt\} is not null/);
});

test("the detail views label the aggregate timestamp honestly", () => {
  const buyDetail = read("components", "admin", "BuyRequestDetail.tsx");
  const sellDetail = read("components", "admin", "SellSubmissionDetail.tsx");
  for (const [name, source] of [["Buy", buyDetail], ["Sell", sellDetail]]) {
    assert.match(source, /Workflow verification gate cleared/, name);
    assert.match(source, /audited staff override/, name);
    assert.match(source, /the contact panel is authoritative/, name);
    // The bare "Verified" label is gone from the aggregate timestamp.
    assert.doesNotMatch(source, /<Field label="Verified">/, name);
  }
  // The chip is fed the derived contact state, not the aggregate timestamp.
  assert.match(buyDetail, /verificationState=\{request\.verificationState\}/);
  assert.match(sellDetail, /verificationState=\{submission\.verificationState\}/);
  const shared = read("components", "admin", "MarketplaceShared.tsx");
  assert.match(shared, /Contact verification state/);
  assert.match(shared, /Contact verified at/);
});

test("unverified marketplace records are visible by default", () => {
  // No branch may carry an implicit verified-only predicate.
  assert.doesNotMatch(repository, /verifiedAt is not null`\);\s*\/\/ default/);
  assert.match(repository, /if \(filters\.verification === "verified"\)/);
  assert.match(repository, /if \(filters\.verification === "pending"\)/);
  // The filter is opt-in: it only appears guarded by filters.verification.
  const verifiedMentions = repository.match(/verifiedAt\b/g) ?? [];
  const guarded = repository.match(/filters\.verification === "(verified|pending)"\) clauses\.push\([^\n]*verifiedAt/g) ?? [];
  assert.ok(verifiedMentions.length >= guarded.length, "verifiedAt should only be used for opt-in filters and projection");
});

test("every branch caps and orders deterministically", () => {
  assert.equal((repository.match(/\.limit\(UNIFIED_QUEUE_LIMIT\)/g) ?? []).length, 3);
  assert.equal((repository.match(/desc\(priceChecks\.id\)|desc\(buyRequests\.id\)|desc\(sellSubmissions\.id\)/g) ?? []).length, 3);
  assert.match(repository, /\.sort\(compareQueueRecords\)\.slice\(0, UNIFIED_QUEUE_LIMIT\)/);
});

test("assignee filter supports the unassigned literal and fails closed on malformed ids", () => {
  assert.match(repository, /if \(assignee === UNASSIGNED_FILTER\) return isNull\(column\)/);
  assert.match(repository, /\/\^\[0-9A-HJKMNP-TV-Z\]\{26\}\$\//);
  // A malformed value must terminate the query, never be quietly dropped.
  assert.match(repository, /if \(filters\.assignee && !isAssigneeFilter\(filters\.assignee\)\) return \[\];/);
  assert.doesNotMatch(repository, /if \(!ADMIN_ID_PATTERN\.test\(assignee\)\) return null/);
  // The clause builder refuses rather than degrading if the guard is ever skipped.
  assert.match(repository, /if \(!isAssigneeFilter\(assignee\)\) throw new Error\("Malformed assignee filter\."\);/);
});

test("isAssigneeFilter accepts only the unassigned literal and an admin id", () => {
  assert.equal(isAssigneeFilter(UNASSIGNED_FILTER), true);
  assert.equal(isAssigneeFilter("0123456789ABCDEFGHJKMNP0TV"), true);
  for (const malformed of [
    "", " ", "unassigned ", "UNASSIGNED", "all", "*",
    "0123456789ABCDEFGHJKMNP0T",    // 25 characters
    "0123456789ABCDEFGHJKMNP0TVZ",  // 27 characters
    "0123456789abcdefghjkmnp0tv",   // lowercase
    "0123456789ABCDEFGHIJKMNP0T",   // I is excluded from Crockford base32
    "'; drop table buy_requests; --",
    "% or 1=1 --",
  ]) {
    assert.equal(isAssigneeFilter(malformed), false, `isAssigneeFilter(${JSON.stringify(malformed)}) must be false`);
  }
});

test("the queue page hands the assignee filter to the repository unmodified", () => {
  // Dropping a malformed value on the page would widen the result set before
  // the repository ever had a chance to refuse it.
  assert.match(queuePage, /assignee: rawAssignee \|\| undefined,/);
  assert.doesNotMatch(queuePage, /ADMIN_ID_PATTERN/);
  assert.match(queuePage, /defaultValue=\{isAssigneeFilter\(rawAssignee\) \? rawAssignee : ""\}/);
});

test("Price Check rows are conditional on the Price Check flag; Buy and Sell are not", () => {
  assert.match(repository, /if \(wanted\("price_check"\) && filters\.includePriceChecks\) branches\.push/);
  assert.match(repository, /if \(wanted\("buy_request"\)\) branches\.push/);
  assert.match(repository, /if \(wanted\("sell_submission"\)\) branches\.push/);
  assert.match(queuePage, /includePriceChecks: isPriceCheckEnabled\(\)/);
});

test("the unified page uses staff access, not Price Check access", () => {
  assert.match(queuePage, /import \{ getAdminAccess \} from "@\/lib\/price-check\/admin\/auth"/);
  assert.match(queuePage, /const access = await getAdminAccess\(\)/);
  assert.doesNotMatch(queuePage, /getPriceCheckAdminAccess/);
  // Staff console visibility must not depend on the public marketplace flags.
  assert.doesNotMatch(queuePage, /isMarketplaceEnabled|isSellSubmissionEnabled|NEXT_PUBLIC_MARKETPLACE_ENABLED|NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED/);
  assert.doesNotMatch(repository, /isMarketplaceEnabled|isSellSubmissionEnabled|NEXT_PUBLIC_MARKETPLACE_ENABLED|NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED/);
  // The repository reads no environment at all; flag decisions belong to callers.
  assert.doesNotMatch(repository, /process\.env/);
});

test("the unified page fails closed and stays uncached", () => {
  assert.match(queuePage, /redirect\("\/admin\/login"\)/);
  assert.match(queuePage, /redirect\("\/admin\/access-denied"\)/);
  assert.match(queuePage, /if \(access\.status !== "authorized"\) return <AdminAccessDenied unavailable \/>/);
  assert.match(queuePage, /export const dynamic = "force-dynamic"/);
});

test("page filters are strict allowlists", () => {
  assert.match(queuePage, /\(allowed as readonly string\[\]\)\.includes\(value\) \? value as T : undefined/);
  assert.match(queuePage, /filterableStatuses\.includes\(rawStatus\) \? rawStatus : undefined/);
  assert.match(queuePage, /one\("search"\)\.trim\(\)\.slice\(0, 120\)/);
});

test("All Work shows exact, filter-independent Buy and Sell concern links", () => {
  assert.match(queuePage, /countMarketplaceReviewStates\(priceCheckDb, \{ type: "buy_request" \}\)/);
  assert.match(queuePage, /countMarketplaceReviewStates\(priceCheckDb, \{ type: "sell_submission" \}\)/);
  assert.match(queuePage, /const concernTotal = buyReviewCounts\.concern \+ sellReviewCounts\.concern/);
  assert.match(queuePage, /href="\/admin\/buy-requests\?review=concern"/);
  assert.match(queuePage, /href="\/admin\/sell-submissions\?review=concern"/);
  assert.match(queuePage, /Business-review flags needing staff follow-up\. This is not certification or an airworthiness decision\./);
  assert.doesNotMatch(queuePage, /countMarketplaceReviewStates\(priceCheckDb, filters\)/);
});

test("no analytics is emitted from the admin surface", () => {
  for (const source of [queuePage, chrome, repository, read("app", "admin", "page.tsx")]) {
    assert.doesNotMatch(source, /trackCivilonEvent|dataLayer|civilonAnalytics/);
  }
});

test("every queue reference links to its own workflow's detail route", () => {
  assert.match(queuePage, /price_check: "\/admin\/price-checks",/);
  assert.match(queuePage, /buy_request: "\/admin\/buy-requests",/);
  assert.match(queuePage, /sell_submission: "\/admin\/sell-submissions",/);
  assert.match(queuePage, /<a href=\{`\$\{detailBasePath\[record\.type\]\}\/\$\{record\.id\}`\}>\{record\.publicReference\}<\/a>/);
  // No reference is rendered as inert text any more.
  assert.doesNotMatch(queuePage, /return <code>\{record\.publicReference\}<\/code>/);
});

test("admin navigation carries the unified queue on desktop and mobile", () => {
  assert.match(chrome, /type AdminArea = "queue" \| "price-checks" \| "buy-requests" \| "sell-submissions" \| "staff" \| "help"/);
  assert.match(chrome, /\{ key: "buy-requests" as const, href: "\/admin\/buy-requests", label: "Buy Requests" \}/);
  assert.match(chrome, /\{ key: "sell-submissions" as const, href: "\/admin\/sell-submissions", label: "Sell Submissions" \}/);
  assert.match(chrome, /\{ key: "queue" as const, href: "\/admin\/queue", label: "All Work" \}/);
  assert.match(chrome, /isPriceCheckEnabled\(\) \? \[\{ key: "price-checks" as const, href: "\/admin\/price-checks"/);
  assert.match(chrome, /<a href="\/admin\/queue" className="admin-wordmark">/);
  // Both navs render from the same links array, so mobile cannot drift from desktop.
  assert.equal((chrome.match(/\{links\.map\(link => <a key=\{link\.key\} href=\{link\.href\} aria-current=\{active === link\.key \? "page" : undefined\}>\{link\.label\}<\/a>\)\}/g) ?? []).length, 2);
  assert.match(chrome, /className="admin-desktop-nav" aria-label="Administration"/);
  assert.match(chrome, /className="admin-mobile-nav" aria-label="Mobile administration"/);
  // Existing surfaces are preserved.
  assert.match(chrome, /href: "\/admin\/staff", label: "Staff"/);
  assert.match(chrome, /href: "\/admin\/help", label: "Operations Guide"/);
});

test("the Price Check queue page changed only its active nav area", () => {
  const page = read("app", "admin", "price-checks", "page.tsx");
  assert.match(page, /<AdminChrome user=\{access\.user\} active="price-checks">/);
  // Its own access gate and repository calls are untouched.
  assert.match(page, /const access = await getPriceCheckAdminAccess\(\)/);
  assert.match(page, /repository\.listAdminPriceChecks\(priceCheckDb, filters\)/);
});

test("/admin redirects to the unified queue", () => {
  const page = read("app", "admin", "page.tsx");
  assert.match(page, /redirect\("\/admin\/queue"\)/);
});

test("repository symbols are re-exported through the established barrel", () => {
  assert.match(indexBarrel, /export \* from "\.\/marketplace-admin-repository\.ts";/);
});

test("display helpers label every status of all three workflows", () => {
  assert.equal(unifiedTypeLabels.price_check, "Price Check");
  assert.equal(unifiedTypeLabels.buy_request, "Buy Request");
  assert.equal(unifiedTypeLabels.sell_submission, "Sell Submission");
  assert.equal(unifiedStatusLabel("price_check", "needs_information"), "Needs information");
  assert.equal(unifiedStatusLabel("buy_request", "pending_verification"), "Pending verification");
  assert.equal(unifiedStatusLabel("sell_submission", "under_review"), "Under review");
  for (const status of buyRequestStatuses) {
    assert.notEqual(unifiedStatusLabel("buy_request", status), undefined);
  }
  for (const status of sellSubmissionStatuses) {
    assert.notEqual(unifiedStatusLabel("sell_submission", status), undefined);
  }
  // Unknown values degrade to something readable rather than blank.
  assert.equal(unifiedStatusLabel("buy_request", "some_future_status"), "some future status");
});
