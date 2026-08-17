import "../../../db/price-check/server-boundary.ts";

export const EXPLANATION_SCHEMA_VERSION = "phase9-v1";
export const EXPLANATION_PROMPT_VERSION = "phase9-v1";
export const EXPLANATION_POLICY_VERSION = "phase9-minimum-analysis-enums-v1";

export const explanationClassifications = [
  "BELOW_OBSERVED_RANGE",
  "WITHIN_OBSERVED_RANGE",
  "ABOVE_OBSERVED_RANGE",
  "INSUFFICIENT_DATA",
] as const;
export const explanationConfidences = ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA"] as const;
export const explanationConditions = ["NE", "NS", "OH", "SV", "AR", "UNKNOWN"] as const;
export const explanationTransactions = ["OUTRIGHT", "EXCHANGE", "REPAIR", "UNKNOWN"] as const;
export const explanationFactors = [
  "CONDITION", "TRANSACTION_TYPE", "CORE_TERMS", "DOCUMENTATION", "WARRANTY",
  "AOG", "RELATED_PART", "QUANTITY",
] as const;
export const explanationWarnings = [
  "INSUFFICIENT_DATA", "LIMITED_EVIDENCE", "SINGLE_OBSERVATION",
  "RELATED_PART_EVIDENCE", "MIXED_DOCUMENTATION", "OLD_EVIDENCE",
  "MIXED_CONDITION", "MIXED_TRANSACTION_TYPE", "MIXED_CORE_TERMS",
  "MIXED_WARRANTY", "MIXED_AOG_CONTEXT", "CURRENCY_NORMALIZATION_REQUIRED",
] as const;

export type ExplanationClassification = typeof explanationClassifications[number];
export type ExplanationFactorCode = typeof explanationFactors[number];
export type ExplanationWarningCode = typeof explanationWarnings[number];

export type ExplanationContext = {
  classification: ExplanationClassification;
  confidence: typeof explanationConfidences[number];
  condition: typeof explanationConditions[number];
  transaction_type: typeof explanationTransactions[number];
  factor_codes: ExplanationFactorCode[];
  warning_codes: ExplanationWarningCode[];
  evidence_band: "INSUFFICIENT" | "SINGLE" | "LIMITED" | "MULTIPLE";
  core_context: "NONE" | "REFUNDABLE" | "FORFEITED" | "UNCLEAR" | "NOT_APPLICABLE";
  aog_context: "AOG" | "ROUTINE" | "UNKNOWN";
  documentation_context: "MATCHED" | "MIXED" | "NOT_SPECIFIED";
  warranty_context: "MATCHED" | "MIXED" | "NOT_SPECIFIED";
  part_relationship_used: boolean;
};

export type ExplanationDraft = {
  classification: ExplanationClassification;
  summary: string;
  explanation: string;
  factor_explanations: Array<{ factor_code: ExplanationFactorCode; text: string }>;
  limitations: Array<{ limitation_code: ExplanationWarningCode; text: string }>;
  review_required: true;
};

const text = { type: "string", minLength: 1, maxLength: 600 } as const;
export const explanationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["classification", "summary", "explanation", "factor_explanations", "limitations", "review_required"],
  properties: {
    classification: { type: "string", enum: explanationClassifications },
    summary: { type: "string", minLength: 20, maxLength: 220 },
    explanation: { type: "string", minLength: 20, maxLength: 800 },
    factor_explanations: {
      type: "array", maxItems: explanationFactors.length,
      items: { type: "object", additionalProperties: false, required: ["factor_code", "text"], properties: { factor_code: { type: "string", enum: explanationFactors }, text } },
    },
    limitations: {
      type: "array", maxItems: explanationWarnings.length,
      items: { type: "object", additionalProperties: false, required: ["limitation_code", "text"], properties: { limitation_code: { type: "string", enum: explanationWarnings }, text } },
    },
    review_required: { type: "boolean", const: true },
  },
} as const;

function object(value: unknown, code: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function bounded(value: unknown, minimum: number, maximum: number, code: string) {
  if (typeof value !== "string") throw new Error(code);
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length < minimum || clean.length > maximum) throw new Error(code);
  return clean;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], code: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in value))) throw new Error(code);
}

function sentences(value: string) {
  return value.split(/(?<=[.!?])\s+/).filter(Boolean).length;
}

const prohibited = [
  /fair\s+market\s+value/i, /true\s+market\s+value/i, /certified\s+value/i,
  /\bappraisal\b/i, /\bovercharg(?:e|ed|ing)\b/i, /\byou\s+overpaid\b/i,
  /\bbad\s+deal\b/i, /\bripoff\b/i, /supplier\s+(?:cost|margin|profit)/i,
  /comprehensive\s+market/i, /significantly\s+above/i,
  /https?:\/\//i, /www\./i, /\b[A-Z0-9.-]+\.(?:com|net|org)\b/i,
  /[\u0024\u20ac\u00a3\u00a5]/, /\b(?:USD|EUR|GBP|CAD|AUD|CHF|JPY)\b/, /%|\bpercent(?:age)?\b/i,
  /\d/, /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|first|second|third)\b/i,
  /\b(?:click|call|contact|submit|purchase|buy|sell)\b/i,
];

function validateLanguage(draft: ExplanationDraft) {
  const customerText = [draft.summary, draft.explanation, ...draft.factor_explanations.map((item) => item.text), ...draft.limitations.map((item) => item.text)].join(" ");
  if (prohibited.some((pattern) => pattern.test(customerText))) throw new Error("EXPLANATION_PROHIBITED_LANGUAGE");
  const primary = `${draft.summary} ${draft.explanation}`;
  const sentenceCount = sentences(primary);
  if (sentenceCount < 2 || sentenceCount > 4) throw new Error("EXPLANATION_SENTENCE_COUNT_INVALID");
  const expectedPhrase: Record<ExplanationClassification, RegExp> = {
    BELOW_OBSERVED_RANGE: /below (?:the )?observed comparable range/i,
    WITHIN_OBSERVED_RANGE: /within (?:the )?observed comparable range/i,
    ABOVE_OBSERVED_RANGE: /above (?:the )?observed comparable range/i,
    INSUFFICIENT_DATA: /(?:insufficient comparable evidence|did not have sufficient comparable evidence)/i,
  };
  if (!expectedPhrase[draft.classification].test(primary)) throw new Error("EXPLANATION_CLASSIFICATION_LANGUAGE_MISSING");
  const conflicting = explanationClassifications.filter((classification) => classification !== draft.classification && expectedPhrase[classification].test(primary));
  if (conflicting.length) throw new Error("EXPLANATION_CLASSIFICATION_CONTRADICTION");
}

export function validateExplanationDraft(value: unknown, context: ExplanationContext): ExplanationDraft {
  const root = object(value, "EXPLANATION_SCHEMA_INVALID");
  exactKeys(root, ["classification", "summary", "explanation", "factor_explanations", "limitations", "review_required"], "EXPLANATION_SCHEMA_INVALID");
  if (!explanationClassifications.includes(root.classification as ExplanationClassification) || root.classification !== context.classification) throw new Error("EXPLANATION_CLASSIFICATION_CONTRADICTION");
  if (root.review_required !== true) throw new Error("EXPLANATION_REVIEW_REQUIRED");
  if (!Array.isArray(root.factor_explanations) || !Array.isArray(root.limitations)) throw new Error("EXPLANATION_SCHEMA_INVALID");

  const factors = root.factor_explanations.map((candidate) => {
    const item = object(candidate, "EXPLANATION_SCHEMA_INVALID");
    exactKeys(item, ["factor_code", "text"], "EXPLANATION_SCHEMA_INVALID");
    if (!context.factor_codes.includes(item.factor_code as ExplanationFactorCode)) throw new Error("EXPLANATION_UNSUPPORTED_FACTOR");
    return { factor_code: item.factor_code as ExplanationFactorCode, text: bounded(item.text, 10, 600, "EXPLANATION_FACTOR_TEXT_INVALID") };
  });
  if (new Set(factors.map((item) => item.factor_code)).size !== factors.length || factors.length !== context.factor_codes.length || context.factor_codes.some((code) => !factors.some((item) => item.factor_code === code))) throw new Error("EXPLANATION_FACTOR_FIDELITY_FAILED");

  const limitations = root.limitations.map((candidate) => {
    const item = object(candidate, "EXPLANATION_SCHEMA_INVALID");
    exactKeys(item, ["limitation_code", "text"], "EXPLANATION_SCHEMA_INVALID");
    if (!context.warning_codes.includes(item.limitation_code as ExplanationWarningCode)) throw new Error("EXPLANATION_UNSUPPORTED_LIMITATION");
    return { limitation_code: item.limitation_code as ExplanationWarningCode, text: bounded(item.text, 10, 600, "EXPLANATION_LIMITATION_TEXT_INVALID") };
  });
  if (new Set(limitations.map((item) => item.limitation_code)).size !== limitations.length || limitations.length !== context.warning_codes.length || context.warning_codes.some((code) => !limitations.some((item) => item.limitation_code === code))) throw new Error("EXPLANATION_LIMITATION_FIDELITY_FAILED");

  const draft: ExplanationDraft = {
    classification: root.classification as ExplanationClassification,
    summary: bounded(root.summary, 20, 220, "EXPLANATION_SUMMARY_INVALID"),
    explanation: bounded(root.explanation, 20, 800, "EXPLANATION_TEXT_INVALID"),
    factor_explanations: factors,
    limitations,
    review_required: true,
  };
  validateLanguage(draft);
  return draft;
}

export function draftToHumanExplanation(draft: ExplanationDraft) {
  return `${draft.summary} ${draft.explanation}`.trim();
}
