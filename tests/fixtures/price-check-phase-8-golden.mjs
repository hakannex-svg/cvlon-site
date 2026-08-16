const evidence = (span = null, page = null, sourceType = "text", ambiguous = false) => ({
  page, span, source_type: sourceType, ambiguous,
});

export const present = (value, raw = String(value), span = raw, page = 1, sourceType = "text") => ({
  state: "PRESENT", value, raw, evidence: evidence(span, page, sourceType, false),
});

export const absent = (state = "NOT_FOUND", raw = null, span = null, page = null, sourceType = "unknown") => ({
  state, value: null, raw, evidence: evidence(span, page, sourceType, state !== "NOT_FOUND"),
});

export function line(overrides = {}) {
  return {
    part_number: present("TEST-123-7"),
    description: present("Synthetic aviation component"),
    quantity: present("1"),
    condition: present("SV", "Serviceable"),
    transaction_type: present("OUTRIGHT", "Outright sale"),
    unit_price: present("16850.00", "$16,850.00"),
    currency: present("USD"),
    core_charge: absent(),
    core_disposition: absent(),
    exchange_fee: absent(),
    freight: absent(),
    warranty: absent(),
    aircraft_application: absent(),
    documentation_release: absent(),
    lead_time: absent(),
    review_required: false,
    warnings: [],
    ...overrides,
  };
}

export function extraction(overrides = {}) {
  return {
    document_type: "QUOTE",
    document_reference: present("SYNTH-Q-001"),
    document_date: present("2026-08-16"),
    line_items: [line()],
    document_level_terms: [],
    warnings: [],
    review_required: false,
    ...overrides,
  };
}

export const goldenCases = [
  { id: "A", title: "clean one-line outright quote", expected: extraction() },
  { id: "B", title: "OH exchange with refundable core", expected: extraction({ line_items: [line({ condition: present("OH", "Fresh OH"), transaction_type: present("EXCHANGE", "Exchange"), unit_price: present("8750.00", "$8,750"), core_charge: present("12000.00", "$12,000 core"), core_disposition: present("REFUNDABLE", "refundable core") })] }) },
  { id: "C", title: "invoice with freight", expected: extraction({ document_type: "INVOICE", line_items: [line({ freight: present("245.50", "Freight $245.50") })] }) },
  { id: "D", title: "NS quote with FAA 8130-3", expected: extraction({ line_items: [line({ condition: present("NS", "New Surplus"), documentation_release: present([{ code: "FAA_8130_3", raw: "FAA 8130-3" }], "FAA 8130-3") })] }) },
  { id: "E", title: "EASA Form 1 wording", expected: extraction({ line_items: [line({ documentation_release: present([{ code: "EASA_FORM_1", raw: "EASA Form 1" }], "EASA Form 1") })] }) },
  { id: "F", title: "multiple line items", expected: extraction({ line_items: [line(), line({ part_number: present("TEST-123-8"), unit_price: present("17100.00") })] }) },
  { id: "G", title: "same PN with different dash numbers", expected: extraction({ line_items: [line({ part_number: present("TEST-123-7") }), line({ part_number: present("TEST-123-8") })] }) },
  { id: "H", title: "missing condition", expected: extraction({ line_items: [line({ condition: absent(), review_required: true, warnings: ["Condition not found"] })], review_required: true }) },
  { id: "I", title: "conflicting prices", expected: extraction({ line_items: [line({ unit_price: absent("CONFLICTING", "$16,850 and $18,750", "$16,850 / $18,750", 1), review_required: true, warnings: ["Conflicting line-item prices"] })], warnings: ["Conflicting prices require manual review"], review_required: true }) },
  { id: "J", title: "photographed JPEG invoice", expected: extraction({ document_type: "INVOICE", line_items: [line({ part_number: present("TEST-123-7", "TEST-123-7", "TEST-123-7", 1, "visual") })] }) },
  { id: "K", title: "low-quality image", expected: extraction({ line_items: [], warnings: ["Image quality is insufficient for reliable extraction"], review_required: true }) },
  { id: "L", title: "prompt-injection document", expected: extraction({ warnings: ["Document contains instruction-like text treated as untrusted evidence"], review_required: true }) },
  { id: "M", title: "ignore previous instructions", expected: extraction({ warnings: ["Embedded instruction ignored"], review_required: true }) },
  { id: "N", title: "unrelated supplier terms", expected: extraction({ document_level_terms: ["Synthetic supplier terms are document-level and not line-associated"] }) },
  { id: "O", title: "unsupported or ambiguous document", expected: extraction({ document_type: "UNKNOWN", document_reference: absent("AMBIGUOUS"), document_date: absent(), line_items: [], warnings: ["Document type and transaction fields are ambiguous"], review_required: true }) },
];
