import "@/db/price-check/server-boundary";

import { createHash, randomBytes } from "node:crypto";
import type { PriceCheckDb } from "@/db/price-check";
import {
  getExtractionJobContext, leaseExtractionJob, recordExtractionFailure, storeExtractionSuccess,
} from "@/db/price-check/repositories/extraction-repository";
import { getOpenAIExtractionConfig } from "./config";
import { extractDocumentWithOpenAI } from "./openai";
import { fetchVerifiedCleanAttachment } from "./source";

const safeErrors = new Set([
  "ATTACHMENT_NOT_CLEAN", "ATTACHMENT_TYPE_UNSUPPORTED", "ATTACHMENT_SCAN_EVIDENCE_MISSING",
  "ATTACHMENT_OBJECT_MISSING", "ATTACHMENT_INTEGRITY_MISMATCH", "OPENAI_TIMEOUT", "OPENAI_RATE_LIMITED",
  "OPENAI_UNAVAILABLE", "OPENAI_REQUEST_REJECTED", "OPENAI_REFUSAL", "OPENAI_INCOMPLETE",
  "OPENAI_OUTPUT_MISSING", "OPENAI_STRUCTURED_OUTPUT_INVALID", "EXTRACTION_SCHEMA_INVALID",
  "OPENAI_OUTPUT_TOO_LARGE", "OPENAI_RESPONSE_INVALID",
  "OPENAI_EXTRACTION_NOT_CONFIGURED", "OPENAI_PRODUCTION_DISABLED", "OPENAI_PREVIEW_BRANCH_REJECTED",
]);

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "EXTRACTION_FAILED";
  return safeErrors.has(message) ? message : "EXTRACTION_FAILED";
}

export async function processExtractionJob(db: PriceCheckDb, jobId: string) {
  const config = getOpenAIExtractionConfig();
  const leaseOwner = `phase8:${randomBytes(12).toString("hex")}`;
  const leased = await leaseExtractionJob(db, { jobId, leaseOwner, now: new Date(), leaseUntil: new Date(Date.now() + 60_000) });
  if (!leased) return { state: "existing" as const };
  const context = await getExtractionJobContext(db, leased.id, leaseOwner);
  if (!context) throw new Error("EXTRACTION_LEASE_LOST");
  const correlationId = `extract:${crypto.randomUUID()}`;
  try {
    const source = await fetchVerifiedCleanAttachment(context.attachment);
    const result = await extractDocumentWithOpenAI({ config, bytes: source.bytes, mime: source.mime, filename: source.filename });
    const stored = await storeExtractionSuccess(db, {
      jobId: leased.id, leaseOwner, attachmentId: context.attachment.id, priceCheckId: context.attachment.priceCheckId,
      model: config.model, schemaVersion: config.schemaVersion, promptVersion: config.promptVersion,
      proposal: result.proposal, requestDigest: result.requestDigest, latencyMs: result.latencyMs, usage: result.usage,
    });
    console.info("price_check_extraction", { correlationId, attachmentId: context.attachment.id, jobId: leased.id, modelConfig: config.model, state: "succeeded", latencyMs: result.latencyMs, usage: result.usage });
    return { state: "succeeded" as const, ...stored };
  } catch (error) {
    const code = safeError(error);
    const requestDigest = createHash("sha256").update(`${leased.id}:${leased.attemptCount}:${config.model}`).digest("hex");
    await recordExtractionFailure(db, {
      jobId: leased.id, leaseOwner, attachmentId: context.attachment.id, priceCheckId: context.attachment.priceCheckId,
      model: config.model, schemaVersion: config.schemaVersion, promptVersion: config.promptVersion,
      requestDigest, errorCode: code, attemptCount: leased.attemptCount,
    });
    console.warn("price_check_extraction", { correlationId, attachmentId: context.attachment.id, jobId: leased.id, modelConfig: config.model, state: "failed", errorCode: code });
    return { state: "failed" as const, errorCode: code };
  }
}
