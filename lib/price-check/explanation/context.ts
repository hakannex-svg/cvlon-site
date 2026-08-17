import "../../../db/price-check/server-boundary.ts";
import type { ExplanationContext, ExplanationFactorCode, ExplanationWarningCode } from "./schema.ts";

const factorMap: Record<string, ExplanationFactorCode | null> = {
  CONDITION_MIXED: "CONDITION",
  TRANSACTION_TYPE_MIXED: "TRANSACTION_TYPE",
  CORE_TERMS_MIXED: "CORE_TERMS",
  DOCUMENTATION_MIXED: "DOCUMENTATION",
  WARRANTY_MIXED: "WARRANTY",
  AOG_CONTEXT_MIXED: "AOG",
  PART_RELATIONSHIP_USED: "RELATED_PART",
  QUANTITY_VARIANCE: "QUANTITY",
  OLD_EVIDENCE: null,
  CURRENCY_MIXED: null,
};

const warningMap: Record<string, ExplanationWarningCode | null> = {
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  LIMITED_EVIDENCE: "LIMITED_EVIDENCE",
  SINGLE_OBSERVATION: "SINGLE_OBSERVATION",
  CURRENCY_NORMALIZATION_REQUIRED: "CURRENCY_NORMALIZATION_REQUIRED",
  PART_RELATIONSHIP_USED: "RELATED_PART_EVIDENCE",
  DOCUMENTATION_MIXED: "MIXED_DOCUMENTATION",
  OLD_EVIDENCE: "OLD_EVIDENCE",
  CONDITION_MIXED: "MIXED_CONDITION",
  TRANSACTION_TYPE_MIXED: "MIXED_TRANSACTION_TYPE",
  CORE_TERMS_MIXED: "MIXED_CORE_TERMS",
  WARRANTY_MIXED: "MIXED_WARRANTY",
  AOG_CONTEXT_MIXED: "MIXED_AOG_CONTEXT",
  CURRENCY_MIXED: "CURRENCY_NORMALIZATION_REQUIRED",
  QUANTITY_VARIANCE: null,
};

function controlled<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

export function buildExplanationContext(analysis: {
  classification: string | null;
  confidence: string;
  evidenceCount: number;
  factorCodes: string[];
  insufficiencyReasons: string[] | null;
  normalizedTransactionComponents: Record<string, unknown>;
}): ExplanationContext {
  const transaction = analysis.normalizedTransactionComponents;
  const rawCodes = [...new Set([...(analysis.factorCodes ?? []), ...(analysis.insufficiencyReasons ?? [])])];
  const factorCodes = [...new Set(rawCodes.map((code) => factorMap[code]).filter(Boolean))] as ExplanationFactorCode[];
  const warningCodes = [...new Set(rawCodes.map((code) => warningMap[code]).filter(Boolean))] as ExplanationWarningCode[];
  const classification = analysis.classification === "BELOW_OBSERVED_RANGE" || analysis.classification === "WITHIN_OBSERVED_RANGE" || analysis.classification === "ABOVE_OBSERVED_RANGE"
    ? analysis.classification
    : "INSUFFICIENT_DATA";
  const condition = controlled(transaction.conditionCode, ["NE", "NS", "OH", "SV", "AR"] as const, "UNKNOWN");
  const transactionType = controlled(typeof transaction.transactionType === "string" ? transaction.transactionType.toUpperCase() : null, ["OUTRIGHT", "EXCHANGE", "REPAIR"] as const, "UNKNOWN");
  const core = controlled(transaction.coreDisposition, ["REFUNDABLE", "FORFEITED", "UNCLEAR", "NOT_APPLICABLE"] as const, transactionType === "EXCHANGE" ? "NONE" : "NOT_APPLICABLE");
  const documentation = Array.isArray(transaction.documentationCodes) && transaction.documentationCodes.length > 0 ? (rawCodes.includes("DOCUMENTATION_MIXED") ? "MIXED" : "MATCHED") : "NOT_SPECIFIED";
  const hasWarranty = Boolean(transaction.warrantyValue || transaction.warrantyText);
  return {
    classification,
    confidence: controlled(analysis.confidence, ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA"] as const, "INSUFFICIENT_DATA"),
    condition,
    transaction_type: transactionType,
    factor_codes: factorCodes.sort(),
    warning_codes: warningCodes.sort(),
    evidence_band: analysis.evidenceCount === 0 ? "INSUFFICIENT" : analysis.evidenceCount === 1 ? "SINGLE" : analysis.evidenceCount === 2 ? "LIMITED" : "MULTIPLE",
    core_context: core,
    aog_context: typeof transaction.aog === "boolean" ? (transaction.aog ? "AOG" : "ROUTINE") : "UNKNOWN",
    documentation_context: documentation,
    warranty_context: hasWarranty ? (rawCodes.includes("WARRANTY_MIXED") ? "MIXED" : "MATCHED") : "NOT_SPECIFIED",
    part_relationship_used: rawCodes.includes("PART_RELATIONSHIP_USED"),
  };
}
