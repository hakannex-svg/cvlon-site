import "../server-boundary.ts";

import { and, desc, eq, isNull, max } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import {
  auditEvents,
  notificationOutbox,
  priceCheckAnalyses,
  priceCheckComparables,
  priceCheckResults,
  priceChecks,
  requesters,
  resultAccessTokens,
  sourcingOpportunities,
} from "../schema.ts";
import {
  RESULT_DISCLAIMER_VERSION,
  RESULT_TOKEN_TTL_MS,
  customerClassification,
  deriveResultToken,
  factorLabels,
  hashResultToken,
  newTokenNonce,
  stableDigest,
} from "../domain/customer-result.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import type { AdminActor } from "./admin-repository.ts";

function correlationId(action: string) {
  return `${action}:${crypto.randomUUID()}`;
}

async function audit(tx: PriceCheckDb, input: { aggregateId: string; actorType?: "ADMIN" | "SYSTEM" | "WORKER"; actorId?: string | null; action: string; before?: string | null; after?: string | null; metadata?: Record<string, unknown> }) {
  await tx.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: "price_check",
    aggregateId: input.aggregateId,
    actorType: input.actorType ?? "ADMIN",
    actorId: input.actorId ?? null,
    action: input.action,
    beforeVersionReference: input.before ?? null,
    afterVersionReference: input.after ?? null,
    correlationId: correlationId(input.action),
    sanitizedMetadata: input.metadata ?? {},
  });
}

function resultContent(input: {
  analysisDigest: string;
  classification: string;
  displayRange: boolean;
  displayEvidenceCount: boolean;
  factors: string[];
  explanation: string;
  limitation: string | null;
}) {
  return {
    contractVersion: "civilon-result-v1",
    analysisDigest: input.analysisDigest,
    classification: input.classification,
    displayRange: input.displayRange,
    displayEvidenceCount: input.displayEvidenceCount,
    factors: [...input.factors].sort(),
    explanation: input.explanation,
    limitation: input.limitation,
    disclaimerVersion: RESULT_DISCLAIMER_VERSION,
  };
}

async function assertAnalysisEvidence(tx: PriceCheckDb, analysisId: string) {
  const included = await tx.select({ snapshot: priceCheckComparables.comparableSnapshot })
    .from(priceCheckComparables)
    .where(and(eq(priceCheckComparables.analysisId, analysisId), eq(priceCheckComparables.included, true)));
  if (included.some(({ snapshot }) => snapshot.verificationState !== "VERIFIED" || snapshot.permittedUseState !== "INTERNAL_ANALYSIS")) {
    throw new Error("Analysis references evidence that is not approved for customer-result preparation.");
  }
}

export async function createCustomerResultDraft(db: PriceCheckDb, input: {
  priceCheckId: string;
  analysisId: string;
  actor: AdminActor;
  explanation: string;
  factorCodes: string[];
  displayRange: boolean;
  displayEvidenceCount: boolean;
  limitedEvidenceStatement: string | null;
  sourceAiArtifactId?: string | null;
}) {
  return db.transaction(async (tx) => {
    const [[priceCheck], [analysis]] = await Promise.all([
      tx.select().from(priceChecks).where(eq(priceChecks.id, input.priceCheckId)).limit(1),
      tx.select().from(priceCheckAnalyses).where(and(eq(priceCheckAnalyses.id, input.analysisId), eq(priceCheckAnalyses.priceCheckId, input.priceCheckId))).limit(1),
    ]);
    if (!priceCheck || !analysis || priceCheck.currentAnalysisId !== analysis.id) throw new Error("The selected analysis is not the current analysis for this Price Check.");
    if (!["analysis_ready", "human_review", "approved"].includes(priceCheck.status)) throw new Error("Price Check must be analysis ready before a result can be drafted.");
    await assertAnalysisEvidence(tx, analysis.id);
    if (input.sourceAiArtifactId) {
      const { validateResultAiProvenance } = await import("./explanation-repository.ts");
      await validateResultAiProvenance(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, analysisId: analysis.id, artifactId: input.sourceAiArtifactId });
    }
    const availableFactors = new Set([...(analysis.factorCodes ?? []), ...(analysis.insufficiencyReasons ?? [])].filter((code) => code in factorLabels));
    if (input.factorCodes.some((code) => !availableFactors.has(code))) throw new Error("A visible factor is not present in the persisted analysis.");
    const insufficient = analysis.confidence === "INSUFFICIENT_DATA" || analysis.evidenceCount < 2;
    if (input.displayRange && insufficient) throw new Error("A market range cannot be displayed for insufficient or single-observation evidence.");
    if (input.displayRange && analysis.evidenceCount === 2 && !input.limitedEvidenceStatement) throw new Error("A visible limitation statement is required for limited evidence.");
    if (input.displayRange && (!analysis.marketLow || !analysis.marketMedian || !analysis.marketHigh || !analysis.currencyCode)) throw new Error("Persisted deterministic range facts are unavailable.");
    const classification = customerClassification(analysis.classification);
    const content = resultContent({
      analysisDigest: analysis.deterministicCalculationDigest,
      classification,
      displayRange: input.displayRange,
      displayEvidenceCount: input.displayEvidenceCount,
      factors: input.factorCodes,
      explanation: input.explanation,
      limitation: input.limitedEvidenceStatement,
    });
    const [latest] = await tx.select({ version: max(priceCheckResults.version) }).from(priceCheckResults).where(eq(priceCheckResults.priceCheckId, input.priceCheckId));
    const version = (latest?.version ?? 0) + 1;
    const now = new Date();
    const prior = await tx.select().from(priceCheckResults).where(and(eq(priceCheckResults.priceCheckId, input.priceCheckId), isNull(priceCheckResults.supersededAt)));
    if (prior.length) {
      await tx.update(priceCheckResults).set({ state: "SUPERSEDED", supersededAt: now }).where(and(eq(priceCheckResults.priceCheckId, input.priceCheckId), isNull(priceCheckResults.supersededAt)));
      for (const result of prior) await tx.update(resultAccessTokens).set({ revokedAt: now }).where(and(eq(resultAccessTokens.resultId, result.id), isNull(resultAccessTokens.revokedAt)));
      if (prior.some((result) => result.state === "APPROVED" || result.state === "SENT")) await audit(tx, { aggregateId: input.priceCheckId, actorId: input.actor.id, action: "RESULT_APPROVAL_INVALIDATED", before: `result:${prior[0].version}`, after: `result:${version}`, metadata: { reason: "material_result_change" } });
    }
    const [result] = await tx.insert(priceCheckResults).values({
      id: generateOrderedId(),
      priceCheckId: input.priceCheckId,
      analysisId: analysis.id,
      state: "DRAFT",
      version,
      approvedClassification: classification,
      displayRange: input.displayRange,
      displayEvidenceCount: input.displayEvidenceCount,
      approvedFactorList: input.factorCodes,
      approvedExplanation: input.explanation,
      sourceAiArtifactId: input.sourceAiArtifactId ?? null,
      limitedEvidenceStatement: input.limitedEvidenceStatement,
      disclaimerVersion: RESULT_DISCLAIMER_VERSION,
      draftedBy: input.actor.id,
      approvedBy: null,
      approvedAt: null,
      renderedContentDigest: stableDigest(content),
    }).returning();
    await tx.update(priceChecks).set({ currentResultId: result.id, status: "human_review", updatedAt: now }).where(eq(priceChecks.id, input.priceCheckId));
    await audit(tx, { aggregateId: input.priceCheckId, actorId: input.actor.id, action: prior.length ? "RESULT_DRAFT_UPDATED" : "RESULT_DRAFT_CREATED", after: `result:${version}`, metadata: { analysisVersion: analysis.version, displayRange: input.displayRange } });
    return result;
  });
}

export async function approveCustomerResult(db: PriceCheckDb, input: { priceCheckId: string; resultId: string; actor: AdminActor }) {
  if (!(["REVIEWER", "ADMIN"] as string[]).includes(input.actor.role)) throw new Error("Reviewer authority is required.");
  return db.transaction(async (tx) => {
    const [[priceCheck], [result]] = await Promise.all([
      tx.select().from(priceChecks).where(eq(priceChecks.id, input.priceCheckId)).limit(1),
      tx.select().from(priceCheckResults).where(and(eq(priceCheckResults.id, input.resultId), eq(priceCheckResults.priceCheckId, input.priceCheckId))).limit(1),
    ]);
    if (!priceCheck || !result || priceCheck.currentResultId !== result.id || result.state !== "DRAFT" || result.supersededAt) throw new Error("Current result draft was not found.");
    if (priceCheck.currentAnalysisId !== result.analysisId || priceCheck.status !== "human_review") throw new Error("Result approval requires the current persisted analysis and human-review state.");
    const [analysis] = await tx.select().from(priceCheckAnalyses).where(eq(priceCheckAnalyses.id, result.analysisId)).limit(1);
    if (!analysis) throw new Error("Persisted analysis is unavailable.");
    await assertAnalysisEvidence(tx, analysis.id);
    if (customerClassification(analysis.classification) !== result.approvedClassification) throw new Error("Result classification no longer matches its persisted analysis.");
    if (result.displayRange && (!analysis.marketLow || !analysis.marketMedian || !analysis.marketHigh || !analysis.currencyCode || analysis.evidenceCount < 2 || analysis.confidence === "INSUFFICIENT_DATA")) throw new Error("Result range policy no longer passes validation.");
    if (result.approvedFactorList.some((code) => ![...(analysis.factorCodes ?? []), ...(analysis.insufficiencyReasons ?? [])].includes(code))) throw new Error("Result factors no longer match persisted analysis.");
    const digest = stableDigest(resultContent({ analysisDigest: analysis.deterministicCalculationDigest, classification: result.approvedClassification, displayRange: result.displayRange, displayEvidenceCount: result.displayEvidenceCount, factors: result.approvedFactorList, explanation: result.approvedExplanation, limitation: result.limitedEvidenceStatement }));
    if (digest !== result.renderedContentDigest || result.disclaimerVersion !== RESULT_DISCLAIMER_VERSION) throw new Error("Result content validation failed.");
    const now = new Date();
    const [approved] = await tx.update(priceCheckResults).set({ state: "APPROVED", approvedBy: input.actor.id, approvedAt: now }).where(and(eq(priceCheckResults.id, result.id), eq(priceCheckResults.state, "DRAFT"))).returning();
    if (!approved) throw new Error("Concurrent result approval was rejected.");
    await tx.update(priceChecks).set({ status: "approved", updatedAt: now }).where(and(eq(priceChecks.id, priceCheck.id), eq(priceChecks.status, "human_review")));
    await audit(tx, { aggregateId: input.priceCheckId, actorId: input.actor.id, action: "RESULT_APPROVED", before: `result:${result.version}:DRAFT`, after: `result:${result.version}:APPROVED`, metadata: { analysisId: result.analysisId } });
    return approved;
  });
}

export async function queueCustomerResultDelivery(db: PriceCheckDb, input: { priceCheckId: string; resultId: string; actor: AdminActor; tokenKey: string; now?: Date }) {
  if (!(["REVIEWER", "ADMIN"] as string[]).includes(input.actor.role)) throw new Error("Reviewer authority is required.");
  return db.transaction(async (tx) => {
    const [[priceCheck], [result], [requester]] = await Promise.all([
      tx.select().from(priceChecks).where(eq(priceChecks.id, input.priceCheckId)).limit(1),
      tx.select().from(priceCheckResults).where(and(eq(priceCheckResults.id, input.resultId), eq(priceCheckResults.priceCheckId, input.priceCheckId))).limit(1),
      tx.select().from(requesters).innerJoin(priceChecks, eq(priceChecks.requesterId, requesters.id)).where(eq(priceChecks.id, input.priceCheckId)).limit(1),
    ]);
    if (!priceCheck || !result || !requester || priceCheck.currentResultId !== result.id || result.state !== "APPROVED" || result.supersededAt) throw new Error("An approved current result is required before delivery.");
    const now = input.now ?? new Date();
    let [token] = await tx.select().from(resultAccessTokens).where(and(eq(resultAccessTokens.resultId, result.id), isNull(resultAccessTokens.revokedAt))).orderBy(desc(resultAccessTokens.issuedAt)).limit(1);
    if (!token || token.expiresAt <= now) {
      if (token) await tx.update(resultAccessTokens).set({ revokedAt: now }).where(eq(resultAccessTokens.id, token.id));
      const nonce = newTokenNonce();
      const credential = deriveResultToken(input.tokenKey, nonce);
      [token] = await tx.insert(resultAccessTokens).values({ id: generateOrderedId(), resultId: result.id, keyedTokenHash: hashResultToken(input.tokenKey, credential), tokenDerivationNonce: nonce, issuedAt: now, expiresAt: new Date(now.valueOf() + RESULT_TOKEN_TTL_MS) }).returning();
      await audit(tx, { aggregateId: input.priceCheckId, actorId: input.actor.id, action: "RESULT_TOKEN_ISSUED", after: `result:${result.version}`, metadata: { expiresAt: token.expiresAt.toISOString() } });
    }
    const idempotencyKey = `result-ready:${result.id}:v1`;
    const [message] = await tx.insert(notificationOutbox).values({ id: generateOrderedId(), messageType: "RESULT_READY", aggregateType: "price_check_result", aggregateId: result.id, recipientReference: requester.requesters.id, templateVersion: "result-ready-v1", idempotencyKey, nextAttemptAt: now }).onConflictDoNothing({ target: notificationOutbox.idempotencyKey }).returning();
    await audit(tx, { aggregateId: input.priceCheckId, actorId: input.actor.id, action: "RESULT_DELIVERY_QUEUED", after: `result:${result.version}`, metadata: { notificationId: message?.id ?? null, idempotent: !message } });
    return { queued: Boolean(message), tokenExpiresAt: token.expiresAt };
  });
}

export async function loadResultDelivery(db: PriceCheckDb, resultId: string, tokenKey: string, baseUrl: string) {
  const [record] = await db.select({ result: priceCheckResults, priceCheck: priceChecks, requester: requesters }).from(priceCheckResults).innerJoin(priceChecks, eq(priceCheckResults.priceCheckId, priceChecks.id)).innerJoin(requesters, eq(priceChecks.requesterId, requesters.id)).where(eq(priceCheckResults.id, resultId)).limit(1);
  if (!record || record.result.state !== "APPROVED" || record.result.supersededAt || record.priceCheck.currentResultId !== record.result.id) throw new Error("RESULT_NOT_DELIVERABLE");
  const [token] = await db.select().from(resultAccessTokens).where(and(eq(resultAccessTokens.resultId, resultId), isNull(resultAccessTokens.revokedAt))).orderBy(desc(resultAccessTokens.issuedAt)).limit(1);
  if (!token || token.expiresAt <= new Date()) throw new Error("RESULT_TOKEN_UNAVAILABLE");
  if (!token.tokenDerivationNonce) throw new Error("RESULT_TOKEN_UNAVAILABLE");
  const credential = deriveResultToken(tokenKey, token.tokenDerivationNonce);
  return { ...record, token, secureUrl: `${baseUrl.replace(/\/$/, "")}/price-check/result/redeem?token=${encodeURIComponent(credential)}` };
}

export async function markResultDeliverySucceeded(db: PriceCheckDb, input: { resultId: string; notificationId: string; leaseOwner: string; providerMessageId: string; now?: Date }) {
  return db.transaction(async (tx) => {
    const [result] = await tx.select().from(priceCheckResults).where(eq(priceCheckResults.id, input.resultId)).limit(1);
    if (!result) throw new Error("Result was not found.");
    const now = input.now ?? new Date();
    const [completed] = await tx.update(notificationOutbox).set({
      state: "succeeded",
      sentAt: now,
      providerMessageId: input.providerMessageId,
      leaseOwner: null,
      leaseExpiresAt: null,
      sanitizedFailureCode: null,
    }).where(and(
      eq(notificationOutbox.id, input.notificationId),
      eq(notificationOutbox.aggregateId, result.id),
      eq(notificationOutbox.state, "running"),
      eq(notificationOutbox.leaseOwner, input.leaseOwner),
    )).returning();
    if (!completed) throw new Error("RESULT_DELIVERY_LEASE_LOST");
    await tx.update(priceCheckResults).set({ state: "SENT", sentAt: now }).where(eq(priceCheckResults.id, result.id));
    await tx.update(priceChecks).set({ status: "sent", updatedAt: now }).where(and(eq(priceChecks.id, result.priceCheckId), eq(priceChecks.currentResultId, result.id)));
    await audit(tx, { aggregateId: result.priceCheckId, actorType: "WORKER", action: "RESULT_DELIVERY_SUCCEEDED", after: `result:${result.version}:SENT`, metadata: { provider: "postmark", providerMessageId: input.providerMessageId } });
  });
}

export async function recordResultDeliveryFailure(db: PriceCheckDb, resultId: string, code: string, deadLetter: boolean) {
  const [result] = await db.select().from(priceCheckResults).where(eq(priceCheckResults.id, resultId)).limit(1);
  if (result) await audit(db, { aggregateId: result.priceCheckId, actorType: "WORKER", action: "RESULT_DELIVERY_FAILED", after: `result:${result.version}:APPROVED`, metadata: { code, deadLetter } });
}

export async function redeemResultToken(db: PriceCheckDb, input: { token: string; tokenKey: string; now?: Date }) {
  const now = input.now ?? new Date();
  const tokenHash = hashResultToken(input.tokenKey, input.token);
  return db.transaction(async (tx) => {
    const [record] = await tx.select({ token: resultAccessTokens, result: priceCheckResults, priceCheck: priceChecks }).from(resultAccessTokens).innerJoin(priceCheckResults, eq(resultAccessTokens.resultId, priceCheckResults.id)).innerJoin(priceChecks, eq(priceCheckResults.priceCheckId, priceChecks.id)).where(eq(resultAccessTokens.keyedTokenHash, tokenHash)).limit(1);
    if (!record || record.token.revokedAt || record.token.expiresAt <= now || record.result.supersededAt || !["APPROVED", "SENT"].includes(record.result.state) || record.priceCheck.currentResultId !== record.result.id || (record.token.maxUseCount && record.token.viewCount >= record.token.maxUseCount)) return null;
    const [viewed] = await tx.update(resultAccessTokens).set({ firstViewedAt: record.token.firstViewedAt ?? now, lastViewedAt: now, viewCount: record.token.viewCount + 1 }).where(and(eq(resultAccessTokens.id, record.token.id), eq(resultAccessTokens.viewCount, record.token.viewCount))).returning();
    if (!viewed) return null;
    await audit(tx, { aggregateId: record.priceCheck.id, actorType: "SYSTEM", action: "RESULT_VIEWED", after: `result:${record.result.version}`, metadata: { firstView: record.token.viewCount === 0, viewCount: viewed.viewCount } });
    return { resultId: record.result.id, tokenId: record.token.id, expiresAt: Math.min(record.token.expiresAt.valueOf(), now.valueOf() + 30 * 60 * 1000) };
  });
}

export async function getCustomerResult(db: PriceCheckDb, input: { resultId: string; tokenId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const [record] = await db.select({ result: priceCheckResults, analysis: priceCheckAnalyses, priceCheck: priceChecks, token: resultAccessTokens }).from(priceCheckResults).innerJoin(priceCheckAnalyses, eq(priceCheckResults.analysisId, priceCheckAnalyses.id)).innerJoin(priceChecks, eq(priceCheckResults.priceCheckId, priceChecks.id)).innerJoin(resultAccessTokens, eq(resultAccessTokens.resultId, priceCheckResults.id)).where(and(eq(priceCheckResults.id, input.resultId), eq(resultAccessTokens.id, input.tokenId))).limit(1);
  if (!record || record.token.revokedAt || record.token.expiresAt <= now || record.result.supersededAt || !["APPROVED", "SENT"].includes(record.result.state) || record.priceCheck.currentResultId !== record.result.id) return null;
  const [opportunity] = await db.select({ id: sourcingOpportunities.id }).from(sourcingOpportunities).where(eq(sourcingOpportunities.sourceResultId, record.result.id)).limit(1);
  return { ...record, sourcingRequested: Boolean(opportunity) };
}

export async function createResultSourcingOpportunity(db: PriceCheckDb, input: { resultId: string; tokenId: string; now?: Date }) {
  return db.transaction(async (tx) => {
    const customer = await getCustomerResult(tx, input);
    if (!customer) throw new Error("Result access is unavailable.");
    const [created] = await tx.insert(sourcingOpportunities).values({ id: generateOrderedId(), priceCheckId: customer.priceCheck.id, requesterId: customer.priceCheck.requesterId, sourceResultId: customer.result.id, status: "requested" }).onConflictDoNothing({ target: sourcingOpportunities.sourceResultId }).returning();
    if (created) {
      await tx.update(priceChecks).set({ status: "quote_requested", updatedAt: input.now ?? new Date() }).where(eq(priceChecks.id, customer.priceCheck.id));
      await audit(tx, { aggregateId: customer.priceCheck.id, actorType: "SYSTEM", action: "SOURCING_OPPORTUNITY_CREATED", after: `result:${customer.result.version}`, metadata: { opportunityId: created.id } });
    }
    return { created: Boolean(created) };
  });
}

export async function getAdminResultWorkspace(db: PriceCheckDb, priceCheckId: string) {
  const [priceCheck] = await db.select().from(priceChecks).where(eq(priceChecks.id, priceCheckId)).limit(1);
  if (!priceCheck?.currentAnalysisId) return { analysis: null, currentResult: null, history: [], delivery: [] };
  const [[analysis], history, delivery] = await Promise.all([
    db.select().from(priceCheckAnalyses).where(eq(priceCheckAnalyses.id, priceCheck.currentAnalysisId)).limit(1),
    db.select().from(priceCheckResults).where(eq(priceCheckResults.priceCheckId, priceCheckId)).orderBy(desc(priceCheckResults.version)),
    db.select().from(notificationOutbox).where(eq(notificationOutbox.aggregateType, "price_check_result")).orderBy(desc(notificationOutbox.createdAt)),
  ]);
  return { analysis: analysis ?? null, currentResult: history.find((item) => item.id === priceCheck.currentResultId) ?? null, history, delivery: delivery.filter((item) => history.some((result) => result.id === item.aggregateId)) };
}
