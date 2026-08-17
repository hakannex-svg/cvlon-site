const base = {
  classification: "WITHIN_OBSERVED_RANGE",
  confidence: "HIGH",
  condition: "SV",
  transaction_type: "OUTRIGHT",
  factor_codes: [],
  warning_codes: [],
  evidence_band: "MULTIPLE",
  core_context: "NOT_APPLICABLE",
  aog_context: "ROUTINE",
  documentation_context: "MATCHED",
  warranty_context: "MATCHED",
  part_relationship_used: false,
};

const factorText = {
  CONDITION: "Condition was considered when comparing the available evidence.",
  TRANSACTION_TYPE: "Transaction structure was considered when comparing the available evidence.",
  CORE_TERMS: "Core terms were considered when comparing the available evidence.",
  DOCUMENTATION: "Documentation requirements were considered in the comparison.",
  WARRANTY: "Warranty terms were considered in the comparison.",
  AOG: "Aircraft on ground context was considered in the comparison.",
  RELATED_PART: "Governed related part evidence was used in the comparison.",
  QUANTITY: "Quantity context was considered in the comparison.",
};

const limitationText = {
  INSUFFICIENT_DATA: "Comparable evidence was insufficient for a pricing conclusion.",
  LIMITED_EVIDENCE: "Available comparable evidence was limited.",
  SINGLE_OBSERVATION: "Available comparable evidence came from a single observation.",
  RELATED_PART_EVIDENCE: "Governed related part evidence limits direct comparability.",
  MIXED_DOCUMENTATION: "Documentation differed across the available evidence.",
  OLD_EVIDENCE: "Some available evidence was older and may be less comparable.",
  MIXED_CONDITION: "Condition differed across the available evidence.",
  MIXED_TRANSACTION_TYPE: "Transaction structures differed across the available evidence.",
  MIXED_CORE_TERMS: "Core terms differed across the available evidence.",
  MIXED_WARRANTY: "Warranty terms differed across the available evidence.",
  MIXED_AOG_CONTEXT: "Urgency context differed across the available evidence.",
  CURRENCY_NORMALIZATION_REQUIRED: "Currency normalization was required before comparison.",
};

export function context(overrides = {}) {
  return { ...base, ...overrides };
}

export function draftFor(value) {
  const primary = {
    WITHIN_OBSERVED_RANGE: [
      "This transaction is within the observed comparable range.",
      "The reviewed structured factors provide context for the comparison.",
    ],
    ABOVE_OBSERVED_RANGE: [
      "This transaction is above the observed comparable range.",
      "The reviewed structured factors provide context for the comparison.",
    ],
    BELOW_OBSERVED_RANGE: [
      "This transaction is below the observed comparable range.",
      "The reviewed structured factors provide context for the comparison.",
    ],
    INSUFFICIENT_DATA: [
      "Civilon did not have sufficient comparable evidence for this review.",
      "Additional market evidence may be needed before drawing a pricing conclusion.",
    ],
  }[value.classification];
  return {
    classification: value.classification,
    summary: primary[0],
    explanation: primary[1],
    factor_explanations: value.factor_codes.map((factor_code) => ({ factor_code, text: factorText[factor_code] })),
    limitations: value.warning_codes.map((limitation_code) => ({ limitation_code, text: limitationText[limitation_code] })),
    review_required: true,
  };
}

export const goldenCases = [
  { id: "A", title: "within range and high confidence", context: context() },
  { id: "B", title: "above range and high confidence", context: context({ classification: "ABOVE_OBSERVED_RANGE" }) },
  { id: "C", title: "below range", context: context({ classification: "BELOW_OBSERVED_RANGE", confidence: "MEDIUM" }) },
  { id: "D", title: "limited evidence", context: context({ confidence: "LOW", evidence_band: "LIMITED", warning_codes: ["LIMITED_EVIDENCE"] }) },
  { id: "E", title: "single observation", context: context({ confidence: "LOW", evidence_band: "SINGLE", warning_codes: ["SINGLE_OBSERVATION"] }) },
  { id: "F", title: "insufficient data", context: context({ classification: "INSUFFICIENT_DATA", confidence: "INSUFFICIENT_DATA", evidence_band: "INSUFFICIENT", warning_codes: ["INSUFFICIENT_DATA"] }) },
  { id: "G", title: "overhauled exchange with refundable core", context: context({ condition: "OH", transaction_type: "EXCHANGE", core_context: "REFUNDABLE", factor_codes: ["CONDITION", "TRANSACTION_TYPE", "CORE_TERMS"] }) },
  { id: "H", title: "aircraft on ground context", context: context({ aog_context: "AOG", factor_codes: ["AOG"] }) },
  { id: "I", title: "documentation mismatch", context: context({ documentation_context: "MIXED", factor_codes: ["DOCUMENTATION"], warning_codes: ["MIXED_DOCUMENTATION"] }) },
  { id: "J", title: "warranty difference", context: context({ warranty_context: "MIXED", factor_codes: ["WARRANTY"], warning_codes: ["MIXED_WARRANTY"] }) },
  { id: "K", title: "old evidence", context: context({ warning_codes: ["OLD_EVIDENCE"] }) },
  { id: "L", title: "governed related part used", context: context({ part_relationship_used: true, factor_codes: ["RELATED_PART"], warning_codes: ["RELATED_PART_EVIDENCE"] }) },
  { id: "M", title: "mixed condition warning", context: context({ factor_codes: ["CONDITION"], warning_codes: ["MIXED_CONDITION"] }) },
  { id: "N", title: "core unclear", context: context({ transaction_type: "EXCHANGE", core_context: "UNCLEAR", factor_codes: ["CORE_TERMS"], warning_codes: ["MIXED_CORE_TERMS"] }) },
  { id: "O", title: "adversarial source string cannot enter enum context", context: context({ confidence: "LOW", warning_codes: ["LIMITED_EVIDENCE"] }) },
].map((scenario) => ({ ...scenario, expected: draftFor(scenario.context) }));
