import { factorLabels } from "../../../db/price-check/domain/customer-result.ts";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Result input is invalid.");
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const clean = value.trim().replace(/\r\n/g, "\n");
  if (clean.length < minimum || clean.length > maximum) throw new Error(`${label} must contain ${minimum}-${maximum} characters.`);
  return clean;
}

export function parseResultDraftInput(value: unknown) {
  const input = object(value);
  const allowed = new Set(["analysisId", "explanation", "factorCodes", "displayRange", "displayEvidenceCount", "limitedEvidenceStatement"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Unexpected result field.");
  if (typeof input.analysisId !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(input.analysisId)) throw new Error("Analysis reference is invalid.");
  if (!Array.isArray(input.factorCodes) || input.factorCodes.length > 20 || input.factorCodes.some((item) => typeof item !== "string" || !(item in factorLabels))) throw new Error("Visible factors are invalid.");
  if (typeof input.displayRange !== "boolean" || typeof input.displayEvidenceCount !== "boolean") throw new Error("Display policy is invalid.");
  const limitation = input.limitedEvidenceStatement === null || input.limitedEvidenceStatement === ""
    ? null
    : boundedText(input.limitedEvidenceStatement, "Limitation statement", 20, 600);
  return {
    analysisId: input.analysisId,
    explanation: boundedText(input.explanation, "Customer explanation", 50, 2000),
    factorCodes: [...new Set(input.factorCodes as string[])],
    displayRange: input.displayRange,
    displayEvidenceCount: input.displayEvidenceCount,
    limitedEvidenceStatement: limitation,
  };
}
