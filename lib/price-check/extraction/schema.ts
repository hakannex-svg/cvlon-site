import "../../../db/price-check/server-boundary.ts";

export const EXTRACTION_SCHEMA_VERSION = "phase8-v1";
export const EXTRACTION_PROMPT_VERSION = "phase8-v1";
export const EXTRACTION_DATA_POLICY_VERSION = "phase8-minimum-document-only-v1";
export const MAX_EXTRACTION_LINE_ITEMS = 25;

export const presenceStates = ["PRESENT", "NOT_FOUND", "AMBIGUOUS", "CONFLICTING"] as const;
export const conditionCodes = ["NE", "NS", "OH", "SV", "AR", "UNKNOWN"] as const;
export const transactionTypes = ["OUTRIGHT", "EXCHANGE", "REPAIR", "UNKNOWN"] as const;
export const documentationCodes = [
  "FAA_8130_3", "EASA_FORM_1", "DUAL_RELEASE", "OEM_MANUFACTURER_COC",
  "MATERIAL_CERTIFICATION", "REMOVAL_RECORDS", "TEARDOWN_EVALUATION_REPORT",
  "TEST_REPORT", "OTHER", "UNKNOWN",
] as const;

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["page", "span", "source_type", "ambiguous"],
  properties: {
    page: { type: ["integer", "null"], minimum: 1 },
    span: { type: ["string", "null"], maxLength: 240 },
    source_type: { type: "string", enum: ["text", "visual", "both", "unknown"] },
    ambiguous: { type: "boolean" },
  },
} as const;

function materialField(value: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["state", "value", "raw", "evidence"],
    properties: {
      state: { type: "string", enum: presenceStates },
      value,
      raw: { type: ["string", "null"], maxLength: 400 },
      evidence: evidenceSchema,
    },
  } as const;
}

const nullableString = { type: ["string", "null"], maxLength: 400 };
const nullableDecimal = { type: ["string", "null"], pattern: "^(0|[1-9][0-9]*)(\\.[0-9]{1,4})?$", maxLength: 40 };

export const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["document_type", "document_reference", "document_date", "line_items", "document_level_terms", "warnings", "review_required"],
  properties: {
    document_type: { type: "string", enum: ["QUOTE", "INVOICE", "PURCHASE_ORDER", "OTHER", "UNKNOWN"] },
    document_reference: materialField(nullableString),
    document_date: materialField({ type: ["string", "null"], pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
    line_items: {
      type: "array",
      maxItems: MAX_EXTRACTION_LINE_ITEMS,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "part_number", "description", "quantity", "condition", "transaction_type",
          "unit_price", "currency", "core_charge", "core_disposition", "exchange_fee",
          "freight", "warranty", "aircraft_application", "documentation_release",
          "lead_time", "review_required", "warnings",
        ],
        properties: {
          part_number: materialField(nullableString),
          description: materialField(nullableString),
          quantity: materialField(nullableDecimal),
          condition: materialField({ type: ["string", "null"], enum: [...conditionCodes, null] }),
          transaction_type: materialField({ type: ["string", "null"], enum: [...transactionTypes, null] }),
          unit_price: materialField(nullableDecimal),
          currency: materialField({ type: ["string", "null"], maxLength: 7 }),
          core_charge: materialField(nullableDecimal),
          core_disposition: materialField({ type: ["string", "null"], enum: ["REFUNDABLE", "FORFEITED", "UNCLEAR", "NOT_APPLICABLE", null] }),
          exchange_fee: materialField(nullableDecimal),
          freight: materialField(nullableDecimal),
          warranty: materialField(nullableString),
          aircraft_application: materialField(nullableString),
          documentation_release: materialField({
            type: ["array", "null"],
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["code", "raw"],
              properties: {
                code: { type: "string", enum: documentationCodes },
                raw: { type: "string", maxLength: 240 },
              },
            },
          }),
          lead_time: materialField(nullableString),
          review_required: { type: "boolean" },
          warnings: { type: "array", maxItems: 20, items: { type: "string", maxLength: 240 } },
        },
      },
    },
    document_level_terms: { type: "array", maxItems: 20, items: { type: "string", maxLength: 240 } },
    warnings: { type: "array", maxItems: 50, items: { type: "string", maxLength: 240 } },
    review_required: { type: "boolean" },
  },
} as const;

export type PresenceState = typeof presenceStates[number];
export type Evidence = { page: number | null; span: string | null; source_type: "text" | "visual" | "both" | "unknown"; ambiguous: boolean };
export type MaterialField<T> = { state: PresenceState; value: T | null; raw: string | null; evidence: Evidence };
export type ExtractionLineItem = {
  part_number: MaterialField<string>;
  description: MaterialField<string>;
  quantity: MaterialField<string>;
  condition: MaterialField<typeof conditionCodes[number]>;
  transaction_type: MaterialField<typeof transactionTypes[number]>;
  unit_price: MaterialField<string>;
  currency: MaterialField<string>;
  core_charge: MaterialField<string>;
  core_disposition: MaterialField<"REFUNDABLE" | "FORFEITED" | "UNCLEAR" | "NOT_APPLICABLE">;
  exchange_fee: MaterialField<string>;
  freight: MaterialField<string>;
  warranty: MaterialField<string>;
  aircraft_application: MaterialField<string>;
  documentation_release: MaterialField<Array<{ code: typeof documentationCodes[number]; raw: string }>>;
  lead_time: MaterialField<string>;
  review_required: boolean;
  warnings: string[];
};
export type DocumentExtraction = {
  document_type: "QUOTE" | "INVOICE" | "PURCHASE_ORDER" | "OTHER" | "UNKNOWN";
  document_reference: MaterialField<string>;
  document_date: MaterialField<string>;
  line_items: ExtractionLineItem[];
  document_level_terms: string[];
  warnings: string[];
  review_required: boolean;
};

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const decimal = /^(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/;

function validateEvidence(value: unknown) {
  if (!isObject(value) || !exactKeys(value, ["page", "span", "source_type", "ambiguous"])) return false;
  return (value.page === null || (Number.isInteger(value.page) && Number(value.page) >= 1))
    && (value.span === null || (typeof value.span === "string" && value.span.length <= 240))
    && ["text", "visual", "both", "unknown"].includes(String(value.source_type))
    && typeof value.ambiguous === "boolean";
}

function validateField(value: unknown, validateValue: (candidate: unknown) => boolean) {
  if (!isObject(value) || !exactKeys(value, ["state", "value", "raw", "evidence"])) return false;
  if (!presenceStates.includes(value.state as PresenceState)) return false;
  if (value.raw !== null && (typeof value.raw !== "string" || value.raw.length > 400)) return false;
  if (!validateEvidence(value.evidence)) return false;
  if (value.state === "PRESENT" && value.value === null) return false;
  if (value.state === "NOT_FOUND" && value.value !== null) return false;
  return value.value === null || validateValue(value.value);
}

function validateLineItem(value: unknown) {
  const keys = ["part_number", "description", "quantity", "condition", "transaction_type", "unit_price", "currency", "core_charge", "core_disposition", "exchange_fee", "freight", "warranty", "aircraft_application", "documentation_release", "lead_time", "review_required", "warnings"];
  if (!isObject(value) || !exactKeys(value, keys)) return false;
  const stringValue = (candidate: unknown) => typeof candidate === "string" && candidate.length <= 400;
  const decimalValue = (candidate: unknown) => typeof candidate === "string" && decimal.test(candidate);
  const fieldsOk = validateField(value.part_number, stringValue)
    && validateField(value.description, stringValue)
    && validateField(value.quantity, decimalValue)
    && validateField(value.condition, (candidate) => conditionCodes.includes(candidate as never))
    && validateField(value.transaction_type, (candidate) => transactionTypes.includes(candidate as never))
    && validateField(value.unit_price, decimalValue)
    && validateField(value.currency, (candidate) => typeof candidate === "string" && (candidate === "UNKNOWN" || /^[A-Z]{3}$/.test(candidate)))
    && validateField(value.core_charge, decimalValue)
    && validateField(value.core_disposition, (candidate) => ["REFUNDABLE", "FORFEITED", "UNCLEAR", "NOT_APPLICABLE"].includes(String(candidate)))
    && validateField(value.exchange_fee, decimalValue)
    && validateField(value.freight, decimalValue)
    && validateField(value.warranty, stringValue)
    && validateField(value.aircraft_application, stringValue)
    && validateField(value.documentation_release, (candidate) => Array.isArray(candidate) && candidate.length <= 12 && candidate.every((item) => isObject(item) && exactKeys(item, ["code", "raw"]) && documentationCodes.includes(item.code as never) && typeof item.raw === "string" && item.raw.length <= 240))
    && validateField(value.lead_time, stringValue);
  return fieldsOk && typeof value.review_required === "boolean" && Array.isArray(value.warnings)
    && value.warnings.length <= 20 && value.warnings.every((item) => typeof item === "string" && item.length <= 240);
}

export function validateDocumentExtraction(value: unknown): DocumentExtraction {
  const keys = ["document_type", "document_reference", "document_date", "line_items", "document_level_terms", "warnings", "review_required"];
  if (!isObject(value) || !exactKeys(value, keys)) throw new Error("EXTRACTION_SCHEMA_INVALID");
  if (!["QUOTE", "INVOICE", "PURCHASE_ORDER", "OTHER", "UNKNOWN"].includes(String(value.document_type))) throw new Error("EXTRACTION_SCHEMA_INVALID");
  if (!validateField(value.document_reference, (candidate) => typeof candidate === "string" && candidate.length <= 400)) throw new Error("EXTRACTION_SCHEMA_INVALID");
  if (!validateField(value.document_date, (candidate) => typeof candidate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate))) throw new Error("EXTRACTION_SCHEMA_INVALID");
  if (!Array.isArray(value.line_items) || value.line_items.length > MAX_EXTRACTION_LINE_ITEMS || !value.line_items.every(validateLineItem)) throw new Error("EXTRACTION_SCHEMA_INVALID");
  for (const key of ["document_level_terms", "warnings"] as const) {
    const limit = key === "warnings" ? 50 : 20;
    if (!Array.isArray(value[key]) || value[key].length > limit || !value[key].every((item) => typeof item === "string" && item.length <= 240)) throw new Error("EXTRACTION_SCHEMA_INVALID");
  }
  if (typeof value.review_required !== "boolean") throw new Error("EXTRACTION_SCHEMA_INVALID");
  return value as DocumentExtraction;
}
