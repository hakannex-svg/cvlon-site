import "../server-boundary.ts";

import { createHash } from "node:crypto";
export { excludeReasonCodes, includeReasonCodes } from "../../../lib/price-check/admin/analysis-options.ts";

export const ANALYSIS_ENGINE_VERSION = "civilon-comparables-1.0.0";
export const ANALYSIS_POLICY_VERSION = "phase-5-deterministic-1.0.0";
export const OLD_EVIDENCE_DAYS = 730;

export type AnalysisTransaction = {
  normalizedPartNumber: string;
  conditionCode: string;
  transactionType: string;
  quantity: string;
  unitPrice: string;
  currencyCode: string;
  coreCharge: string | null;
  coreDisposition: string | null;
  exchangeFee: string | null;
  freight: string | null;
  warrantyValue: string | null;
  warrantyUnit: string | null;
  warrantyText: string | null;
  documentationCodes: string[];
  aog: boolean;
  transactionDate: string | null;
  aircraftModel: string | null;
};

export type AnalysisObservation = {
  id: string;
  normalizedPartNumber: string;
  relationshipType: string;
  conditionCode: string;
  transactionType: string;
  quantity: string;
  unitPrice: string;
  currencyCode: string;
  coreCharge: string | null;
  coreDisposition: string | null;
  exchangeFee: string | null;
  freight: string | null;
  observationDate: string;
  warrantyValue: string | null;
  warrantyUnit: string | null;
  warrantyText: string | null;
  documentationCodes: string[];
  aog: boolean;
  sourceReliability: string;
};

export type AnalystConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";

const FIXED_SCALE = 4;
const FIXED_FACTOR = BigInt(10 ** FIXED_SCALE);

function fixed(value: string) {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) throw new Error("Invalid fixed-precision decimal.");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * FIXED_FACTOR + BigInt(fraction.padEnd(FIXED_SCALE, "0"));
}

function fixedString(value: bigint) {
  const negative = value < 0;
  const absolute = negative ? -value : value;
  const whole = absolute / FIXED_FACTOR;
  const fraction = (absolute % FIXED_FACTOR).toString().padStart(FIXED_SCALE, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function divideRounded(numerator: bigint, denominator: bigint) {
  if (denominator <= 0) throw new Error("Fixed-precision denominator must be positive.");
  const negative = numerator < 0;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * BigInt(2) >= denominator ? quotient + BigInt(1) : quotient;
  return negative ? -rounded : rounded;
}

function sameSet(left: string[], right: string[]) {
  const normalized = (values: string[]) => [...new Set(values)].sort().join("|");
  return normalized(left) === normalized(right);
}

function nullableEqual(left: string | null, right: string | null) {
  return (left ?? "") === (right ?? "");
}

function ageInDays(observed: string, today: string) {
  const start = Date.parse(`${observed}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Observation date is invalid.");
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function deterministicComparableAnalysis(input: {
  transaction: AnalysisTransaction;
  selected: AnalysisObservation[];
  confidence: AnalystConfidence;
  confidenceReason: string;
  today: string;
}) {
  const { transaction, selected } = input;
  const confidenceReason = input.confidenceReason.trim().slice(0, 1000);
  if (selected.length === 0 && input.confidence !== "INSUFFICIENT_DATA") {
    throw new Error("Zero selected observations requires INSUFFICIENT_DATA confidence.");
  }
  if (selected.length > 0 && input.confidence === "INSUFFICIENT_DATA") {
    throw new Error("INSUFFICIENT_DATA confidence is reserved for zero selected observations.");
  }
  if (input.confidence !== "INSUFFICIENT_DATA" && !confidenceReason) {
    throw new Error("Analyst confidence requires a reason.");
  }

  const warnings = new Set<string>();
  const insufficiencyReasons: string[] = [];
  if (selected.length === 0) insufficiencyReasons.push("INSUFFICIENT_DATA");
  if (selected.length === 1) insufficiencyReasons.push("SINGLE_OBSERVATION");
  if (selected.length === 2) insufficiencyReasons.push("LIMITED_EVIDENCE");

  const currencies = [...new Set(selected.map((item) => item.currencyCode))];
  if (currencies.length > 1 || (currencies.length === 1 && currencies[0] !== transaction.currencyCode)) {
    warnings.add("CURRENCY_MIXED");
    insufficiencyReasons.push("CURRENCY_NORMALIZATION_REQUIRED");
  }
  if (selected.some((item) => item.relationshipType !== "EXACT")) warnings.add("PART_RELATIONSHIP_USED");
  if (selected.some((item) => item.conditionCode !== transaction.conditionCode)) warnings.add("CONDITION_MIXED");
  if (selected.some((item) => item.transactionType !== transaction.transactionType)) warnings.add("TRANSACTION_TYPE_MIXED");
  if (selected.some((item) => !nullableEqual(item.coreDisposition, transaction.coreDisposition) || !nullableEqual(item.coreCharge, transaction.coreCharge))) warnings.add("CORE_TERMS_MIXED");
  if (selected.some((item) => !sameSet(item.documentationCodes, transaction.documentationCodes))) warnings.add("DOCUMENTATION_MIXED");
  if (selected.some((item) => !nullableEqual(item.warrantyValue, transaction.warrantyValue) || !nullableEqual(item.warrantyUnit, transaction.warrantyUnit) || !nullableEqual(item.warrantyText, transaction.warrantyText))) warnings.add("WARRANTY_MIXED");
  if (selected.some((item) => item.aog !== transaction.aog)) warnings.add("AOG_CONTEXT_MIXED");
  if (selected.some((item) => item.quantity !== transaction.quantity)) warnings.add("QUANTITY_VARIANCE");
  if (selected.some((item) => ageInDays(item.observationDate, input.today) > OLD_EVIDENCE_DAYS)) warnings.add("OLD_EVIDENCE");

  const sameCurrency = selected.length > 0 && selected.every((item) => item.currencyCode === transaction.currencyCode);
  const sortedAmounts = sameCurrency ? selected.map((item) => fixed(item.unitPrice)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0) : [];
  const descriptiveMinimum = sortedAmounts.length ? sortedAmounts[0] : null;
  const descriptiveMaximum = sortedAmounts.length ? sortedAmounts[sortedAmounts.length - 1] : null;
  const descriptiveMedian = sortedAmounts.length
    ? sortedAmounts.length % 2 === 1
      ? sortedAmounts[Math.floor(sortedAmounts.length / 2)]
      : divideRounded(sortedAmounts[sortedAmounts.length / 2 - 1] + sortedAmounts[sortedAmounts.length / 2], BigInt(2))
    : null;
  const descriptiveMean = sortedAmounts.length
    ? divideRounded(sortedAmounts.reduce((total, value) => total + value, BigInt(0)), BigInt(sortedAmounts.length))
    : null;

  const canRepresentRange = sameCurrency && selected.length >= 2;
  const marketLow = canRepresentRange ? descriptiveMinimum : null;
  const marketMedian = canRepresentRange ? descriptiveMedian : null;
  const marketHigh = canRepresentRange ? descriptiveMaximum : null;
  const submitted = fixed(transaction.unitPrice);
  const difference = marketMedian === null ? null : submitted - marketMedian;
  const percentageDifference = marketMedian && marketMedian > 0
    ? divideRounded(difference! * BigInt(100) * FIXED_FACTOR, marketMedian)
    : null;
  const position = marketLow === null || marketHigh === null
    ? "INSUFFICIENT_DATA"
    : submitted < marketLow
      ? "BELOW_OBSERVED_RANGE"
      : submitted > marketHigh
        ? "ABOVE_OBSERVED_RANGE"
        : "WITHIN_OBSERVED_RANGE";

  const dates = selected.map((item) => item.observationDate).sort();
  const exactPartCount = selected.filter((item) => item.relationshipType === "EXACT").length;
  const confidenceDimensions = {
    exactPartCount,
    governedRelatedPartCount: selected.length - exactPartCount,
    selectedEvidenceCount: selected.length,
    newestObservationDate: dates.at(-1) ?? null,
    oldestObservationDate: dates[0] ?? null,
    evidenceAgeSpanDays: dates.length > 1 ? ageInDays(dates[0], dates.at(-1)!) : 0,
    sameConditionCount: selected.filter((item) => item.conditionCode === transaction.conditionCode).length,
    sameTransactionTypeCount: selected.filter((item) => item.transactionType === transaction.transactionType).length,
    sameCurrencyCount: selected.filter((item) => item.currencyCode === transaction.currencyCode).length,
    documentationComparableCount: selected.filter((item) => sameSet(item.documentationCodes, transaction.documentationCodes)).length,
    coreComparableCount: selected.filter((item) => nullableEqual(item.coreDisposition, transaction.coreDisposition) && nullableEqual(item.coreCharge, transaction.coreCharge)).length,
    warrantyComparableCount: selected.filter((item) => nullableEqual(item.warrantyValue, transaction.warrantyValue) && nullableEqual(item.warrantyUnit, transaction.warrantyUnit) && nullableEqual(item.warrantyText, transaction.warrantyText)).length,
    sourceReliabilityMix: Object.fromEntries(["HIGH", "MEDIUM", "LOW", "UNKNOWN"].map((level) => [level, selected.filter((item) => item.sourceReliability === level).length])),
    unresolvedWarnings: [...warnings].sort(),
  };

  const forfeitedCoreTotals = selected
    .filter((item) => item.transactionType === "exchange" && item.coreDisposition === "FORFEITED" && item.currencyCode === transaction.currencyCode)
    .map((item) => ({
      observationId: item.id,
      knownEconomicCost: fixedString(fixed(item.unitPrice) + fixed(item.coreCharge ?? "0") + fixed(item.exchangeFee ?? "0") + fixed(item.freight ?? "0")),
      note: "Unit price plus explicitly forfeited core, exchange fee, and known freight; refundable cores are excluded.",
    }));

  const payload = {
    engineVersion: ANALYSIS_ENGINE_VERSION,
    policyVersion: ANALYSIS_POLICY_VERSION,
    transactionCurrency: transaction.currencyCode,
    selectedCount: selected.length,
    descriptiveMinimum: descriptiveMinimum === null ? null : fixedString(descriptiveMinimum),
    descriptiveMedian: descriptiveMedian === null ? null : fixedString(descriptiveMedian),
    descriptiveMaximum: descriptiveMaximum === null ? null : fixedString(descriptiveMaximum),
    arithmeticMean: descriptiveMean === null ? null : fixedString(descriptiveMean),
    observedComparableLow: marketLow === null ? null : fixedString(marketLow),
    observedComparableMedian: marketMedian === null ? null : fixedString(marketMedian),
    observedComparableHigh: marketHigh === null ? null : fixedString(marketHigh),
    submittedPrice: fixedString(submitted),
    differenceFromMedian: difference === null ? null : fixedString(difference),
    percentageDifferenceFromMedian: percentageDifference === null ? null : fixedString(percentageDifference),
    pricePosition: position,
    warnings: [...warnings].sort(),
    insufficiencyReasons: [...new Set(insufficiencyReasons)],
    confidenceDimensions,
    analystConfidence: input.confidence,
    confidenceReason,
    forfeitedCoreTotals,
  };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { payload, digest };
}
