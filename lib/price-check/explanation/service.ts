import "../../../db/price-check/server-boundary.ts";

import { createHash, randomBytes } from "node:crypto";
import type { PriceCheckDb } from "../../../db/price-check/index.ts";
import {
  getExplanationJobContext,
  leaseExplanationJob,
  recordExplanationFailure,
  storeExplanationSuccess,
} from "../../../db/price-check/repositories/explanation-repository.ts";
import type { OpenAIExplanationConfig } from "./config.ts";
import { draftExplanationWithOpenAI } from "./openai.ts";
import { EXPLANATION_POLICY_VERSION } from "./schema.ts";

const rejectedCodes = new Set([
  "EXPLANATION_SCHEMA_INVALID", "EXPLANATION_PROHIBITED_LANGUAGE", "EXPLANATION_SENTENCE_COUNT_INVALID",
  "EXPLANATION_CLASSIFICATION_LANGUAGE_MISSING", "EXPLANATION_CLASSIFICATION_CONTRADICTION",
  "EXPLANATION_REVIEW_REQUIRED", "EXPLANATION_UNSUPPORTED_FACTOR", "EXPLANATION_FACTOR_FIDELITY_FAILED",
  "EXPLANATION_UNSUPPORTED_LIMITATION", "EXPLANATION_LIMITATION_FIDELITY_FAILED",
  "EXPLANATION_SUMMARY_INVALID", "EXPLANATION_TEXT_INVALID", "EXPLANATION_FACTOR_TEXT_INVALID",
  "EXPLANATION_LIMITATION_TEXT_INVALID",
]);
const safeProviderCodes = new Set([
  "OPENAI_EXPLANATION_TIMEOUT", "OPENAI_EXPLANATION_RATE_LIMITED", "OPENAI_EXPLANATION_UNAVAILABLE",
  "OPENAI_EXPLANATION_REQUEST_REJECTED", "OPENAI_EXPLANATION_REFUSAL", "OPENAI_EXPLANATION_INCOMPLETE",
  "OPENAI_EXPLANATION_OUTPUT_MISSING", "OPENAI_EXPLANATION_OUTPUT_TOO_LARGE",
  "OPENAI_EXPLANATION_RESPONSE_INVALID", "OPENAI_EXPLANATION_STRUCTURED_OUTPUT_INVALID", "EXPLANATION_ANALYSIS_STALE",
]);

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "OPENAI_EXPLANATION_FAILED";
  if (rejectedCodes.has(message) || safeProviderCodes.has(message)) return message;
  return "OPENAI_EXPLANATION_FAILED";
}

export async function processExplanationJob(db: PriceCheckDb, input: { jobId: string; config: OpenAIExplanationConfig }) {
  const leaseOwner = `phase9:${randomBytes(12).toString("hex")}`;
  const leased = await leaseExplanationJob(db, { jobId: input.jobId, leaseOwner, now: new Date(), leaseUntil: new Date(Date.now() + 45_000) });
  if (!leased) return { state: "existing" as const };
  const record = await getExplanationJobContext(db, leased.id, leaseOwner);
  try {
    if (record.stale) throw new Error("EXPLANATION_ANALYSIS_STALE");
    const generated = await draftExplanationWithOpenAI({ config: input.config, context: record.context });
    const artifact = await storeExplanationSuccess(db, {
      jobId: leased.id, leaseOwner, priceCheckId: record.priceCheck.id, analysisId: record.analysis.id,
      analysisVersion: record.analysis.version, analysisDigest: record.analysis.deterministicCalculationDigest,
      model: input.config.model, schemaVersion: input.config.schemaVersion, promptVersion: input.config.promptVersion,
      policyVersion: EXPLANATION_POLICY_VERSION, requestDigest: generated.requestDigest, draft: generated.draft,
      latencyMs: generated.latencyMs, usage: generated.usage,
    });
    console.info("price_check_ai_explanation", { priceCheckId: record.priceCheck.id, analysisId: record.analysis.id, jobId: leased.id, artifactId: artifact.id, modelConfig: input.config.model, state: "succeeded", latencyMs: generated.latencyMs, usage: generated.usage });
    return { state: "succeeded" as const, artifactId: artifact.id };
  } catch (error) {
    const errorCode = safeError(error);
    const requestDigest = createHash("sha256").update(`${leased.id}:${leased.attemptCount}:${input.config.model}:${record.analysis.deterministicCalculationDigest}`).digest("hex");
    const rejected = rejectedCodes.has(errorCode);
    await recordExplanationFailure(db, {
      jobId: leased.id, leaseOwner, priceCheckId: record.priceCheck.id, analysisId: record.analysis.id,
      model: input.config.model, schemaVersion: input.config.schemaVersion, promptVersion: input.config.promptVersion,
      policyVersion: EXPLANATION_POLICY_VERSION, requestDigest, errorCode, rejected,
    });
    console.warn("price_check_ai_explanation", { priceCheckId: record.priceCheck.id, analysisId: record.analysis.id, jobId: leased.id, modelConfig: input.config.model, state: rejected ? "rejected" : "failed", errorCode });
    return { state: rejected ? "rejected" as const : "failed" as const, errorCode };
  }
}
