import assert from "node:assert/strict";
import test from "node:test";
import { NetlifyDB } from "@netlify/database-dev";

import { expectedMigrationCount } from "./helpers/migration-archive.mjs";

import { draftFor } from "./fixtures/price-check-phase-9-golden.mjs";

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

async function seedAnalysis(db, schema, suffix = "P9") {
  const { bindOrAuthorizeAdmin, changePriceCheckStatus } = await import("../db/price-check/repositories/admin-repository.ts");
  const { createPriceCheckRequest } = await import("../db/price-check/repositories/request-repository.ts");
  const { createGovernedObservation, listCandidateObservations, runGovernedAnalysis } = await import("../db/price-check/repositories/comparable-repository.ts");
  const actor = (await bindOrAuthorizeAdmin(db, { issuer: "https://accounts.google.com", subject: `phase9-${suffix}`, email: "hakannex@gmail.com", provider: "google-oidc", authenticationMethods: ["pwd", "mfa"] }, true)).user;
  const created = await createPriceCheckRequest(db, {
    requester: { firstName: "Synthetic", lastName: "Reviewer", companyName: "Example Aviation", businessEmail: `phase9-${suffix.toLowerCase()}@example.com`, role: "Buyer", country: "US", serviceProcessingAcknowledgedAt: new Date() },
    transaction: { originalPartNumber: `TEST-${suffix}`, description: "Synthetic component", quantity: "1", quoteOrPurchased: "quote", transactionType: "outright", conditionCode: "SV", unitPrice: "1100", currencyCode: "USD", coreDisposition: "NOT_APPLICABLE", aog: false },
    documentation: [{ code: "FAA_8130_3" }], attribution: { sourcePage: "/price-check" }, idempotencyHash: crypto.randomUUID(), correlationId: crypto.randomUUID(),
  });
  await changePriceCheckStatus(db, { priceCheckId: created.priceCheckId, to: "ready_for_analysis", actor });
  for (const price of ["900.00", "1100.00", "1300.00"]) {
    await createGovernedObservation(db, { actor, documentationCodes: ["FAA_8130_3"], observation: {
      provenanceType: "ANALYST_OBSERVATION", internalSourceReference: `PHASE9-${crypto.randomUUID()}`,
      originalPartNumber: `TEST-${suffix}`, normalizedPartNumber: `TEST${suffix}`, conditionCode: "SV", transactionType: "outright", quantity: "1.000", unitPrice: price, currencyCode: "USD",
      coreCharge: null, coreDisposition: "NOT_APPLICABLE", exchangeFee: null, freight: null, observationDate: "2026-08-01", warrantyValue: null, warrantyUnit: null, warrantyText: null,
      aog: false, aircraftApplication: null, regionContext: "US", sourceReliability: "HIGH", verificationState: "VERIFIED", permittedUseState: "INTERNAL_ANALYSIS",
    } });
  }
  const candidates = await listCandidateObservations(db, `TEST-${suffix}`, { scope: "related" });
  const decisions = candidates.candidates.map((candidate) => ({ observationId: candidate.id, included: true, reasonCode: "EXACT_MATCH", analystNote: "Synthetic Phase Nine fixture." }));
  const first = await runGovernedAnalysis(db, { priceCheckId: created.priceCheckId, actor, decisions, confidence: "HIGH", confidenceReason: "Controlled synthetic exact part evidence.", today: "2026-08-16" });
  await changePriceCheckStatus(db, { priceCheckId: created.priceCheckId, to: "analysis_ready", actor });
  return { actor, priceCheckId: created.priceCheckId, first, decisions, runGovernedAnalysis };
}

test("AI explanation jobs are idempotent, versioned, review-only, and stale-protected", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    const { eq } = await import("drizzle-orm");
    const repository = await import("../db/price-check/repositories/explanation-repository.ts");
    assert.equal(applied.length, expectedMigrationCount());
    const seeded = await seedAnalysis(db, schema);
    const config = { model: "test-explanation-model", schemaVersion: "phase9-v1", promptVersion: "phase9-v1" };
    const queued = await repository.queueExplanationDraft(db, { priceCheckId: seeded.priceCheckId, analysisId: seeded.first.analysis.id, actor: seeded.actor, config, regenerate: false });
    const duplicate = await repository.queueExplanationDraft(db, { priceCheckId: seeded.priceCheckId, analysisId: seeded.first.analysis.id, actor: seeded.actor, config, regenerate: false });
    assert.equal(queued.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.job.id, queued.job.id);
    await assert.rejects(repository.queueExplanationDraft(db, { priceCheckId: seeded.priceCheckId, analysisId: seeded.first.analysis.id, actor: { ...seeded.actor, role: "AUDITOR" }, config, regenerate: false }), /ACCESS_DENIED/);
    await assert.rejects(repository.queueExplanationDraft(db, { priceCheckId: seeded.priceCheckId, analysisId: "01M00000000000000000000000", actor: seeded.actor, config, regenerate: false }), /ANALYSIS_NOT_CURRENT/);

    const leaseOwner = "phase9-worker";
    assert.ok(await repository.leaseExplanationJob(db, { jobId: queued.job.id, leaseOwner, now: new Date(), leaseUntil: new Date(Date.now() + 60_000) }));
    const jobContext = await repository.getExplanationJobContext(db, queued.job.id, leaseOwner);
    const draft = draftFor(jobContext.context);
    const artifact = await repository.storeExplanationSuccess(db, {
      jobId: queued.job.id, leaseOwner, priceCheckId: seeded.priceCheckId, analysisId: seeded.first.analysis.id,
      analysisVersion: seeded.first.analysis.version, analysisDigest: seeded.first.analysis.deterministicCalculationDigest,
      model: config.model, schemaVersion: config.schemaVersion, promptVersion: config.promptVersion, policyVersion: "phase9-minimum-analysis-enums-v1",
      requestDigest: "a".repeat(64), draft, latencyMs: 40, usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110 },
    });
    assert.equal(artifact.validationState, "VALID");
    assert.deepEqual(Object.keys(artifact.structuredResponse).sort(), ["binding", "draft"]);
    assert.equal(JSON.stringify(artifact.structuredResponse).includes("phase9-p9@example.com"), false);

    const appliedDraft = await repository.applyExplanationDraft(db, { priceCheckId: seeded.priceCheckId, analysisId: seeded.first.analysis.id, artifactId: artifact.id, actor: seeded.actor });
    assert.equal(appliedDraft.artifactId, artifact.id);
    assert.equal(appliedDraft.draft.classification, seeded.first.analysis.classification);
    assert.equal((await repository.validateResultAiProvenance(db, { priceCheckId: seeded.priceCheckId, analysisId: seeded.first.analysis.id, artifactId: artifact.id })).id, artifact.id);

    const regeneration = await repository.queueExplanationDraft(db, { priceCheckId: seeded.priceCheckId, analysisId: seeded.first.analysis.id, actor: seeded.actor, config, regenerate: true });
    assert.equal(regeneration.created, true);
    assert.notEqual(regeneration.job.id, queued.job.id);
    assert.notEqual(regeneration.job.idempotencyKey, queued.job.idempotencyKey);
    const beforeChange = await repository.getAdminExplanationWorkspace(db, seeded.priceCheckId);
    assert.equal(beforeChange.status, "QUEUED");
    assert.equal(beforeChange.current.id, artifact.id);

    const second = await seeded.runGovernedAnalysis(db, { priceCheckId: seeded.priceCheckId, actor: seeded.actor, decisions: seeded.decisions, confidence: "MEDIUM", confidenceReason: "Synthetic rerun creates a new deterministic version.", today: "2026-08-16" });
    assert.notEqual(second.analysis.id, seeded.first.analysis.id);
    const { processExplanationJob } = await import("../lib/price-check/explanation/service.ts");
    const racedJob = await processExplanationJob(db, { jobId: regeneration.job.id, config: { ...config, apiKey: "unused-test-key", timeoutMs: 1000 } });
    assert.deepEqual(racedJob, { state: "failed", errorCode: "EXPLANATION_ANALYSIS_STALE" });
    await assert.rejects(repository.applyExplanationDraft(db, { priceCheckId: seeded.priceCheckId, analysisId: seeded.first.analysis.id, artifactId: artifact.id, actor: seeded.actor }), /ANALYSIS_NOT_CURRENT/);
    await assert.rejects(repository.validateResultAiProvenance(db, { priceCheckId: seeded.priceCheckId, analysisId: second.analysis.id, artifactId: artifact.id }), /STALE_OR_UNAVAILABLE/);
    const afterChange = await repository.getAdminExplanationWorkspace(db, seeded.priceCheckId);
    assert.equal(afterChange.status, "STALE");
    assert.equal(afterChange.history.find((item) => item.id === artifact.id).state, "STALE");

    const actions = (await db.select({ action: schema.auditEvents.action }).from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, seeded.priceCheckId))).map((item) => item.action);
    for (const action of ["AI_EXPLANATION_REQUESTED", "AI_EXPLANATION_READY", "AI_EXPLANATION_APPLIED", "AI_EXPLANATION_FAILED"]) assert.ok(actions.includes(action), action);
    assert.equal((await db.select().from(schema.aiArtifacts)).length, 2);
    assert.equal((await db.select().from(schema.processingJobs).where(eq(schema.processingJobs.jobType, "EXPLANATION_DRAFT"))).length, 2);
  });
});

test("rejected provider output stores only safe failure metadata and leaves manual drafting available", async () => {
  await withDatabase(async ({ db, schema }) => {
    const repository = await import("../db/price-check/repositories/explanation-repository.ts");
    const seeded = await seedAnalysis(db, schema, "FAIL");
    const config = { model: "test-explanation-model", schemaVersion: "phase9-v1", promptVersion: "phase9-v1" };
    const queued = await repository.queueExplanationDraft(db, { priceCheckId: seeded.priceCheckId, analysisId: seeded.first.analysis.id, actor: seeded.actor, config, regenerate: false });
    const leaseOwner = "phase9-failure-worker";
    await repository.leaseExplanationJob(db, { jobId: queued.job.id, leaseOwner, now: new Date(), leaseUntil: new Date(Date.now() + 60_000) });
    const artifact = await repository.recordExplanationFailure(db, {
      jobId: queued.job.id, leaseOwner, priceCheckId: seeded.priceCheckId, analysisId: seeded.first.analysis.id,
      model: config.model, schemaVersion: config.schemaVersion, promptVersion: config.promptVersion, policyVersion: "phase9-minimum-analysis-enums-v1",
      requestDigest: "b".repeat(64), errorCode: "EXPLANATION_PROHIBITED_LANGUAGE", rejected: true,
    });
    assert.equal(artifact.validationState, "INVALID");
    assert.deepEqual(artifact.structuredResponse, { rejectionCodes: ["EXPLANATION_PROHIBITED_LANGUAGE"] });
    const workspace = await repository.getAdminExplanationWorkspace(db, seeded.priceCheckId);
    assert.equal(workspace.status, "FAILED");
    assert.equal(workspace.current, null);
  });
});
