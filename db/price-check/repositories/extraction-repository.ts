import "../server-boundary.ts";

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import {
  aiArtifacts,
  attachmentExtractions,
  attachments,
  auditEvents,
  priceCheckRevisions,
  priceChecks,
  processingJobs,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import { normalizePartNumber, parseMoney, validateCurrencyCode } from "../domain/normalization.ts";
import type { AdminActor } from "./admin-repository.ts";
import type { DocumentExtraction, ExtractionLineItem } from "../../../lib/price-check/extraction/schema.ts";

const MAX_ATTEMPTS = 3;

async function extractionAudit(tx: PriceCheckDb, input: {
  priceCheckId: string; actorId: string | null; action: string; attachmentId: string;
  extractionId?: string; jobId?: string; metadata?: Record<string, unknown>;
}) {
  await tx.insert(auditEvents).values({
    id: generateOrderedId(), aggregateType: "price_check", aggregateId: input.priceCheckId,
    actorType: input.actorId ? "ADMIN" : "WORKER", actorId: input.actorId,
    action: input.action, correlationId: `${input.action.toLowerCase()}:${crypto.randomUUID()}`,
    afterVersionReference: input.extractionId ? `extraction:${input.extractionId}` : null,
    sanitizedMetadata: {
      attachmentId: input.attachmentId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.metadata ?? {}),
    },
  });
}

export async function queueAttachmentExtraction(db: PriceCheckDb, input: {
  priceCheckId: string; attachmentId: string; actor: AdminActor; model: string;
  schemaVersion: string; promptVersion: string; retry?: boolean;
}) {
  return db.transaction(async (tx) => {
    const [attachment] = await tx.select().from(attachments).where(and(
      eq(attachments.id, input.attachmentId), eq(attachments.priceCheckId, input.priceCheckId), isNull(attachments.deletedAt),
    )).limit(1);
    if (!attachment) throw new Error("ATTACHMENT_NOT_FOUND");
    if (attachment.scanState !== "CLEAN" || !attachment.contentDigest || !attachment.detectedMime) throw new Error("ATTACHMENT_NOT_CLEAN");
    const idempotencyKey = ["extraction", attachment.id, attachment.contentDigest, input.model, input.schemaVersion, input.promptVersion].join(":");
    const [existing] = await tx.select().from(processingJobs).where(eq(processingJobs.idempotencyKey, idempotencyKey)).limit(1);
    if (existing) {
      if (input.retry && ["failed", "dead_letter"].includes(existing.state)) {
        if (existing.attemptCount >= MAX_ATTEMPTS) throw new Error("EXTRACTION_ATTEMPTS_EXHAUSTED");
        const [retried] = await tx.update(processingJobs).set({ state: "pending", nextAttemptAt: new Date(), sanitizedErrorCode: null, leaseOwner: null, leaseExpiresAt: null })
          .where(and(eq(processingJobs.id, existing.id), inArray(processingJobs.state, ["failed", "dead_letter"]))).returning();
        if (retried) {
          await extractionAudit(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, actorId: input.actor.id, action: "EXTRACTION_RETRY_REQUESTED", attachmentId: attachment.id, jobId: retried.id });
          return { job: retried, created: false, retried: true };
        }
      }
      return { job: existing, created: false, retried: false };
    }
    const [job] = await tx.insert(processingJobs).values({
      id: generateOrderedId(), jobType: "EXTRACTION", aggregateType: "attachment", aggregateId: attachment.id,
      idempotencyKey, state: "pending", attemptCount: 0, nextAttemptAt: new Date(),
    }).returning();
    await extractionAudit(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, actorId: input.actor.id, action: "EXTRACTION_REQUESTED", attachmentId: attachment.id, jobId: job.id });
    return { job, created: true, retried: false };
  });
}

export async function leaseExtractionJob(db: PriceCheckDb, input: { jobId: string; leaseOwner: string; now: Date; leaseUntil: Date }) {
  const [leased] = await db.update(processingJobs).set({
    state: "running", leaseOwner: input.leaseOwner, leaseExpiresAt: input.leaseUntil,
    startedAt: input.now, attemptCount: sql`${processingJobs.attemptCount} + 1`,
  }).where(and(
    eq(processingJobs.id, input.jobId), eq(processingJobs.jobType, "EXTRACTION"),
    inArray(processingJobs.state, ["pending", "failed"]), lt(processingJobs.attemptCount, MAX_ATTEMPTS),
  )).returning();
  return leased ?? null;
}

export async function getExtractionJobContext(db: PriceCheckDb, jobId: string, leaseOwner: string) {
  const [record] = await db.select({ job: processingJobs, attachment: attachments })
    .from(processingJobs).innerJoin(attachments, eq(processingJobs.aggregateId, attachments.id))
    .where(and(eq(processingJobs.id, jobId), eq(processingJobs.jobType, "EXTRACTION"), eq(processingJobs.state, "running"), eq(processingJobs.leaseOwner, leaseOwner))).limit(1);
  return record ?? null;
}

export async function storeExtractionSuccess(db: PriceCheckDb, input: {
  jobId: string; leaseOwner: string; attachmentId: string; priceCheckId: string;
  model: string; schemaVersion: string; promptVersion: string; proposal: DocumentExtraction;
  requestDigest: string; latencyMs: number; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
}) {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(processingJobs).where(and(eq(processingJobs.id, input.jobId), eq(processingJobs.state, "running"), eq(processingJobs.leaseOwner, input.leaseOwner))).limit(1);
    if (!job) throw new Error("EXTRACTION_LEASE_LOST");
    const [latest] = await tx.select({ version: sql<number>`coalesce(max(${attachmentExtractions.version}), 0)::int` }).from(attachmentExtractions).where(eq(attachmentExtractions.attachmentId, input.attachmentId));
    const extractionId = generateOrderedId();
    const version = (latest?.version ?? 0) + 1;
    await tx.insert(attachmentExtractions).values({
      id: extractionId, attachmentId: input.attachmentId, version, provider: "OPENAI",
      configuredModelId: input.model, schemaVersion: input.schemaVersion, promptVersion: input.promptVersion,
      structuredProposal: input.proposal, sourceLocations: [], uncertaintyWarnings: input.proposal.warnings,
      processingStatus: "SUCCEEDED", validationErrors: [],
    });
    await tx.insert(aiArtifacts).values({
      id: generateOrderedId(), artifactType: "DOCUMENT_EXTRACTION", relatedExtractionId: extractionId,
      provider: "OPENAI", configuredModelId: input.model, promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion, redactionPolicyVersion: "phase8-minimum-document-only-v1",
      requestDigest: input.requestDigest, validationState: "VALID",
      tokenMetadata: { inputTokens: input.usage.inputTokens, outputTokens: input.usage.outputTokens, totalTokens: input.usage.totalTokens },
      latencyMetadata: { latencyMs: input.latencyMs },
    });
    await tx.update(processingJobs).set({ state: "succeeded", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, sanitizedErrorCode: null }).where(eq(processingJobs.id, job.id));
    await extractionAudit(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, actorId: null, action: "EXTRACTION_SUCCEEDED", attachmentId: input.attachmentId, extractionId, jobId: input.jobId, metadata: { version, modelConfig: input.model } });
    return { extractionId, version };
  });
}

export async function recordExtractionFailure(db: PriceCheckDb, input: {
  jobId: string; leaseOwner: string; attachmentId: string; priceCheckId: string;
  model: string; schemaVersion: string; promptVersion: string; requestDigest: string; errorCode: string; attemptCount: number;
}) {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(processingJobs).where(and(eq(processingJobs.id, input.jobId), eq(processingJobs.state, "running"), eq(processingJobs.leaseOwner, input.leaseOwner))).limit(1);
    if (!job) return null;
    const [latest] = await tx.select({ version: sql<number>`coalesce(max(${attachmentExtractions.version}), 0)::int` }).from(attachmentExtractions).where(eq(attachmentExtractions.attachmentId, input.attachmentId));
    const extractionId = generateOrderedId();
    const version = (latest?.version ?? 0) + 1;
    await tx.insert(attachmentExtractions).values({
      id: extractionId, attachmentId: input.attachmentId, version, provider: "OPENAI", configuredModelId: input.model,
      schemaVersion: input.schemaVersion, promptVersion: input.promptVersion,
      structuredProposal: { review_required: true, warnings: ["Extraction unavailable — review document manually."] },
      sourceLocations: [], uncertaintyWarnings: [], processingStatus: "FAILED", validationErrors: [{ code: input.errorCode }],
    });
    await tx.insert(aiArtifacts).values({
      id: generateOrderedId(), artifactType: "DOCUMENT_EXTRACTION_FAILURE", relatedExtractionId: extractionId,
      provider: "OPENAI", configuredModelId: input.model, promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion, redactionPolicyVersion: "phase8-minimum-document-only-v1",
      requestDigest: input.requestDigest, validationState: "FAILED", sanitizedErrorCategory: input.errorCode,
    });
    const dead = input.attemptCount >= MAX_ATTEMPTS;
    await tx.update(processingJobs).set({ state: dead ? "dead_letter" : "failed", nextAttemptAt: new Date(Date.now() + 60_000), leaseOwner: null, leaseExpiresAt: null, sanitizedErrorCode: input.errorCode }).where(eq(processingJobs.id, job.id));
    await extractionAudit(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, actorId: null, action: dead ? "EXTRACTION_DEAD_LETTERED" : "EXTRACTION_FAILED", attachmentId: input.attachmentId, extractionId, jobId: input.jobId, metadata: { errorCode: input.errorCode, attemptCount: input.attemptCount } });
    return { extractionId, version, deadLetter: dead };
  });
}

export async function listPriceCheckExtractions(db: PriceCheckDb, priceCheckId: string) {
  return db.select({ extraction: attachmentExtractions, attachmentId: attachments.id, filename: attachments.displayFilename })
    .from(attachmentExtractions).innerJoin(attachments, eq(attachmentExtractions.attachmentId, attachments.id))
    .where(eq(attachments.priceCheckId, priceCheckId)).orderBy(desc(attachmentExtractions.createdAt));
}

const applyFields = ["originalPartNumber", "description", "quantity", "conditionCode", "transactionType", "unitPrice", "currencyCode", "coreCharge", "coreDisposition", "exchangeFee", "freight", "aircraftModel", "warrantyText", "documentationCodes"] as const;
export type ExtractionApplyField = typeof applyFields[number];

function present<T>(field: { state: string; value: T | null }) {
  if (field.state !== "PRESENT" || field.value === null) throw new Error("EXTRACTION_FIELD_NOT_PRESENT");
  return field.value;
}

function availableFields(item: ExtractionLineItem) {
  const candidates: Array<[ExtractionApplyField, { state: string; value: unknown }]> = [
    ["originalPartNumber", item.part_number], ["description", item.description], ["quantity", item.quantity],
    ["conditionCode", item.condition], ["transactionType", item.transaction_type], ["unitPrice", item.unit_price],
    ["currencyCode", item.currency], ["coreCharge", item.core_charge], ["coreDisposition", item.core_disposition],
    ["exchangeFee", item.exchange_fee], ["freight", item.freight], ["aircraftModel", item.aircraft_application],
    ["warrantyText", item.warranty], ["documentationCodes", item.documentation_release],
  ];
  return candidates.filter(([, field]) => field.state === "PRESENT" && field.value !== null).map(([name]) => name);
}

export async function applyConfirmedExtraction(db: PriceCheckDb, input: {
  priceCheckId: string; extractionId: string; lineItemIndex: number; acceptedFields: string[]; changeReason: string; actor: AdminActor;
}) {
  if (!Number.isInteger(input.lineItemIndex) || input.lineItemIndex < 0 || input.lineItemIndex >= 25) throw new Error("EXTRACTION_LINE_ITEM_INVALID");
  const accepted = [...new Set(input.acceptedFields)];
  if (!accepted.length || accepted.some((field) => !applyFields.includes(field as ExtractionApplyField))) throw new Error("EXTRACTION_FIELDS_INVALID");
  if (input.changeReason.trim().length < 8 || input.changeReason.trim().length > 240) throw new Error("EXTRACTION_REASON_INVALID");
  return db.transaction(async (tx) => {
    const [record] = await tx.select({ extraction: attachmentExtractions, attachment: attachments })
      .from(attachmentExtractions).innerJoin(attachments, eq(attachmentExtractions.attachmentId, attachments.id))
      .where(and(eq(attachmentExtractions.id, input.extractionId), eq(attachments.priceCheckId, input.priceCheckId))).limit(1);
    if (!record || record.extraction.processingStatus !== "SUCCEEDED") throw new Error("EXTRACTION_NOT_READY");
    const proposal = record.extraction.structuredProposal as unknown as DocumentExtraction;
    const item = proposal.line_items?.[input.lineItemIndex];
    if (!item) throw new Error("EXTRACTION_LINE_ITEM_INVALID");
    const [latest] = await tx.select().from(priceCheckRevisions).where(eq(priceCheckRevisions.priceCheckId, input.priceCheckId)).orderBy(desc(priceCheckRevisions.version)).limit(1);
    const [source] = await tx.select().from(priceChecks).where(eq(priceChecks.id, input.priceCheckId)).limit(1);
    if (!source) throw new Error("PRICE_CHECK_NOT_FOUND");
    const snapshot: Record<string, unknown> = latest?.normalizedSnapshot ? { ...latest.normalizedSnapshot as Record<string, unknown> } : {
      originalPartNumber: source.originalPartNumber, normalizedPartNumber: source.normalizedPartNumber, description: source.description,
      quantity: source.quantity, quoteOrPurchased: source.quoteOrPurchased, transactionType: source.transactionType,
      conditionCode: source.conditionCode, unitPrice: source.unitPrice, currencyCode: source.currencyCode,
      coreCharge: source.coreCharge, coreDisposition: source.coreDisposition, exchangeFee: source.exchangeFee, freight: source.freight,
      transactionDate: source.transactionDate, aircraftModel: source.aircraftModel, aog: source.aog,
      warrantyValue: source.warrantyValue, warrantyUnit: source.warrantyUnit, warrantyText: source.warrantyText, notes: source.notes,
    };
    for (const field of accepted as ExtractionApplyField[]) {
      if (field === "originalPartNumber") { const value = String(present(item.part_number)).trim(); snapshot.originalPartNumber = value; snapshot.normalizedPartNumber = normalizePartNumber(value); }
      else if (field === "description") snapshot.description = String(present(item.description)).trim();
      else if (field === "quantity") { const value = String(present(item.quantity)); if (!/^\d+(\.\d{1,3})?$/.test(value) || Number(value) <= 0) throw new Error("EXTRACTION_QUANTITY_INVALID"); snapshot.quantity = value; }
      else if (field === "conditionCode") { const value = present(item.condition); if (value === "UNKNOWN") throw new Error("EXTRACTION_CONDITION_UNKNOWN"); snapshot.conditionCode = value; }
      else if (field === "transactionType") { const value = present(item.transaction_type); if (value === "UNKNOWN") throw new Error("EXTRACTION_TRANSACTION_UNKNOWN"); snapshot.transactionType = value.toLowerCase(); }
      else if (field === "unitPrice") snapshot.unitPrice = parseMoney(String(present(item.unit_price)));
      else if (field === "currencyCode") snapshot.currencyCode = validateCurrencyCode(String(present(item.currency)));
      else if (field === "coreCharge") snapshot.coreCharge = parseMoney(String(present(item.core_charge)));
      else if (field === "coreDisposition") snapshot.coreDisposition = present(item.core_disposition);
      else if (field === "exchangeFee") snapshot.exchangeFee = parseMoney(String(present(item.exchange_fee)));
      else if (field === "freight") snapshot.freight = parseMoney(String(present(item.freight)));
      else if (field === "aircraftModel") snapshot.aircraftModel = String(present(item.aircraft_application)).trim();
      else if (field === "warrantyText") snapshot.warrantyText = String(present(item.warranty)).trim();
      else if (field === "documentationCodes") snapshot.documentationCodes = present(item.documentation_release).map((entry) => entry.code).filter((code) => code !== "UNKNOWN");
    }
    const version = (latest?.version ?? 0) + 1;
    const revisionId = generateOrderedId();
    await tx.insert(priceCheckRevisions).values({
      id: revisionId, priceCheckId: input.priceCheckId, version, normalizedSnapshot: snapshot,
      changeReason: input.changeReason.trim(), actorType: "ADMIN", actorId: input.actor.id, sourceExtractionId: record.extraction.id,
    });
    const available = availableFields(item);
    const acceptanceState = accepted.length === available.length && available.every((field) => accepted.includes(field)) ? "ACCEPTED" : "PARTIALLY_ACCEPTED";
    await tx.update(attachmentExtractions).set({ acceptanceState, reviewedBy: input.actor.id, reviewedAt: new Date() }).where(eq(attachmentExtractions.id, record.extraction.id));
    await tx.update(priceChecks).set({ updatedAt: new Date() }).where(eq(priceChecks.id, input.priceCheckId));
    await extractionAudit(tx as PriceCheckDb, { priceCheckId: input.priceCheckId, actorId: input.actor.id, action: "EXTRACTION_CONFIRMED_REVISION_CREATED", attachmentId: record.attachment.id, extractionId: record.extraction.id, metadata: { revisionId, version, lineItemIndex: input.lineItemIndex, acceptedFields: accepted } });
    return { revisionId, version, acceptanceState };
  });
}
