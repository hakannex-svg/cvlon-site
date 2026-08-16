import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

const migrationsDirectory = new URL("../netlify/database/migrations/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

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
    await run({ server, db, schema, applied });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

async function seedAdmin(db, email = "hakannex@gmail.com") {
  const { bindOrAuthorizeAdmin } = await import("../db/price-check/repositories/admin-repository.ts");
  const result = await bindOrAuthorizeAdmin(db, { issuer: "https://accounts.google.com", subject: `google-${email}`, email, provider: "google-oidc", authenticationMethods: ["pwd", "mfa"] }, true);
  return result.user;
}

async function seedRequest(db, suffix, transaction = {}) {
  const { createPriceCheckRequest } = await import("../db/price-check/repositories/request-repository.ts");
  const created = await createPriceCheckRequest(db, {
    requester: { firstName: "Synthetic", lastName: "Analyst", companyName: "Example Phase 5 Aviation", businessEmail: `phase5-${suffix.toLowerCase()}@example.com`, phone: "+1 202 555 0155", role: "Buyer", country: "US", serviceProcessingAcknowledgedAt: new Date() },
    transaction: { originalPartNumber: `TEST-${suffix}`, description: "Synthetic Phase 5 component", quantity: "1", quoteOrPurchased: "quote", transactionType: "outright", conditionCode: "SV", unitPrice: "1175", currencyCode: "USD", coreCharge: null, coreDisposition: "NOT_APPLICABLE", exchangeFee: null, freight: null, transactionDate: "2026-08-01", aircraftModel: "Synthetic aircraft", aog: false, warrantyValue: "12", warrantyUnit: "MONTHS", warrantyText: null, notes: "Synthetic only", ...transaction },
    documentation: [{ code: "FAA_8130_3" }],
    attribution: { sourcePage: "/price-check" },
    idempotencyHash: crypto.randomUUID(), correlationId: crypto.randomUUID(),
  });
  return created;
}

async function createObservation(db, actor, partNumber, price, overrides = {}) {
  const { createGovernedObservation } = await import("../db/price-check/repositories/comparable-repository.ts");
  return createGovernedObservation(db, {
    actor,
    documentationCodes: ["FAA_8130_3"],
    observation: {
      provenanceType: "ANALYST_OBSERVATION", internalSourceReference: `SYNTHETIC-${crypto.randomUUID()}`,
      originalPartNumber: partNumber, normalizedPartNumber: partNumber.replaceAll("-", ""), conditionCode: "SV", transactionType: "outright", quantity: "1.000", unitPrice: price, currencyCode: "USD",
      coreCharge: null, coreDisposition: "NOT_APPLICABLE", exchangeFee: null, freight: null, observationDate: "2026-07-01", warrantyValue: "12.00", warrantyUnit: "MONTHS", warrantyText: null,
      aog: false, aircraftApplication: "Synthetic aircraft", regionContext: "US", sourceReliability: "HIGH", verificationState: "VERIFIED", permittedUseState: "INTERNAL_ANALYSIS", ...overrides,
    },
  });
}

test("selected exact-PN observations create immutable deterministic versions and gate analysis_ready", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    const { eq, asc } = await import("drizzle-orm");
    const { changePriceCheckStatus } = await import("../db/price-check/repositories/admin-repository.ts");
    const { listCandidateObservations, runGovernedAnalysis } = await import("../db/price-check/repositories/comparable-repository.ts");
    assert.equal(applied.length, 5);
    const actor = await seedAdmin(db);
    const request = await seedRequest(db, "SV-100");
    await changePriceCheckStatus(db, { priceCheckId: request.priceCheckId, to: "ready_for_analysis", actor });
    for (const price of ["900.00", "1000.00", "1100.00", "1200.00", "1300.00", "1400.00"]) await createObservation(db, actor, "TEST-SV-100", price);
    const candidates = await listCandidateObservations(db, "TEST-SV-100", { scope: "related" });
    assert.equal(candidates.candidates.length, 6);
    const decisions = candidates.candidates.map((candidate) => ({ observationId: candidate.id, included: true, reasonCode: "EXACT_MATCH", analystNote: "Synthetic exact-PN fixture." }));
    const first = await runGovernedAnalysis(db, { priceCheckId: request.priceCheckId, actor, decisions, confidence: "MEDIUM", confidenceReason: "Six exact-PN synthetic observations.", today: "2026-08-16" });
    assert.equal(first.analysis.version, 1);
    assert.equal(first.analysis.marketLow, "900.0000");
    assert.equal(first.analysis.marketMedian, "1150.0000");
    assert.equal(first.analysis.marketHigh, "1400.0000");
    assert.equal(first.payload.pricePosition, "WITHIN_OBSERVED_RANGE");
    assert.equal(first.payload.selectedCount, 6);
    await changePriceCheckStatus(db, { priceCheckId: request.priceCheckId, to: "analysis_ready", actor });
    const [ready] = await db.select().from(schema.priceChecks).where(eq(schema.priceChecks.id, request.priceCheckId));
    assert.equal(ready.status, "analysis_ready");
    assert.equal(ready.currentAnalysisId, first.analysis.id);
    const second = await runGovernedAnalysis(db, { priceCheckId: request.priceCheckId, actor, decisions: decisions.map((decision, index) => index === 0 ? { ...decision, included: false, reasonCode: "TOO_OLD" } : decision), confidence: "MEDIUM", confidenceReason: "Re-run with one reviewed exclusion.", today: "2026-08-16" });
    assert.equal(second.analysis.version, 2);
    const analyses = await db.select().from(schema.priceCheckAnalyses).where(eq(schema.priceCheckAnalyses.priceCheckId, request.priceCheckId)).orderBy(asc(schema.priceCheckAnalyses.version));
    assert.equal(analyses[0].reviewState, "SUPERSEDED");
    assert.equal(analyses[1].reviewState, "HUMAN_REVIEW");
    const snapshots = await db.select().from(schema.priceCheckComparables).where(eq(schema.priceCheckComparables.analysisId, first.analysis.id));
    assert.equal(snapshots.length, 6);
    assert.equal(snapshots[0].comparableSnapshot.provenanceType, "ANALYST_OBSERVATION");
    const actions = await db.select({ action: schema.auditEvents.action }).from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, request.priceCheckId));
    for (const action of ["ANALYSIS_STARTED", "COMPARABLE_INCLUDED", "ANALYSIS_CREATED", "ANALYSIS_SUPERSEDED", "CONFIDENCE_SELECTED", "ANALYSIS_MARKED_READY"]) assert.ok(actions.some((item) => item.action === action));
  });
});

test("server rejects unverified, prohibited, unrelated, and cross-request evidence while accepting governed relationships", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const { changePriceCheckStatus } = await import("../db/price-check/repositories/admin-repository.ts");
    const { createGovernedPartRelationship, listCandidateObservations, runGovernedAnalysis } = await import("../db/price-check/repositories/comparable-repository.ts");
    const actor = await seedAdmin(db);
    const request = await seedRequest(db, "REL-200");
    const otherRequest = await seedRequest(db, "OTHER-900");
    await changePriceCheckStatus(db, { priceCheckId: request.priceCheckId, to: "ready_for_analysis", actor });
    await changePriceCheckStatus(db, { priceCheckId: otherRequest.priceCheckId, to: "ready_for_analysis", actor });
    const exact = await createObservation(db, actor, "TEST-REL-200", "2000.00");
    await createObservation(db, actor, "TEST-REL-200", "2100.00", { verificationState: "UNVERIFIED" });
    await createObservation(db, actor, "TEST-REL-200", "2200.00", { permittedUseState: "PROHIBITED" });
    const unrelated = await createObservation(db, actor, "UNRELATED-777", "9999.00");
    await createGovernedPartRelationship(db, { actor, relationship: { fromNormalizedPartNumber: "TESTREL200", toNormalizedPartNumber: "TESTREL100", relationshipType: "SUPERSEDED_BY", sourceProvenance: "Synthetic governed relationship fixture", verificationState: "VERIFIED", effectiveFrom: null, effectiveTo: null, notes: "Synthetic only" } });
    const related = await createObservation(db, actor, "TEST-REL-100", "1900.00");
    const candidates = await listCandidateObservations(db, "TEST-REL-200", { scope: "related" });
    assert.equal(candidates.candidates.length, 4);
    assert.equal(candidates.candidates.find((item) => item.id === related.id).relationshipType, "SUPERSEDED_BY");
    const baseline = candidates.candidates.map((candidate) => ({ observationId: candidate.id, included: candidate.id === exact.id || candidate.id === related.id, reasonCode: candidate.id === exact.id ? "EXACT_MATCH" : candidate.id === related.id ? "GOVERNED_PART_RELATIONSHIP" : candidate.verificationState !== "VERIFIED" ? "UNVERIFIED_PART_RELATIONSHIP" : "PERMITTED_USE_RESTRICTION", analystNote: "Synthetic governance fixture." }));
    const unverifiedAttempt = baseline.map((decision) => candidates.candidates.find((candidate) => candidate.id === decision.observationId)?.verificationState !== "VERIFIED" ? { ...decision, included: true, reasonCode: "EXACT_MATCH" } : decision);
    await assert.rejects(runGovernedAnalysis(db, { priceCheckId: request.priceCheckId, actor, decisions: unverifiedAttempt, confidence: "MEDIUM", confidenceReason: "Rejected fixture." }), /restricted evidence/);
    const prohibitedAttempt = baseline.map((decision) => candidates.candidates.find((candidate) => candidate.id === decision.observationId)?.permittedUseState === "PROHIBITED" ? { ...decision, included: true, reasonCode: "EXACT_MATCH" } : decision);
    await assert.rejects(runGovernedAnalysis(db, { priceCheckId: request.priceCheckId, actor, decisions: prohibitedAttempt, confidence: "MEDIUM", confidenceReason: "Rejected fixture." }), /restricted evidence/);
    await assert.rejects(runGovernedAnalysis(db, { priceCheckId: request.priceCheckId, actor, decisions: [{ observationId: unrelated.id, included: true, reasonCode: "EXACT_MATCH", analystNote: null }], confidence: "MEDIUM", confidenceReason: "Tampered fixture." }), /Every candidate|not a candidate/);
    await assert.rejects(runGovernedAnalysis(db, { priceCheckId: otherRequest.priceCheckId, actor, decisions: baseline, confidence: "MEDIUM", confidenceReason: "Cross-request fixture." }), /Every candidate|not a candidate/);
    const valid = await runGovernedAnalysis(db, { priceCheckId: request.priceCheckId, actor, decisions: baseline, confidence: "LOW", confidenceReason: "Exact and governed superseded synthetic evidence.", today: "2026-08-16" });
    assert.equal(valid.payload.selectedCount, 2);
    assert.ok(valid.payload.warnings.includes("PART_RELATIONSHIP_USED"));
    assert.equal(valid.payload.observedComparableMedian, "1950.0000");
    const [relationshipAudit] = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.action, "PART_RELATIONSHIP_VERIFIED"));
    assert.ok(relationshipAudit);
  });
});

test("analysis_ready is rejected without a persisted analysis even when the base transition exists", async () => {
  await withDatabase(async ({ db }) => {
    const { changePriceCheckStatus } = await import("../db/price-check/repositories/admin-repository.ts");
    const actor = await seedAdmin(db);
    const request = await seedRequest(db, "NO-ANALYSIS");
    await changePriceCheckStatus(db, { priceCheckId: request.priceCheckId, to: "ready_for_analysis", actor });
    await assert.rejects(changePriceCheckStatus(db, { priceCheckId: request.priceCheckId, to: "analysis_ready", actor }), /persisted analysis/);
  });
});
