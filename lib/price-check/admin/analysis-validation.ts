import type { AnalystConfidence } from "../../../db/price-check/domain/comparable-analysis.ts";
import { excludeReasonCodes, includeReasonCodes } from "./analysis-options.ts";
import { normalizePartNumber, parseMoney, supportedCurrencyCodes } from "../../../db/price-check/domain/normalization.ts";

const conditions = ["NE", "NS", "OH", "SV", "AR", "NOT_SURE"] as const;
const transactions = ["outright", "exchange", "repair", "not_sure"] as const;
const provenanceTypes = ["CIVILON_SUPPLIER_QUOTE", "CIVILON_PURCHASE", "CIVILON_SALE", "CUSTOMER_SUPPLIER_QUOTE", "CUSTOMER_COMPLETED_PURCHASE", "ANALYST_OBSERVATION", "LICENSED_MARKET_DATA", "OTHER_AUTHORIZED"] as const;
const reliabilityLevels = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
const verificationStates = ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"] as const;
const permittedUseStates = ["PENDING", "INTERNAL_ANALYSIS", "AGGREGATE_ONLY", "PROHIBITED"] as const;
const coreDispositions = ["REFUNDABLE", "FORFEITED", "UNCLEAR", "NOT_APPLICABLE"] as const;
const warrantyUnits = ["DAYS", "MONTHS", "YEARS", "HOURS", "CYCLES", "OTHER"] as const;
const documentationCodes = ["FAA_8130_3", "EASA_FORM_1", "DUAL_RELEASE", "OEM_MANUFACTURER_COC", "MATERIAL_CERTIFICATION", "REMOVAL_RECORDS", "TEARDOWN_EVALUATION_REPORT", "TEST_REPORT", "OTHER", "NOT_SURE"] as const;
const relationshipTypes = ["EXACT", "SUPERSEDES", "SUPERSEDED_BY", "INTERCHANGEABLE", "RELATED_APPLICATION"] as const;
const confidenceValues = ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA"] as const;

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A JSON object is required.");
  return value as Record<string, unknown>;
}

function strictKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`Unexpected field: ${unexpected[0]}.`);
}

function text(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.normalize("NFKC").replace(/\p{Cc}/gu, "").trim().slice(0, max);
  if (required && !normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function optionalText(value: unknown, label: string, max: number) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, label, max);
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${label} is invalid.`);
  return value as T[number];
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}

function dateValue(value: unknown, label: string) {
  const normalized = text(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !Number.isFinite(Date.parse(`${normalized}T00:00:00Z`))) throw new Error(`${label} is invalid.`);
  return normalized;
}

function decimal(value: unknown, label: string, scale = 3) {
  const normalized = text(String(value ?? ""), label, 30);
  const expression = new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`);
  if (!expression.test(normalized) || Number(normalized) <= 0) throw new Error(`${label} must be a positive decimal.`);
  return normalized;
}

function optionalMoney(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  try { return parseMoney(String(value)); }
  catch { throw new Error(`${label} is invalid.`); }
}

function docs(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Documentation codes must be an array.");
  return [...new Set(value.map((item) => enumValue(item, documentationCodes, "Documentation code")))];
}

export function parseObservationInput(value: unknown) {
  const input = record(value);
  strictKeys(input, ["provenanceType", "internalSourceReference", "originalPartNumber", "conditionCode", "transactionType", "quantity", "unitPrice", "currencyCode", "coreCharge", "coreDisposition", "exchangeFee", "freight", "observationDate", "warrantyValue", "warrantyUnit", "warrantyText", "aog", "aircraftApplication", "regionContext", "sourceReliability", "verificationState", "permittedUseState", "documentationCodes"]);
  return {
    provenanceType: enumValue(input.provenanceType, provenanceTypes, "Provenance"),
    internalSourceReference: optionalText(input.internalSourceReference, "Internal source reference", 240),
    originalPartNumber: text(input.originalPartNumber, "Part number", 160),
    normalizedPartNumber: normalizePartNumber(text(input.originalPartNumber, "Part number", 160)),
    conditionCode: enumValue(input.conditionCode, conditions, "Condition"),
    transactionType: enumValue(input.transactionType, transactions, "Transaction type"),
    quantity: decimal(input.quantity, "Quantity"),
    unitPrice: parseMoney(text(String(input.unitPrice ?? ""), "Unit price", 30)),
    currencyCode: enumValue(input.currencyCode, supportedCurrencyCodes, "Currency"),
    coreCharge: optionalMoney(input.coreCharge, "Core charge"),
    coreDisposition: input.coreDisposition ? enumValue(input.coreDisposition, coreDispositions, "Core disposition") : null,
    exchangeFee: optionalMoney(input.exchangeFee, "Exchange fee"),
    freight: optionalMoney(input.freight, "Freight"),
    observationDate: dateValue(input.observationDate, "Observation date"),
    warrantyValue: input.warrantyValue ? decimal(input.warrantyValue, "Warranty value", 2) : null,
    warrantyUnit: input.warrantyUnit ? enumValue(input.warrantyUnit, warrantyUnits, "Warranty unit") : null,
    warrantyText: optionalText(input.warrantyText, "Warranty text", 500),
    aog: booleanValue(input.aog, "AOG"),
    aircraftApplication: optionalText(input.aircraftApplication, "Aircraft application", 240),
    regionContext: optionalText(input.regionContext, "Region context", 160),
    sourceReliability: enumValue(input.sourceReliability, reliabilityLevels, "Source reliability"),
    verificationState: enumValue(input.verificationState, verificationStates, "Verification state"),
    permittedUseState: enumValue(input.permittedUseState, permittedUseStates, "Permitted-use state"),
    documentationCodes: docs(input.documentationCodes ?? []),
  };
}

export function parseRelationshipInput(value: unknown) {
  const input = record(value);
  strictKeys(input, ["fromPartNumber", "toPartNumber", "relationshipType", "sourceProvenance", "verificationState", "effectiveFrom", "effectiveTo", "notes"]);
  const from = normalizePartNumber(text(input.fromPartNumber, "From part number", 160));
  const to = normalizePartNumber(text(input.toPartNumber, "To part number", 160));
  const relationshipType = enumValue(input.relationshipType, relationshipTypes, "Relationship type");
  if (from === to && relationshipType !== "EXACT") throw new Error("A non-EXACT relationship requires different part numbers.");
  return {
    fromNormalizedPartNumber: from,
    toNormalizedPartNumber: to,
    relationshipType,
    sourceProvenance: text(input.sourceProvenance, "Source provenance", 240),
    verificationState: enumValue(input.verificationState, verificationStates, "Verification state"),
    effectiveFrom: input.effectiveFrom ? dateValue(input.effectiveFrom, "Effective from") : null,
    effectiveTo: input.effectiveTo ? dateValue(input.effectiveTo, "Effective to") : null,
    notes: optionalText(input.notes, "Relationship notes", 1000),
  };
}

export type AnalysisDecisionInput = {
  observationId: string;
  included: boolean;
  reasonCode: string;
  analystNote: string | null;
};

export function parseAnalysisInput(value: unknown) {
  const input = record(value);
  strictKeys(input, ["decisions", "confidence", "confidenceReason"]);
  if (!Array.isArray(input.decisions) || input.decisions.length > 500) throw new Error("Comparable decisions are invalid.");
  const decisions = input.decisions.map((item): AnalysisDecisionInput => {
    const decision = record(item);
    strictKeys(decision, ["observationId", "included", "reasonCode", "analystNote"]);
    const included = booleanValue(decision.included, "Included state");
    const reasonCode = enumValue(decision.reasonCode, included ? includeReasonCodes : excludeReasonCodes, "Comparable reason");
    return {
      observationId: text(decision.observationId, "Observation ID", 26),
      included,
      reasonCode,
      analystNote: optionalText(decision.analystNote, "Analyst note", 1000),
    };
  });
  if (new Set(decisions.map((item) => item.observationId)).size !== decisions.length) throw new Error("Duplicate comparable decision.");
  return {
    decisions,
    confidence: enumValue(input.confidence, confidenceValues, "Confidence") as AnalystConfidence,
    confidenceReason: text(input.confidenceReason ?? "", "Confidence reason", 1000, false),
  };
}
