import "../server-boundary.ts";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import { aiArtifacts, auditEvents, priceCheckAnalyses, priceCheckResults, priceChecks, processingJobs } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import type { AdminActor } from "./admin-repository.ts";
import { buildExplanationContext } from "../../../lib/price-check/explanation/context.ts";
import type { ExplanationDraft } from "../../../lib/price-check/explanation/schema.ts";

const MAX_ATTEMPTS = 5;

type ExplanationConfig = { model: string; schemaVersion: string; promptVersion: string };

async function audit(tx: PriceCheckDb, input: { priceCheckId: string; actorId: string | null; action: string; analysisId: string; artifactId?: string; metadata?: Record<string, unknown> }) {
  await tx.insert(auditEvents).values({
    id: generateOrderedId(), aggregateType: "price_check", aggregateId: input.priceCheckId,
    actorType: input.actorId ? "ADMIN" : "WORKER", actorId: input.actorId,
    action: input.action, correlationId: `${input.action.toLowerCase()}:${crypto.randomUUID()}`,
    afterVersionReference: input.artifactId ? `ai-explanation:${input.artifactId}` : `analysis:${input.analysisId}`,
    sanitizedMetadata: { analysisId: input.analysisId, ...(input.metadata ?? {}) },
  });
}

async function currentAnalysis(tx: PriceCheckDb, priceCheckId: string, analysisId?: string) {
  const [record] = await tx.select({ priceCheck: priceChecks, analysis: priceCheckAnalyses })
    .from(priceChecks).innerJoin(priceCheckAnalyses, eq(priceChecks.currentAnalysisId, priceCheckAnalyses.id))
    .where(eq(priceChecks.id, priceCheckId)).limit(1);
  if (!record || (analysisId && record.analysis.id !== analysisId)) throw new Error("EXPLANATION_ANALYSIS_NOT_CURRENT");
  if (!['analysis_ready', 'human_review', 'approved'].includes(record.priceCheck.status)) throw new Error("EXPLANATION_ANALYSIS_NOT_READY");
  return record;
}

function artifactPayload(value: Record<string, unknown> | null) {
  if (!value || typeof value !== "object") return null;
  const draft = value.draft;
  const binding = value.binding;
  if (!draft || typeof draft !== "object" || !binding || typeof binding !== "object") return null;
  return { draft: draft as ExplanationDraft, binding: binding as Record<string, unknown> };
}

export async function queueExplanationDraft(db: PriceCheckDb, input: {
  priceCheckId: string; analysisId: string; actor: AdminActor; config: ExplanationConfig; regenerate: boolean;
}) {
  if (input.actor.role === "AUDITOR") throw new Error("EXPLANATION_ACCESS_DENIED");
  return db.transaction(async (tx) => {
    const { analysis } = await currentAnalysis(tx as PriceCheckDb, input.priceCheckId, input.analysisId);
    const [active] = await tx.select().from(processingJobs).where(and(
      eq(processingJobs.jobType, "EXPLANATION_DRAFT"), eq(processingJobs.aggregateId, analysis.id), inArray(processingJobs.state, ["pending", "running"]),
    )).orderBy(desc(processingJobs.createdAt)).limit(1);
    if (active) return { job: active, created: false, state: active.state };

    const [ready] = await tx.select().from(aiArtifacts).where(and(
      eq(aiArtifacts.artifactType, "EXPLANATION_DRAFT"), eq(aiArtifacts.relatedAnalysisId, analysis.id), eq(aiArtifacts.validationState, "VALID"),
    )).orderBy(desc(aiArtifacts.createdAt)).limit(1);
    if (ready && !input.regenerate) return { artifact: ready, created: false, state: "ready" as const };

    const [counter] = await tx.select({ count: sql<number>`count(*)::int` }).from(aiArtifacts).where(and(
      eq(aiArtifacts.artifactType, "EXPLANATION_DRAFT"), eq(aiArtifacts.relatedAnalysisId, analysis.id),
    ));
    const attempt = Number(counter?.count ?? 0) + 1;
    if (attempt > MAX_ATTEMPTS) throw new Error("EXPLANATION_ATTEMPTS_EXHAUSTED");
    const idempotencyKey = ["explanation", analysis.id, analysis.deterministicCalculationDigest, input.config.model, input.config.schemaVersion, input.config.promptVersion, attempt].join(":");
    const [created] = await tx.insert(processingJobs).values({
      id: generateOrderedId(), jobType: "EXPLANATION_DRAFT", aggregateType: "price_check_analysis",
      aggregateId: analysis.id, idempotencyKey, state: "pending", attemptCount: 0, nextAttemptAt: new Date(),
    }).onConflictDoNothing({ target: processingJobs.idempotencyKey }).returning();
    const [job] = created ? [created] : await tx.select().from(processingJobs).where(eq(processingJobs.idempotencyKey, idempotencyKey)).limit(1);
    if (!job) throw new Error("EXPLANATION_JOB_UNAVAILABLE");
    if (created) await audit(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, actorId: input.actor.id, action: "AI_EXPLANATION_REQUESTED", analysisId: analysis.id, metadata: { jobId: job.id, analysisVersion: analysis.version, attempt, modelConfig: input.config.model } });
    return { job, created: Boolean(created), state: job.state };
  });
}

export async function leaseExplanationJob(db: PriceCheckDb, input: { jobId: string; leaseOwner: string; now: Date; leaseUntil: Date }) {
  const [leased] = await db.update(processingJobs).set({
    state: "running", leaseOwner: input.leaseOwner, leaseExpiresAt: input.leaseUntil,
    startedAt: input.now, attemptCount: sql`${processingJobs.attemptCount} + 1`,
  }).where(and(eq(processingJobs.id, input.jobId), eq(processingJobs.jobType, "EXPLANATION_DRAFT"), eq(processingJobs.state, "pending"))).returning();
  return leased ?? null;
}

export async function getExplanationJobContext(db: PriceCheckDb, jobId: string, leaseOwner: string) {
  const [record] = await db.select({ job: processingJobs, analysis: priceCheckAnalyses, priceCheck: priceChecks })
    .from(processingJobs).innerJoin(priceCheckAnalyses, eq(processingJobs.aggregateId, priceCheckAnalyses.id))
    .innerJoin(priceChecks, eq(priceCheckAnalyses.priceCheckId, priceChecks.id))
    .where(and(eq(processingJobs.id, jobId), eq(processingJobs.jobType, "EXPLANATION_DRAFT"), eq(processingJobs.state, "running"), eq(processingJobs.leaseOwner, leaseOwner))).limit(1);
  if (!record) throw new Error("EXPLANATION_JOB_UNAVAILABLE");
  return { ...record, stale: record.priceCheck.currentAnalysisId !== record.analysis.id, context: buildExplanationContext(record.analysis) };
}

export async function storeExplanationSuccess(db: PriceCheckDb, input: {
  jobId: string; leaseOwner: string; priceCheckId: string; analysisId: string; analysisVersion: number;
  analysisDigest: string; model: string; schemaVersion: string; promptVersion: string; policyVersion: string;
  requestDigest: string; draft: ExplanationDraft; latencyMs: number; usage: Record<string, unknown>;
}) {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(processingJobs).where(and(eq(processingJobs.id, input.jobId), eq(processingJobs.state, "running"), eq(processingJobs.leaseOwner, input.leaseOwner))).limit(1);
    const { analysis } = await currentAnalysis(tx as PriceCheckDb, input.priceCheckId, input.analysisId);
    if (!job || analysis.deterministicCalculationDigest !== input.analysisDigest || analysis.version !== input.analysisVersion) throw new Error("EXPLANATION_ANALYSIS_STALE");
    const artifactId = generateOrderedId();
    const [artifact] = await tx.insert(aiArtifacts).values({
      id: artifactId, artifactType: "EXPLANATION_DRAFT", relatedPriceCheckId: input.priceCheckId, relatedAnalysisId: input.analysisId,
      provider: "OPENAI", configuredModelId: input.model, promptVersion: input.promptVersion, schemaVersion: input.schemaVersion,
      redactionPolicyVersion: input.policyVersion, requestDigest: input.requestDigest,
      structuredResponse: { binding: { priceCheckId: input.priceCheckId, analysisId: input.analysisId, analysisVersion: input.analysisVersion, deterministicAnalysisDigest: input.analysisDigest }, draft: input.draft },
      validationState: "VALID", tokenMetadata: input.usage, latencyMetadata: { latencyMs: input.latencyMs },
    }).returning();
    await tx.update(priceCheckAnalyses).set({ aiDraftId: artifact.id }).where(eq(priceCheckAnalyses.id, analysis.id));
    await tx.update(processingJobs).set({ state: "succeeded", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, sanitizedErrorCode: null }).where(eq(processingJobs.id, job.id));
    await audit(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, actorId: null, action: "AI_EXPLANATION_READY", analysisId: analysis.id, artifactId: artifact.id, metadata: { jobId: job.id, analysisVersion: analysis.version, modelConfig: input.model } });
    return artifact;
  });
}

export async function recordExplanationFailure(db: PriceCheckDb, input: {
  jobId: string; leaseOwner: string; priceCheckId: string; analysisId: string; model: string; schemaVersion: string;
  promptVersion: string; policyVersion: string; requestDigest: string; errorCode: string; rejected: boolean;
}) {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(processingJobs).where(and(eq(processingJobs.id, input.jobId), eq(processingJobs.state, "running"), eq(processingJobs.leaseOwner, input.leaseOwner))).limit(1);
    if (!job) return null;
    const artifactId = generateOrderedId();
    const [artifact] = await tx.insert(aiArtifacts).values({
      id: artifactId, artifactType: "EXPLANATION_DRAFT", relatedPriceCheckId: input.priceCheckId, relatedAnalysisId: input.analysisId,
      provider: "OPENAI", configuredModelId: input.model, promptVersion: input.promptVersion, schemaVersion: input.schemaVersion,
      redactionPolicyVersion: input.policyVersion, requestDigest: input.requestDigest,
      structuredResponse: { rejectionCodes: [input.errorCode] }, validationState: input.rejected ? "INVALID" : "FAILED", sanitizedErrorCategory: input.errorCode,
    }).returning();
    await tx.update(processingJobs).set({ state: "failed", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, sanitizedErrorCode: input.errorCode }).where(eq(processingJobs.id, job.id));
    await audit(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, actorId: null, action: input.rejected ? "AI_EXPLANATION_REJECTED" : "AI_EXPLANATION_FAILED", analysisId: input.analysisId, artifactId: artifact.id, metadata: { jobId: job.id, code: input.errorCode } });
    return artifact;
  });
}

async function usableArtifact(tx: PriceCheckDb, input: { priceCheckId: string; analysisId: string; artifactId: string }) {
  const { analysis } = await currentAnalysis(tx, input.priceCheckId, input.analysisId);
  const [artifact] = await tx.select().from(aiArtifacts).where(and(eq(aiArtifacts.id, input.artifactId), eq(aiArtifacts.artifactType, "EXPLANATION_DRAFT"), eq(aiArtifacts.relatedPriceCheckId, input.priceCheckId), eq(aiArtifacts.relatedAnalysisId, input.analysisId), eq(aiArtifacts.validationState, "VALID"))).limit(1);
  const payload = artifactPayload(artifact?.structuredResponse ?? null);
  if (!artifact || !payload || payload.binding.deterministicAnalysisDigest !== analysis.deterministicCalculationDigest) throw new Error("EXPLANATION_DRAFT_STALE_OR_UNAVAILABLE");
  return { analysis, artifact, payload };
}

export async function applyExplanationDraft(db: PriceCheckDb, input: { priceCheckId: string; analysisId: string; artifactId: string; actor: AdminActor }) {
  return db.transaction(async (tx) => {
    const { analysis, artifact, payload } = await usableArtifact(tx as PriceCheckDb, input);
    await tx.update(priceCheckAnalyses).set({ aiDraftId: artifact.id }).where(eq(priceCheckAnalyses.id, analysis.id));
    await audit(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, actorId: input.actor.id, action: "AI_EXPLANATION_APPLIED", analysisId: analysis.id, artifactId: artifact.id });
    return { artifactId: artifact.id, draft: payload.draft };
  });
}

export async function discardExplanationDraft(db: PriceCheckDb, input: { priceCheckId: string; analysisId: string; artifactId: string; actor: AdminActor }) {
  return db.transaction(async (tx) => {
    const { analysis, artifact } = await usableArtifact(tx as PriceCheckDb, input);
    await tx.update(aiArtifacts).set({ validationState: "INVALID", sanitizedErrorCategory: "DISCARDED_BY_STAFF" }).where(eq(aiArtifacts.id, artifact.id));
    if (analysis.aiDraftId === artifact.id) await tx.update(priceCheckAnalyses).set({ aiDraftId: null }).where(eq(priceCheckAnalyses.id, analysis.id));
    await audit(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, actorId: input.actor.id, action: "AI_EXPLANATION_DISCARDED", analysisId: analysis.id, artifactId: artifact.id });
  });
}

export async function validateResultAiProvenance(db: PriceCheckDb, input: { priceCheckId: string; analysisId: string; artifactId: string }) {
  const { artifact } = await usableArtifact(db, input);
  return artifact;
}

export async function getAdminExplanationWorkspace(db: PriceCheckDb, priceCheckId: string) {
  const [priceCheck] = await db.select().from(priceChecks).where(eq(priceChecks.id, priceCheckId)).limit(1);
  if (!priceCheck?.currentAnalysisId) return { status: "NOT_REQUESTED" as const, current: null, history: [] };
  const analyses = await db.select({ id: priceCheckAnalyses.id, version: priceCheckAnalyses.version, digest: priceCheckAnalyses.deterministicCalculationDigest }).from(priceCheckAnalyses).where(eq(priceCheckAnalyses.priceCheckId, priceCheckId)).orderBy(desc(priceCheckAnalyses.version));
  const analysisIds = analyses.map((item) => item.id);
  const [artifacts, jobs] = await Promise.all([
    analysisIds.length ? db.select().from(aiArtifacts).where(and(eq(aiArtifacts.artifactType, "EXPLANATION_DRAFT"), inArray(aiArtifacts.relatedAnalysisId, analysisIds))).orderBy(desc(aiArtifacts.createdAt)) : [],
    db.select().from(processingJobs).where(and(eq(processingJobs.jobType, "EXPLANATION_DRAFT"), eq(processingJobs.aggregateId, priceCheck.currentAnalysisId))).orderBy(desc(processingJobs.createdAt)),
  ]);
  const currentAnalysis = analyses.find((item) => item.id === priceCheck.currentAnalysisId)!;
  const history = artifacts.map((artifact) => {
    const payload = artifactPayload(artifact.structuredResponse);
    const stale = artifact.relatedAnalysisId !== currentAnalysis.id
      || (payload !== null && payload.binding.deterministicAnalysisDigest !== currentAnalysis.digest);
    const discarded = artifact.sanitizedErrorCategory === "DISCARDED_BY_STAFF";
    return {
      id: artifact.id, model: artifact.configuredModelId, createdAt: artifact.createdAt,
      state: stale ? "STALE" : discarded ? "DISCARDED" : artifact.validationState === "VALID" ? "READY" : artifact.validationState === "FAILED" ? "FAILED" : "REJECTED",
      draft: !stale && !discarded && artifact.validationState === "VALID" ? payload?.draft ?? null : null,
      analysisVersion: analyses.find((item) => item.id === artifact.relatedAnalysisId)?.version ?? null,
      errorCode: artifact.sanitizedErrorCategory,
    };
  });
  const active = jobs.find((job) => ["pending", "running"].includes(job.state));
  const current = history.find((item) => item.state === "READY") ?? null;
  const latestCurrent = history.find((item) => item.analysisVersion === currentAnalysis.version);
  const status = active?.state === "pending" ? "QUEUED" : active?.state === "running" ? "GENERATING" : current ? "READY" : latestCurrent?.state === "FAILED" || latestCurrent?.state === "REJECTED" ? "FAILED" : history.some((item) => item.state === "STALE") ? "STALE" : "NOT_REQUESTED";
  return { status, current, history };
}

export async function resultAiArtifact(db: PriceCheckDb, resultId: string) {
  const [result] = await db.select({ sourceAiArtifactId: priceCheckResults.sourceAiArtifactId, model: aiArtifacts.configuredModelId })
    .from(priceCheckResults).leftJoin(aiArtifacts, eq(priceCheckResults.sourceAiArtifactId, aiArtifacts.id)).where(eq(priceCheckResults.id, resultId)).limit(1);
  return result ?? null;
}
