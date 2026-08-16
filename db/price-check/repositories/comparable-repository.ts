import "../server-boundary.ts";

import { and, asc, desc, eq, inArray, or } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import {
  adminUsers,
  auditEvents,
  observationDocumentation,
  partRelationships,
  priceCheckAnalyses,
  priceCheckComparables,
  priceCheckDocumentRequirements,
  priceCheckRevisions,
  priceChecks,
  priceObservations,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import { normalizePartNumber } from "../domain/normalization.ts";
import {
  ANALYSIS_ENGINE_VERSION,
  ANALYSIS_POLICY_VERSION,
  deterministicComparableAnalysis,
  type AnalysisObservation,
  type AnalysisTransaction,
  type AnalystConfidence,
} from "../domain/comparable-analysis.ts";
import type { AdminActor } from "./admin-repository.ts";

function correlationId(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

async function appendAudit(tx: PriceCheckDb, input: {
  aggregateType: string;
  aggregateId: string;
  actorId: string;
  action: string;
  beforeVersionReference?: string | null;
  afterVersionReference?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await tx.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    actorType: "ADMIN",
    actorId: input.actorId,
    action: input.action,
    beforeVersionReference: input.beforeVersionReference ?? null,
    afterVersionReference: input.afterVersionReference ?? null,
    correlationId: correlationId(input.action),
    sanitizedMetadata: input.metadata ?? {},
  });
}

export type CandidateFilters = {
  scope?: "exact" | "related";
  condition?: string;
  transactionType?: string;
  currencyCode?: string;
  documentationCode?: string;
  aog?: "yes" | "no";
  sourceReliability?: string;
  verificationState?: string;
  permittedUseState?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function listCandidateObservations(
  db: PriceCheckDb,
  partNumber: string,
  filters: CandidateFilters = {},
) {
  const normalizedPartNumber = normalizePartNumber(partNumber);
  const relationships = await db.select({
    id: partRelationships.id,
    fromNormalizedPartNumber: partRelationships.fromNormalizedPartNumber,
    toNormalizedPartNumber: partRelationships.toNormalizedPartNumber,
    relationshipType: partRelationships.relationshipType,
    sourceProvenance: partRelationships.sourceProvenance,
    verificationState: partRelationships.verificationState,
    reviewedBy: partRelationships.reviewedBy,
    reviewerEmail: adminUsers.displayEmail,
    notes: partRelationships.notes,
    effectiveFrom: partRelationships.effectiveFrom,
    effectiveTo: partRelationships.effectiveTo,
  }).from(partRelationships)
    .leftJoin(adminUsers, eq(partRelationships.reviewedBy, adminUsers.id))
    .where(or(
      eq(partRelationships.fromNormalizedPartNumber, normalizedPartNumber),
      eq(partRelationships.toNormalizedPartNumber, normalizedPartNumber),
    ))
    .orderBy(asc(partRelationships.relationshipType));

  const verifiedRelationships = relationships.filter((item) => item.verificationState === "VERIFIED");
  const relatedPartNumbers = verifiedRelationships.map((item) => item.fromNormalizedPartNumber === normalizedPartNumber ? item.toNormalizedPartNumber : item.fromNormalizedPartNumber);
  const candidateParts = filters.scope === "exact"
    ? [normalizedPartNumber]
    : [...new Set([normalizedPartNumber, ...relatedPartNumbers])];

  const rows = await db.select().from(priceObservations)
    .where(inArray(priceObservations.normalizedPartNumber, candidateParts))
    .orderBy(desc(priceObservations.observationDate), asc(priceObservations.id))
    .limit(500);
  const ids = rows.map((item) => item.id);
  const documentation = ids.length
    ? await db.select().from(observationDocumentation)
      .where(inArray(observationDocumentation.observationId, ids))
      .orderBy(asc(observationDocumentation.documentationCode))
    : [];

  const candidates = rows.map((item) => {
    const exact = item.normalizedPartNumber === normalizedPartNumber;
    const relationship = exact ? null : verifiedRelationships.find((candidate) =>
      candidate.fromNormalizedPartNumber === item.normalizedPartNumber || candidate.toNormalizedPartNumber === item.normalizedPartNumber,
    ) ?? null;
    const documentationCodes = documentation.filter((document) => document.observationId === item.id).map((document) => document.documentationCode);
    return {
      ...item,
      documentationCodes,
      relationshipType: exact ? "EXACT" : relationship?.relationshipType ?? "UNVERIFIED",
      relationship,
      eligible: item.verificationState === "VERIFIED" && item.permittedUseState === "INTERNAL_ANALYSIS" && (exact || relationship?.verificationState === "VERIFIED"),
    };
  }).filter((item) => {
    if (filters.condition && item.conditionCode !== filters.condition) return false;
    if (filters.transactionType && item.transactionType !== filters.transactionType) return false;
    if (filters.currencyCode && item.currencyCode !== filters.currencyCode) return false;
    if (filters.documentationCode && !item.documentationCodes.includes(filters.documentationCode as typeof item.documentationCodes[number])) return false;
    if (filters.aog && item.aog !== (filters.aog === "yes")) return false;
    if (filters.sourceReliability && item.sourceReliability !== filters.sourceReliability) return false;
    if (filters.verificationState && item.verificationState !== filters.verificationState) return false;
    if (filters.permittedUseState && item.permittedUseState !== filters.permittedUseState) return false;
    if (filters.dateFrom && item.observationDate < filters.dateFrom) return false;
    if (filters.dateTo && item.observationDate > filters.dateTo) return false;
    return true;
  });

  return { normalizedPartNumber, relationships, candidates };
}

export async function createGovernedObservation(db: PriceCheckDb, input: {
  observation: Omit<typeof priceObservations.$inferInsert, "id" | "createdBy" | "reviewedBy" | "reviewedAt" | "createdAt" | "availabilityEvidence" | "availabilityObservedAt" | "deidentificationState">;
  documentationCodes: Array<typeof observationDocumentation.$inferInsert["documentationCode"]>;
  actor: AdminActor;
}) {
  return db.transaction(async (tx) => {
    const id = generateOrderedId();
    const verified = input.observation.verificationState === "VERIFIED";
    const [observation] = await tx.insert(priceObservations).values({
      ...input.observation,
      id,
      deidentificationState: "DEIDENTIFIED",
      createdBy: input.actor.id,
      reviewedBy: verified ? input.actor.id : null,
      reviewedAt: verified ? new Date() : null,
    }).returning();
    if (input.documentationCodes.length) {
      await tx.insert(observationDocumentation).values(input.documentationCodes.map((documentationCode) => ({ observationId: id, documentationCode })));
    }
    await appendAudit(tx, {
      aggregateType: "price_observation",
      aggregateId: id,
      actorId: input.actor.id,
      action: "OBSERVATION_CREATED",
      metadata: { provenanceType: observation.provenanceType, normalizedPartNumber: observation.normalizedPartNumber },
    });
    if (verified) {
      await appendAudit(tx, {
        aggregateType: "price_observation",
        aggregateId: id,
        actorId: input.actor.id,
        action: "OBSERVATION_VERIFIED",
        metadata: { permittedUseState: observation.permittedUseState },
      });
    }
    return observation;
  });
}

export async function createGovernedPartRelationship(db: PriceCheckDb, input: {
  relationship: Omit<typeof partRelationships.$inferInsert, "id" | "reviewedBy" | "createdAt">;
  actor: AdminActor;
}) {
  return db.transaction(async (tx) => {
    const id = generateOrderedId();
    const verified = input.relationship.verificationState === "VERIFIED";
    const [relationship] = await tx.insert(partRelationships).values({
      ...input.relationship,
      id,
      reviewedBy: verified ? input.actor.id : null,
    }).returning();
    await appendAudit(tx, {
      aggregateType: "part_relationship",
      aggregateId: id,
      actorId: input.actor.id,
      action: "PART_RELATIONSHIP_CREATED",
      metadata: { relationshipType: relationship.relationshipType },
    });
    if (verified) {
      await appendAudit(tx, {
        aggregateType: "part_relationship",
        aggregateId: id,
        actorId: input.actor.id,
        action: "PART_RELATIONSHIP_VERIFIED",
        metadata: { relationshipType: relationship.relationshipType },
      });
    }
    return relationship;
  });
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function booleanValue(value: unknown) {
  return value === true;
}

function transactionFromSnapshot(priceCheck: typeof priceChecks.$inferSelect, snapshot: Record<string, unknown>, documentationCodes: string[]): AnalysisTransaction {
  return {
    normalizedPartNumber: String(snapshot.normalizedPartNumber ?? priceCheck.normalizedPartNumber),
    conditionCode: String(snapshot.conditionCode ?? priceCheck.conditionCode),
    transactionType: String(snapshot.transactionType ?? priceCheck.transactionType),
    quantity: String(snapshot.quantity ?? priceCheck.quantity),
    unitPrice: String(snapshot.unitPrice ?? priceCheck.unitPrice),
    currencyCode: String(snapshot.currencyCode ?? priceCheck.currencyCode),
    coreCharge: stringOrNull(snapshot.coreCharge ?? priceCheck.coreCharge),
    coreDisposition: stringOrNull(snapshot.coreDisposition ?? priceCheck.coreDisposition),
    exchangeFee: stringOrNull(snapshot.exchangeFee ?? priceCheck.exchangeFee),
    freight: stringOrNull(snapshot.freight ?? priceCheck.freight),
    warrantyValue: stringOrNull(snapshot.warrantyValue ?? priceCheck.warrantyValue),
    warrantyUnit: stringOrNull(snapshot.warrantyUnit ?? priceCheck.warrantyUnit),
    warrantyText: stringOrNull(snapshot.warrantyText ?? priceCheck.warrantyText),
    documentationCodes: Array.isArray(snapshot.documentationCodes) ? snapshot.documentationCodes.map(String) : documentationCodes,
    aog: snapshot.aog === undefined ? priceCheck.aog : booleanValue(snapshot.aog),
    transactionDate: stringOrNull(snapshot.transactionDate ?? priceCheck.transactionDate),
    aircraftModel: stringOrNull(snapshot.aircraftModel ?? priceCheck.aircraftModel),
  };
}

export async function runGovernedAnalysis(db: PriceCheckDb, input: {
  priceCheckId: string;
  actor: AdminActor;
  decisions: Array<{ observationId: string; included: boolean; reasonCode: string; analystNote: string | null }>;
  confidence: AnalystConfidence;
  confidenceReason: string;
  today?: string;
}) {
  return db.transaction(async (tx) => {
    const [priceCheck] = await tx.select().from(priceChecks).where(eq(priceChecks.id, input.priceCheckId)).limit(1);
    if (!priceCheck) throw new Error("Price Check was not found.");
    if (!(["ready_for_analysis", "analysis_ready"] as string[]).includes(priceCheck.status)) throw new Error("Price Check must be ready for analysis.");
    const [latestRevision] = await tx.select().from(priceCheckRevisions).where(eq(priceCheckRevisions.priceCheckId, input.priceCheckId)).orderBy(desc(priceCheckRevisions.version)).limit(1);
    if (!latestRevision) throw new Error("A reviewed transaction revision is required.");
    const documentation = await tx.select().from(priceCheckDocumentRequirements).where(eq(priceCheckDocumentRequirements.priceCheckId, input.priceCheckId));
    const snapshot = latestRevision.normalizedSnapshot as Record<string, unknown>;
    const transaction = transactionFromSnapshot(priceCheck, snapshot, documentation.map((item) => item.requirementCode));
    const candidateSet = await listCandidateObservations(tx, transaction.normalizedPartNumber, { scope: "related" });
    if (input.decisions.length !== candidateSet.candidates.length) throw new Error("Every candidate observation requires an include or exclude decision.");
    const decisionMap = new Map(input.decisions.map((decision) => [decision.observationId, decision]));
    const candidateIds = new Set(candidateSet.candidates.map((candidate) => candidate.id));
    if ([...decisionMap.keys()].some((id) => !candidateIds.has(id))) throw new Error("Observation is not a candidate for this Price Check.");
    const selectedRows = candidateSet.candidates.filter((candidate) => decisionMap.get(candidate.id)?.included);
    if (selectedRows.some((candidate) => !candidate.eligible)) throw new Error("Unverified or restricted evidence cannot be included.");
    const selected: AnalysisObservation[] = selectedRows.map((candidate) => ({
      id: candidate.id,
      normalizedPartNumber: candidate.normalizedPartNumber,
      relationshipType: candidate.relationshipType,
      conditionCode: candidate.conditionCode,
      transactionType: candidate.transactionType,
      quantity: candidate.quantity,
      unitPrice: candidate.unitPrice,
      currencyCode: candidate.currencyCode,
      coreCharge: candidate.coreCharge,
      coreDisposition: candidate.coreDisposition,
      exchangeFee: candidate.exchangeFee,
      freight: candidate.freight,
      observationDate: candidate.observationDate,
      warrantyValue: candidate.warrantyValue,
      warrantyUnit: candidate.warrantyUnit,
      warrantyText: candidate.warrantyText,
      documentationCodes: candidate.documentationCodes,
      aog: candidate.aog,
      sourceReliability: candidate.sourceReliability,
    }));
    const result = deterministicComparableAnalysis({
      transaction,
      selected,
      confidence: input.confidence,
      confidenceReason: input.confidenceReason,
      today: input.today ?? new Date().toISOString().slice(0, 10),
    });

    const [latestAnalysis] = await tx.select({ id: priceCheckAnalyses.id, version: priceCheckAnalyses.version })
      .from(priceCheckAnalyses).where(eq(priceCheckAnalyses.priceCheckId, input.priceCheckId)).orderBy(desc(priceCheckAnalyses.version)).limit(1);
    const version = (latestAnalysis?.version ?? 0) + 1;
    const analysisId = generateOrderedId();
    if (latestAnalysis) {
      await tx.update(priceCheckAnalyses).set({ reviewState: "SUPERSEDED" }).where(eq(priceCheckAnalyses.id, latestAnalysis.id));
      await appendAudit(tx, { aggregateType: "price_check", aggregateId: input.priceCheckId, actorId: input.actor.id, action: "ANALYSIS_SUPERSEDED", beforeVersionReference: `analysis:${latestAnalysis.version}`, afterVersionReference: `analysis:${version}` });
    }
    await appendAudit(tx, { aggregateType: "price_check", aggregateId: input.priceCheckId, actorId: input.actor.id, action: "ANALYSIS_STARTED", afterVersionReference: `analysis:${version}` });
    const payload = result.payload;
    const [analysis] = await tx.insert(priceCheckAnalyses).values({
      id: analysisId,
      priceCheckId: input.priceCheckId,
      version,
      inputRevisionId: latestRevision.id,
      engineVersion: ANALYSIS_ENGINE_VERSION,
      policyVersion: ANALYSIS_POLICY_VERSION,
      sourceTransactionComponents: snapshot,
      normalizedTransactionComponents: transaction,
      marketLow: payload.observedComparableLow,
      marketMedian: payload.observedComparableMedian,
      marketHigh: payload.observedComparableHigh,
      currencyCode: selected.length && !payload.insufficiencyReasons.includes("CURRENCY_NORMALIZATION_REQUIRED") ? transaction.currencyCode : null,
      evidenceCount: selected.length,
      confidence: input.confidence,
      classification: payload.pricePosition,
      insufficiencyReasons: payload.insufficiencyReasons,
      factorCodes: payload.warnings,
      deterministicCalculation: payload,
      deterministicCalculationDigest: result.digest,
      analystId: input.actor.id,
      reviewState: "HUMAN_REVIEW",
      reviewedAt: new Date(),
    }).returning();

    const comparables = candidateSet.candidates.map((candidate, index) => {
      const decision = decisionMap.get(candidate.id)!;
      return {
        analysisId,
        observationId: candidate.id,
        included: decision.included,
        reasonCode: decision.reasonCode,
        analystNote: decision.analystNote,
        comparableSnapshot: {
          originalPartNumber: candidate.originalPartNumber,
          normalizedPartNumber: candidate.normalizedPartNumber,
          relationshipType: candidate.relationshipType,
          conditionCode: candidate.conditionCode,
          transactionType: candidate.transactionType,
          quantity: candidate.quantity,
          unitPrice: candidate.unitPrice,
          currencyCode: candidate.currencyCode,
          coreCharge: candidate.coreCharge,
          coreDisposition: candidate.coreDisposition,
          exchangeFee: candidate.exchangeFee,
          freight: candidate.freight,
          observationDate: candidate.observationDate,
          warrantyValue: candidate.warrantyValue,
          warrantyUnit: candidate.warrantyUnit,
          warrantyText: candidate.warrantyText,
          documentationCodes: candidate.documentationCodes,
          aog: candidate.aog,
          aircraftApplication: candidate.aircraftApplication,
          sourceReliability: candidate.sourceReliability,
          verificationState: candidate.verificationState,
          permittedUseState: candidate.permittedUseState,
          provenanceType: candidate.provenanceType,
        },
        normalizationReference: candidate.relationship ? { relationshipId: candidate.relationship.id, relationshipType: candidate.relationship.relationshipType, verificationState: candidate.relationship.verificationState } : { relationshipType: "EXACT" },
        sequence: index + 1,
      };
    });
    if (comparables.length) await tx.insert(priceCheckComparables).values(comparables);
    for (const comparable of comparables) {
      await appendAudit(tx, {
        aggregateType: "price_check",
        aggregateId: input.priceCheckId,
        actorId: input.actor.id,
        action: comparable.included ? "COMPARABLE_INCLUDED" : "COMPARABLE_EXCLUDED",
        afterVersionReference: `analysis:${version}`,
        metadata: { observationId: comparable.observationId, reasonCode: comparable.reasonCode },
      });
    }
    await appendAudit(tx, { aggregateType: "price_check", aggregateId: input.priceCheckId, actorId: input.actor.id, action: "CONFIDENCE_SELECTED", afterVersionReference: `analysis:${version}`, metadata: { confidence: input.confidence } });
    await appendAudit(tx, { aggregateType: "price_check", aggregateId: input.priceCheckId, actorId: input.actor.id, action: "ANALYSIS_CREATED", afterVersionReference: `analysis:${version}`, metadata: { evidenceCount: selected.length, engineVersion: ANALYSIS_ENGINE_VERSION, digest: result.digest } });
    await tx.update(priceChecks).set({ currentAnalysisId: analysisId, updatedAt: new Date() }).where(and(eq(priceChecks.id, input.priceCheckId), eq(priceChecks.id, priceCheck.id)));
    return { analysis, payload };
  });
}

export async function listAnalysisHistory(db: PriceCheckDb, priceCheckId: string) {
  return db.select({
    id: priceCheckAnalyses.id,
    version: priceCheckAnalyses.version,
    evidenceCount: priceCheckAnalyses.evidenceCount,
    confidence: priceCheckAnalyses.confidence,
    classification: priceCheckAnalyses.classification,
    marketLow: priceCheckAnalyses.marketLow,
    marketMedian: priceCheckAnalyses.marketMedian,
    marketHigh: priceCheckAnalyses.marketHigh,
    currencyCode: priceCheckAnalyses.currencyCode,
    factorCodes: priceCheckAnalyses.factorCodes,
    insufficiencyReasons: priceCheckAnalyses.insufficiencyReasons,
    deterministicCalculation: priceCheckAnalyses.deterministicCalculation,
    deterministicCalculationDigest: priceCheckAnalyses.deterministicCalculationDigest,
    reviewState: priceCheckAnalyses.reviewState,
    analystEmail: adminUsers.displayEmail,
    createdAt: priceCheckAnalyses.createdAt,
  }).from(priceCheckAnalyses)
    .leftJoin(adminUsers, eq(priceCheckAnalyses.analystId, adminUsers.id))
    .where(eq(priceCheckAnalyses.priceCheckId, priceCheckId))
    .orderBy(desc(priceCheckAnalyses.version));
}
