import assert from "node:assert/strict";
import test from "node:test";
import { NetlifyDB } from "@netlify/database-dev";

import { expectedMigrationCount } from "./helpers/migration-archive.mjs";

const migrationsDirectory = new URL(
  "../db/price-check/migrations-netlify-archive/",
  import.meta.url,
).pathname.replace(/^\/(\w:)/, "$1");

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  try {
    const applied = await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, applied });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

async function seedReadyAnalysis(db) {
  const { bindOrAuthorizeAdmin, changePriceCheckStatus } = await import("../db/price-check/repositories/admin-repository.ts");
  const { createPriceCheckRequest } = await import("../db/price-check/repositories/request-repository.ts");
  const { createGovernedObservation, listCandidateObservations, runGovernedAnalysis } = await import("../db/price-check/repositories/comparable-repository.ts");
  const bound = await bindOrAuthorizeAdmin(db, { issuer: "https://accounts.google.com", subject: "phase6-admin", email: "hakannex@gmail.com", provider: "google-oidc", authenticationMethods: ["pwd", "mfa"] }, true);
  const actor = bound.user;
  const request = await createPriceCheckRequest(db, {
    requester: { firstName: "Synthetic", lastName: "Customer", companyName: "Example Phase 6 Aviation", businessEmail: "phase6-result@example.com", phone: "+1 202 555 0166", role: "Buyer", country: "US", serviceProcessingAcknowledgedAt: new Date() },
    transaction: { originalPartNumber: "TEST-PHASE6-100", description: "Synthetic component", quantity: "1", quoteOrPurchased: "quote", transactionType: "outright", conditionCode: "SV", unitPrice: "1175", currencyCode: "USD", coreDisposition: "NOT_APPLICABLE", aog: false, transactionDate: "2026-08-01" },
    documentation: [{ code: "FAA_8130_3" }], attribution: { sourcePage: "/price-check" }, idempotencyHash: crypto.randomUUID(), correlationId: crypto.randomUUID(),
  });
  await changePriceCheckStatus(db, { priceCheckId: request.priceCheckId, to: "ready_for_analysis", actor });
  for (const [index, price] of ["900", "1000", "1100", "1200", "1300", "1400"].entries()) await createGovernedObservation(db, { actor, documentationCodes: ["FAA_8130_3"], observation: { provenanceType: "ANALYST_OBSERVATION", internalSourceReference: `PHASE6-${index}`, originalPartNumber: "TEST-PHASE6-100", normalizedPartNumber: "TESTPHASE6100", conditionCode: "SV", transactionType: "outright", quantity: "1.000", unitPrice: price, currencyCode: "USD", coreCharge: null, coreDisposition: "NOT_APPLICABLE", exchangeFee: null, freight: null, observationDate: "2026-07-01", warrantyValue: null, warrantyUnit: null, warrantyText: null, aog: false, aircraftApplication: null, regionContext: "US", sourceReliability: "HIGH", verificationState: "VERIFIED", permittedUseState: "INTERNAL_ANALYSIS" } });
  const candidates = await listCandidateObservations(db, "TEST-PHASE6-100", { scope: "related" });
  const analysis = await runGovernedAnalysis(db, { priceCheckId: request.priceCheckId, actor, decisions: candidates.candidates.map((item) => ({ observationId: item.id, included: true, reasonCode: "EXACT_MATCH", analystNote: "Synthetic Phase 6 evidence." })), confidence: "MEDIUM", confidenceReason: "Six exact synthetic observations.", today: "2026-08-16" });
  await changePriceCheckStatus(db, { priceCheckId: request.priceCheckId, to: "analysis_ready", actor });
  return { actor, request, analysis };
}

test("draft, approval, secure delivery, redemption, and sourcing conversion are versioned and private", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    assert.equal(applied.length, expectedMigrationCount());
    const { eq } = await import("drizzle-orm");
    const repository = await import("../db/price-check/repositories/result-delivery-repository.ts");
    const { processOneResultNotification } = await import("../lib/price-check/email/worker.ts");
    const { deriveResultToken, verifyResultSession, createResultSession } = await import("../db/price-check/domain/customer-result.ts");
    const { actor, request, analysis } = await seedReadyAnalysis(db);
    const tokenKey = "phase6-integration-token-key-with-at-least-thirty-two-characters";
    const draft = await repository.createCustomerResultDraft(db, { priceCheckId: request.priceCheckId, analysisId: analysis.analysis.id, actor, explanation: "Civilon reviewed the submitted price against six exact-part-number serviceable outright observations in the approved evidence set.", factorCodes: [], displayRange: true, displayEvidenceCount: true, limitedEvidenceStatement: null });
    assert.equal(draft.state, "DRAFT");
    assert.equal(draft.approvedClassification, "WITHIN_OBSERVED_RANGE");
    await assert.rejects(repository.approveCustomerResult(db, { priceCheckId: request.priceCheckId, resultId: draft.id, actor: { ...actor, role: "ANALYST" } }), /Reviewer authority/);
    const approved = await repository.approveCustomerResult(db, { priceCheckId: request.priceCheckId, resultId: draft.id, actor });
    assert.equal(approved.state, "APPROVED");
    const queued = await repository.queueCustomerResultDelivery(db, { priceCheckId: request.priceCheckId, resultId: draft.id, actor, tokenKey, now: new Date("2026-08-16T12:00:00Z") });
    assert.equal(queued.queued, true);
    assert.equal((await repository.queueCustomerResultDelivery(db, { priceCheckId: request.priceCheckId, resultId: draft.id, actor, tokenKey, now: new Date("2026-08-16T12:01:00Z") })).queued, false);
    const captured = [];
    process.env.PRICE_CHECK_RESULT_TOKEN_KEY = tokenKey;
    process.env.URL = "https://deploy-preview-6--cvlon.netlify.app";
    process.env.PRICE_CHECK_EMAIL_FROM = "Civilon Price Check <pricecheck@cvlon.com>";
    const provider = { async send(message) { captured.push(message); return { providerMessageId: "sandbox-message-1", submittedAt: "2026-08-16T12:02:00Z" }; } };
    const sent = await processOneResultNotification(db, { provider, now: new Date("2026-08-16T12:02:00Z"), leaseOwner: "worker-one" });
    assert.equal(sent.status, "succeeded");
    assert.equal(captured.length, 1);
    assert.match(captured[0].textBody, /\/price-check\/result\/redeem\?token=/);
    assert.doesNotMatch(captured[0].subject, /TEST-PHASE6|1175|supplier/i);
    const idle = await processOneResultNotification(db, { provider, now: new Date("2026-08-16T12:03:00Z"), leaseOwner: "worker-two" });
    assert.equal(idle.status, "idle");
    assert.equal(captured.length, 1);
    const [tokenRow] = await db.select().from(schema.resultAccessTokens).where(eq(schema.resultAccessTokens.resultId, draft.id));
    assert.equal(tokenRow.keyedTokenHash.includes("phase6"), false);
    const credential = deriveResultToken(tokenKey, tokenRow.tokenDerivationNonce);
    const redeemed = await repository.redeemResultToken(db, { token: credential, tokenKey, now: new Date("2026-08-16T12:04:00Z") });
    assert.ok(redeemed);
    assert.equal(await repository.redeemResultToken(db, { token: `${credential}x`, tokenKey, now: new Date("2026-08-16T12:04:00Z") }), null);
    const cookie = createResultSession(tokenKey, redeemed);
    assert.equal(verifyResultSession(tokenKey, cookie, new Date("2026-08-16T12:05:00Z").valueOf()).resultId, draft.id);
    const customer = await repository.getCustomerResult(db, { ...redeemed, now: new Date("2026-08-16T12:05:00Z") });
    assert.equal(customer.analysis.marketMedian, "1150.0000");
    assert.equal(customer.result.approvedExplanation.includes("six exact"), true);
    const conversion = await repository.createResultSourcingOpportunity(db, { ...redeemed, now: new Date("2026-08-16T12:06:00Z") });
    assert.equal(conversion.created, true);
    assert.equal((await repository.createResultSourcingOpportunity(db, { ...redeemed, now: new Date("2026-08-16T12:07:00Z") })).created, false);
    const [finalResult] = await db.select().from(schema.priceCheckResults).where(eq(schema.priceCheckResults.id, draft.id));
    assert.equal(finalResult.state, "SENT");
    const actions = await db.select({ action: schema.auditEvents.action }).from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, request.priceCheckId));
    for (const action of ["RESULT_DRAFT_CREATED", "RESULT_APPROVED", "RESULT_TOKEN_ISSUED", "RESULT_DELIVERY_QUEUED", "RESULT_DELIVERY_SUCCEEDED", "RESULT_VIEWED", "SOURCING_OPPORTUNITY_CREATED"]) assert.ok(actions.some((item) => item.action === action), action);
    delete process.env.PRICE_CHECK_RESULT_TOKEN_KEY; delete process.env.URL; delete process.env.PRICE_CHECK_EMAIL_FROM;
  });
});

test("provider failure stays approved and remains retryable without losing the result", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const repository = await import("../db/price-check/repositories/result-delivery-repository.ts");
    const { processOneResultNotification } = await import("../lib/price-check/email/worker.ts");
    const { actor, request, analysis } = await seedReadyAnalysis(db);
    const tokenKey = "phase6-failure-token-key-with-at-least-thirty-two-characters";
    const draft = await repository.createCustomerResultDraft(db, { priceCheckId: request.priceCheckId, analysisId: analysis.analysis.id, actor, explanation: "Civilon completed a human review of the approved deterministic evidence and retained the result for retry-safe delivery.", factorCodes: [], displayRange: true, displayEvidenceCount: true, limitedEvidenceStatement: null });
    await repository.approveCustomerResult(db, { priceCheckId: request.priceCheckId, resultId: draft.id, actor });
    await repository.queueCustomerResultDelivery(db, { priceCheckId: request.priceCheckId, resultId: draft.id, actor, tokenKey, now: new Date("2026-08-16T12:00:00Z") });
    process.env.PRICE_CHECK_RESULT_TOKEN_KEY = tokenKey; process.env.URL = "https://deploy-preview-6--cvlon.netlify.app";
    const failed = await processOneResultNotification(db, { provider: { async send() { throw new Error("POSTMARK_TIMEOUT"); } }, now: new Date("2026-08-16T12:01:00Z"), leaseOwner: "failure-worker" });
    assert.equal(failed.status, "retry");
    const [result] = await db.select().from(schema.priceCheckResults).where(eq(schema.priceCheckResults.id, draft.id));
    const [message] = await db.select().from(schema.notificationOutbox).where(eq(schema.notificationOutbox.aggregateId, draft.id));
    assert.equal(result.state, "APPROVED");
    assert.equal(message.state, "failed");
    assert.equal(message.sanitizedFailureCode, "POSTMARK_TIMEOUT");
    delete process.env.PRICE_CHECK_RESULT_TOKEN_KEY; delete process.env.URL;
  });
});

test("a new deterministic analysis supersedes the approved result and revokes its access token", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const repository = await import("../db/price-check/repositories/result-delivery-repository.ts");
    const { listCandidateObservations, runGovernedAnalysis } = await import("../db/price-check/repositories/comparable-repository.ts");
    const { actor, request, analysis } = await seedReadyAnalysis(db);
    const tokenKey = "phase6-invalidation-key-with-at-least-thirty-two-characters";
    const draft = await repository.createCustomerResultDraft(db, {
      priceCheckId: request.priceCheckId,
      analysisId: analysis.analysis.id,
      actor,
      explanation: "Civilon completed a human review of the approved deterministic evidence before the analysis was revised.",
      factorCodes: [],
      displayRange: true,
      displayEvidenceCount: true,
      limitedEvidenceStatement: null,
    });
    await repository.approveCustomerResult(db, { priceCheckId: request.priceCheckId, resultId: draft.id, actor });
    await repository.queueCustomerResultDelivery(db, { priceCheckId: request.priceCheckId, resultId: draft.id, actor, tokenKey, now: new Date("2026-08-16T13:00:00Z") });

    const candidates = await listCandidateObservations(db, "TEST-PHASE6-100", { scope: "related" });
    const revised = await runGovernedAnalysis(db, {
      priceCheckId: request.priceCheckId,
      actor,
      decisions: candidates.candidates.map((item) => ({ observationId: item.id, included: true, reasonCode: "EXACT_MATCH", analystNote: "Revised synthetic analysis." })),
      confidence: "HIGH",
      confidenceReason: "The reviewer explicitly revised the deterministic analysis.",
      today: "2026-08-16",
    });

    const [priceCheck] = await db.select().from(schema.priceChecks).where(eq(schema.priceChecks.id, request.priceCheckId));
    const [oldResult] = await db.select().from(schema.priceCheckResults).where(eq(schema.priceCheckResults.id, draft.id));
    const [oldToken] = await db.select().from(schema.resultAccessTokens).where(eq(schema.resultAccessTokens.resultId, draft.id));
    assert.equal(revised.analysis.version, 2);
    assert.equal(priceCheck.currentAnalysisId, revised.analysis.id);
    assert.equal(priceCheck.currentResultId, null);
    assert.equal(priceCheck.status, "analysis_ready");
    assert.equal(oldResult.state, "SUPERSEDED");
    assert.ok(oldResult.supersededAt);
    assert.ok(oldToken.revokedAt);
    const actions = await db.select({ action: schema.auditEvents.action }).from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, request.priceCheckId));
    assert.ok(actions.some((item) => item.action === "RESULT_APPROVAL_INVALIDATED"));
  });
});
