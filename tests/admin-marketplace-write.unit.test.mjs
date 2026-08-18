import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  NOTE_MAX_LENGTH,
  UNASSIGNED_VALUE,
  isRecordId,
  validateInternalReview,
  validateMarketplaceAssignment,
  validateMarketplaceNote,
  validateMarketplaceStatusChange,
} from "../lib/marketplace/admin/validation.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const shared = read("lib", "marketplace", "admin", "write-routes.ts");
const writeRepo = read("db", "price-check", "repositories", "marketplace-write-repository.ts");
const detailRepo = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const actions = read("components", "admin", "MarketplaceDetailActions.tsx");
const buyDetail = read("components", "admin", "BuyRequestDetail.tsx");
const sellDetail = read("components", "admin", "SellSubmissionDetail.tsx");

const routeSpecs = [
  ["buy-requests", "buy_request", "status", "createStatusRoute"],
  ["buy-requests", "buy_request", "assignment", "createAssignmentRoute"],
  ["buy-requests", "buy_request", "notes", "createNoteRoute"],
  ["sell-submissions", "sell_submission", "status", "createStatusRoute"],
  ["sell-submissions", "sell_submission", "assignment", "createAssignmentRoute"],
  ["sell-submissions", "sell_submission", "notes", "createNoteRoute"],
];
const routes = routeSpecs.map(([segment, aggregate, action, factory]) => ({
  name: `app/api/admin/marketplace/${segment}/[id]/${action}/route.ts`,
  aggregate, action, factory,
  source: read("app", "api", "admin", "marketplace", segment, "[id]", action, "route.ts"),
}));

const ULID = "0123456789ABCDEFGHJKMNP0TV";

/* --------------------------------------------------------------- the routes */

test("all six routes exist, are node runtime, and bind the right aggregate", () => {
  assert.equal(routes.length, 6);
  for (const route of routes) {
    assert.match(route.source, /export const runtime = "nodejs"/, route.name);
    assert.match(route.source, new RegExp(`export const POST = ${route.factory}\\("${route.aggregate}"\\);`), route.name);
  }
});

test("every route is POST only with Allow: POST", () => {
  for (const route of routes) {
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.match(route.source, new RegExp(`export const ${method} = methodNotAllowed;`), `${route.name}: ${method}`);
    }
  }
  assert.match(shared, /headers\.set\("Allow", "POST"\)/);
  assert.match(shared, /privateJson\(\{ ok: false, error: "Method not allowed\." \}, 405\)/);
});

test("each handler uses its own capability and checks the origin before mutating", () => {
  const handlers = {
    createStatusRoute: "transition_marketplace",
    createAssignmentRoute: "assign_marketplace",
    createNoteRoute: "write_marketplace_note",
    createBusinessReviewRoute: "review_marketplace",
    createAttachmentReviewRoute: "review_marketplace",
    createEvidenceRequestRoute: "request_marketplace_evidence",
  };
  /**
   * The repository module each factory imports. The evidence request is the one
   * mutation that does not go through `marketplace-write-repository`: it mints a
   * credential, so it goes through its own service, which is the layer that
   * keeps the plaintext out of the route entirely.
   */
  const repositoryImport = {
    createEvidenceRequestRoute: "sell-evidence-request-service",
  };
  for (const [factory, capability] of Object.entries(handlers)) {
    const start = shared.indexOf(`export function ${factory}(`);
    assert.ok(start > 0, factory);
    const end = shared.indexOf("\n}\n", start);
    const body = shared.slice(start, end);
    assert.match(body, new RegExp(`requireStaffApi\\("${capability}"\\)`), factory);
    assert.match(body, /if \(access\.status !== "authorized"\) return accessErrorResponse\(access\.status\);/, factory);
    // The origin check is the first thing inside the try, before any await on
    // the body or any repository import.
    assert.ok(
      body.indexOf("verifyAdminMutationOrigin(request)") < body.indexOf("readJsonBody"),
      `${factory}: origin must be verified before the body is read`,
    );
    const repository = repositoryImport[factory] ?? "marketplace-write-repository";
    assert.ok(body.includes(repository), `${factory}: expected to import ${repository}`);
    assert.ok(
      body.indexOf("verifyAdminMutationOrigin(request)") < body.indexOf(repository),
      `${factory}: origin must be verified before any repository import`,
    );
  }
  // One per handler, and the handler count is the length of the map above.
  assert.equal(
    (shared.match(/verifyAdminMutationOrigin\(request\)/g) ?? []).length,
    Object.keys(handlers).length,
  );
});

test("the exceptional capability is enforced on the route, not just in the repository", () => {
  const start = shared.indexOf("export function createStatusRoute(");
  const body = shared.slice(start, shared.indexOf("\n}\n", start));
  assert.match(body, /const capability = marketplaceTransitionCapability\(aggregate, validation\.data\.expectedStatus, validation\.data\.to\);/);
  assert.match(body, /if \(!capability\) return privateJson\(\{ ok: false, error: "That status change is not permitted\." \}, 409\);/);
  assert.match(body, /if \(!roleCan\(access\.user\.role, capability\)\) return accessErrorResponse\("forbidden"\);/);
  // …and again inside the repository, which re-checks with the same policy.
  assert.match(writeRepo, /if \(!input\.roleCan\(input\.actor\.role, capability\)\) return \{ ok: false, reason: "forbidden_transition" \};/);
});

test("no write surface depends on any public product flag", () => {
  for (const source of [shared, writeRepo, actions, ...routes.map(r => r.source)]) {
    assert.doesNotMatch(source, /isPriceCheckEnabled|isMarketplaceEnabled|isSellSubmissionEnabled|NEXT_PUBLIC_/);
    assert.doesNotMatch(source, /getPriceCheckAdminAccess|requireAdminApi/);
    assert.doesNotMatch(source, /process\.env/);
  }
});

test("every client-visible error is generic and private", () => {
  // No provider, driver or record detail escapes.
  assert.doesNotMatch(shared, /error\.message|error\.name|String\(error\)|JSON\.stringify\(error\)|console\./);
  // One opaque catch per mutation handler: status, assignment, note, business
  // review, attachment review, evidence request.
  assert.equal((shared.match(/\} catch \{/g) ?? []).length, 6);
  // Every response is privateJson or an access error, never a bare Response.
  const bare = shared.match(/return new Response\(/g) ?? [];
  assert.equal(bare.length, 1, "only the 405 helper constructs a Response directly");
  assert.match(shared, /This record changed while you were working on it\. Reload and try again\./);
});

/* ------------------------------------------------------------- validation */

test("status change validation is strict on both fields", () => {
  const ok = validateMarketplaceStatusChange("buy_request", { expectedStatus: "verified", to: "sourcing" });
  assert.deepEqual(ok, { ok: true, data: { expectedStatus: "verified", to: "sourcing" } });

  for (const [label, body] of [
    ["missing body", null],
    ["array body", []],
    ["string body", "verified"],
    ["unknown key", { expectedStatus: "verified", to: "sourcing", force: true }],
    ["missing expectedStatus", { to: "sourcing" }],
    ["missing to", { expectedStatus: "verified" }],
    ["unknown expectedStatus", { expectedStatus: "nope", to: "sourcing" }],
    ["unknown to", { expectedStatus: "verified", to: "nope" }],
    ["cross-aggregate to", { expectedStatus: "verified", to: "under_review" }],
    ["no-op", { expectedStatus: "verified", to: "verified" }],
    ["numeric to", { expectedStatus: "verified", to: 1 }],
  ]) {
    const result = validateMarketplaceStatusChange("buy_request", body);
    assert.equal(result.ok, false, label);
    assert.equal(typeof result.error, "string", label);
    // The message never names the record or the actor.
    assert.doesNotMatch(result.error, /[0-9A-HJKMNP-TV-Z]{26}|@/, label);
  }
  // The Sell vocabulary is enforced separately.
  assert.equal(validateMarketplaceStatusChange("sell_submission", { expectedStatus: "verified", to: "under_review" }).ok, true);
  assert.equal(validateMarketplaceStatusChange("sell_submission", { expectedStatus: "verified", to: "sourcing" }).ok, false);
});

test("assignment validation accepts an id or an explicit unassign, nothing else", () => {
  assert.deepEqual(validateMarketplaceAssignment({ assigneeId: ULID }), { ok: true, data: { assigneeId: ULID } });
  assert.deepEqual(validateMarketplaceAssignment({ assigneeId: null }), { ok: true, data: { assigneeId: null } });
  assert.deepEqual(validateMarketplaceAssignment({ assigneeId: UNASSIGNED_VALUE }), { ok: true, data: { assigneeId: null } });

  for (const [label, body] of [
    ["missing body", null],
    ["unknown key", { assigneeId: ULID, role: "ADMIN" }],
    ["absent field", {}],
    ["lowercase id", { assigneeId: ULID.toLowerCase() }],
    ["short id", { assigneeId: ULID.slice(0, 25) }],
    ["long id", { assigneeId: `${ULID}X` }],
    ["sql", { assigneeId: "'; drop table buy_requests; --" }],
    ["numeric", { assigneeId: 7 }],
    ["object", { assigneeId: { id: ULID } }],
  ]) {
    assert.equal(validateMarketplaceAssignment(body).ok, false, label);
  }
  assert.equal(isRecordId(ULID), true);
  assert.equal(isRecordId("I".repeat(26)), false, "I is excluded from Crockford base32");
});

test("note validation bounds the text and rejects control characters", () => {
  assert.deepEqual(validateMarketplaceNote({ body: "  Sourcing started  " }), { ok: true, data: { body: "Sourcing started" } });
  assert.equal(validateMarketplaceNote({ body: "line one\nline two\tindented" }).ok, true);
  assert.equal(validateMarketplaceNote({ body: "a".repeat(NOTE_MAX_LENGTH) }).ok, true);
  assert.equal(NOTE_MAX_LENGTH, 4000);

  const NUL = String.fromCharCode(0);
  const BEL = String.fromCharCode(7);
  const DEL = String.fromCharCode(127);
  for (const [label, body] of [
    ["missing body", null],
    ["unknown key", { body: "x", redactedAt: null }],
    ["absent field", {}],
    ["blank", { body: "   " }],
    ["empty", { body: "" }],
    ["too long", { body: "a".repeat(NOTE_MAX_LENGTH + 1) }],
    ["numeric", { body: 12 }],
    ["nul", { body: `a${NUL}b` }],
    ["bel", { body: `a${BEL}b` }],
    ["del", { body: `a${DEL}b` }],
  ]) {
    assert.equal(validateMarketplaceNote(body).ok, false, label);
  }
  // No redaction or edit field is accepted: this slice appends only.
  assert.equal(validateMarketplaceNote({ body: "x", id: ULID }).ok, false);
});

test("internal review validation accepts only the three internal states", () => {
  for (const state of ["not_reviewed", "reviewed", "concern"]) {
    assert.deepEqual(validateInternalReview({ state }), { ok: true, data: { state } });
  }
  for (const body of [null, {}, { state: "verified" }, { state: "reviewed", score: 5 }, { state: 1 }]) {
    assert.equal(validateInternalReview(body).ok, false);
  }
});

/* ------------------------------------------------- write-path invariants */

test("the write repository is the only module that mutates, and it is transactional", () => {
  // The read repository stays read-only.
  assert.doesNotMatch(detailRepo, /db\.insert|db\.update|db\.delete|\.transaction\(/);
  // Each write opens exactly one transaction.
  assert.equal((writeRepo.match(/return db\.transaction\(async \(tx\) => \{/g) ?? []).length, 5);
  // The audit insert happens inside the transaction, on the tx handle.
  assert.equal((writeRepo.match(/await appendAudit\(tx, \{/g) ?? []).length, 5);
  assert.match(writeRepo, /await tx\.insert\(auditEvents\)\.values\(\{/);
  assert.doesNotMatch(writeRepo, /await db\.insert\(auditEvents\)/);
});

test("optimistic concurrency is in the update predicate, not only the read", () => {
  assert.match(writeRepo, /if \(current\.status !== input\.expectedStatus\) \{\s*return \{ ok: false, reason: "conflict", currentStatus: current\.status \};/);
  assert.match(writeRepo, /\.where\(and\(eq\(table\.id, input\.id\), eq\(table\.status, current\.status as typeof table\.status\.enumValues\[number\]\)\)\)/);
  assert.match(writeRepo, /if \(!updated\.length\) \{[\s\S]{0,220}?reason: "conflict" as const/);
});

test("intake columns are never rewritten", () => {
  const forbidden = [
    "submittedAt:", "publicReference:", "idempotencyHash:",
    "originalPartNumber:", "normalizedPartNumber:", "description:", "sourcePage:",
    "landingPage:", "referrerOrigin:", "utmSource:", "notes:", "documentsSummary:",
    "askingUnitPrice:", "quantity:",
  ];
  for (const token of forbidden) {
    assert.doesNotMatch(writeRepo, new RegExp(token.replace(":", "\\s*:")), `the write path must never set ${token}`);
  }
  // The only aggregate columns it sets.
  const sets = writeRepo.match(/\.set\(\{[\s\S]*?\}\)/g) ?? [];
  assert.equal(sets.length, 4, "status, assignment and the two internal review writes are the only updates");
  for (const block of sets) {
    assert.doesNotMatch(block, /submittedAt|publicReference|idempotency|contactId/);
  }
});

test("the manual override remains separate from internal business review", () => {
  assert.match(writeRepo, /\.\.\.\(manualVerification && !current\.verifiedAt \? \{ verifiedAt: now \} : \{\}\)/);
  assert.match(writeRepo, /verificationOverride: true, contactVerificationUnchanged: true/);
  const statusStart = writeRepo.indexOf("export async function changeMarketplaceStatus(");
  const statusEnd = writeRepo.indexOf("export type AssignmentResult", statusStart);
  const statusWrite = writeRepo.slice(statusStart, statusEnd);
  assert.doesNotMatch(statusWrite, /marketplaceContacts|businessReviewState/);
  const reviewStart = writeRepo.indexOf("export async function setContactBusinessReview(");
  const reviewEnd = writeRepo.indexOf("export async function setAttachmentReview(", reviewStart);
  const businessReviewWrite = writeRepo.slice(reviewStart, reviewEnd);
  assert.match(businessReviewWrite, /businessReviewState: input\.state/);
  assert.doesNotMatch(businessReviewWrite, /verificationState|verificationRequestedAt|verificationRevokedAt|verifiedAt:/);
});

test("closed_at is set for terminal states only", () => {
  assert.match(writeRepo, /\.\.\.\(marketplaceStatusClosesRecord\(input\.to\) \? \{ closedAt: now \} : \{\}\)/);
  assert.doesNotMatch(writeRepo, /closedAt: null/);
});

test("notes are append-only and never leave the record", () => {
  assert.match(writeRepo, /await tx\.insert\(marketplaceNotes\)\.values\(\{/);
  assert.doesNotMatch(writeRepo, /update\(marketplaceNotes\)|delete\(marketplaceNotes\)|redactedAt/);
  // The note body never reaches the audit metadata, an outbox row, or a template.
  assert.match(writeRepo, /metadata: \{ noteId, length: input\.body\.length \}/);
  // Identifiers, not prose: the comments legitimately say "no template is
  // rendered", and that sentence must not be what makes this pass.
  const deliveryIdentifiers = /notificationOutbox|enqueueNotification|PostmarkTransactionalEmailProvider|TransactionalEmail|sendMail|buyRequestInternalEmail|sellSubmissionInternalEmail/;
  for (const source of [writeRepo, shared, ...routes.map(r => r.source)]) {
    assert.doesNotMatch(source, deliveryIdentifiers);
  }
  // The note body is not passed to anything but the notes insert.
  assert.equal((writeRepo.match(/input.body/g) ?? []).length, 2);
  // The aggregate binding matches the schema's marketplace_notes_aggregate_chk.
  assert.match(writeRepo, /buyRequestId: input\.aggregate === "buy_request" \? input\.id : null,/);
  assert.match(writeRepo, /sellSubmissionId: input\.aggregate === "sell_submission" \? input\.id : null,/);
});

/* -------------------------------------------------------------------- the UI */

test("the detail views stay server-rendered; only the actions component writes", () => {
  for (const [name, source] of [["BuyRequestDetail", buyDetail], ["SellSubmissionDetail", sellDetail]]) {
    assert.doesNotMatch(source, /"use client"|fetch\(|useRouter|useState|onClick=|onSubmit=/, `${name} must stay server-rendered`);
  }
  assert.match(actions, /^"use client";/);
  assert.match(actions, /const router = useRouter\(\);/);
  assert.match(actions, /router\.refresh\(\);/);
  assert.match(actions, /credentials: "same-origin"/);
  assert.match(actions, /"Content-Type": "application\/json"/);
});

test("the action panel is accessible and silent", () => {
  assert.match(actions, /role="alert"/);
  assert.match(actions, /role="status"/);
  assert.match(actions, /aria-label="Record actions"/);
  // No analytics, no notification, no customer-facing anything.
  assert.doesNotMatch(actions, /trackCivilonEvent|dataLayer|civilonAnalytics|mailto:|notify/i);
  assert.match(actions, /Never sent to a buyer or a supplier\./);
});

test("the client is offered only the transitions the server authorized", () => {
  const access = read("lib", "price-check", "admin", "marketplace-access.ts");
  assert.match(access, /statusOptions: allowedMarketplaceTransitions\(input\.aggregate, input\.currentStatus, input\.role, can\)/);
  assert.match(actions, /statusOptions\.map\(\(status\)/);
  // The component computes no policy of its own.
  assert.doesNotMatch(actions, /pending_verification|sourcing|under_review|marketplaceGraphTargets|canTransitionMarketplace/);
});

test("the Buy detail keeps supplier sourcing and the Civilon offer separate from the actions", () => {
  const actionsIndex = buyDetail.indexOf("<MarketplaceDetailActions");
  const supplierIndex = buyDetail.indexOf('aria-label="Supplier responses"');
  const offerIndex = buyDetail.indexOf('aria-label="Civilon buyer offers"');
  assert.ok(actionsIndex > 0 && supplierIndex > 0 && offerIndex > 0);
  // The action panel sits outside both economic sections.
  assert.ok(actionsIndex > offerIndex, "actions must not be nested inside the offer block");
  // And it carries no supplier or offer field.
  // Identifiers, not prose: the panel legitimately says a note is never sent to
  // "a buyer or a supplier", and that sentence must not be what makes this pass.
  assert.doesNotMatch(
    actions,
    /supplierResponses|supplierUnitCost|supplierNameSnapshot|supplierContactSnapshot|buyerOffers|civilonSaleUnitPrice|selectedSupplierResponseId/,
  );
});
