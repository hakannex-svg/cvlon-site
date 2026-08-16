import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deterministicComparableAnalysis } from "../db/price-check/domain/comparable-analysis.ts";
import { parseAnalysisInput, parseObservationInput, parseRelationshipInput } from "../lib/price-check/admin/analysis-validation.ts";
import { allowedOperationalStatuses, roleCan } from "../lib/price-check/admin/policy.ts";

const transaction = {
  normalizedPartNumber: "TESTSV100",
  conditionCode: "SV",
  transactionType: "outright",
  quantity: "1.000",
  unitPrice: "1175.00",
  currencyCode: "USD",
  coreCharge: null,
  coreDisposition: "NOT_APPLICABLE",
  exchangeFee: null,
  freight: null,
  warrantyValue: "12.00",
  warrantyUnit: "MONTHS",
  warrantyText: null,
  documentationCodes: ["FAA_8130_3"],
  aog: false,
  transactionDate: "2026-08-01",
  aircraftModel: "Synthetic aircraft",
};

function observation(id, price, overrides = {}) {
  return {
    id,
    normalizedPartNumber: "TESTSV100",
    relationshipType: "EXACT",
    conditionCode: "SV",
    transactionType: "outright",
    quantity: "1.000",
    unitPrice: price,
    currencyCode: "USD",
    coreCharge: null,
    coreDisposition: "NOT_APPLICABLE",
    exchangeFee: null,
    freight: null,
    observationDate: "2026-07-01",
    warrantyValue: "12.00",
    warrantyUnit: "MONTHS",
    warrantyText: null,
    documentationCodes: ["FAA_8130_3"],
    aog: false,
    sourceReliability: "HIGH",
    ...overrides,
  };
}

function analyze(selected, confidence = selected.length ? "MEDIUM" : "INSUFFICIENT_DATA") {
  return deterministicComparableAnalysis({ transaction, selected, confidence, confidenceReason: selected.length ? "Synthetic fixture evidence reviewed." : "", today: "2026-08-16" });
}

test("deterministic range uses exact fixed-precision minimum, odd median, maximum, mean, difference, and position", () => {
  const result = analyze(["900.00", "1000.00", "1100.00", "1200.00", "1300.00"].map((price, index) => observation(`O${index}`, price)));
  assert.equal(result.payload.observedComparableLow, "900.0000");
  assert.equal(result.payload.observedComparableMedian, "1100.0000");
  assert.equal(result.payload.observedComparableHigh, "1300.0000");
  assert.equal(result.payload.arithmeticMean, "1100.0000");
  assert.equal(result.payload.differenceFromMedian, "75.0000");
  assert.equal(result.payload.percentageDifferenceFromMedian, "6.8182");
  assert.equal(result.payload.pricePosition, "WITHIN_OBSERVED_RANGE");
});
test("even median preserves a half-cent without JavaScript floating point", () => {
  const result = analyze([observation("A", "10.00"), observation("B", "10.01")]);
  assert.equal(result.payload.observedComparableMedian, "10.0050");
  assert.equal(result.payload.arithmeticMean, "10.0050");
  assert.ok(result.payload.insufficiencyReasons.includes("LIMITED_EVIDENCE"));
});

test("sparse evidence flags zero and one observation without representing a one-row market range", () => {
  const empty = analyze([]);
  assert.deepEqual(empty.payload.insufficiencyReasons, ["INSUFFICIENT_DATA"]);
  assert.equal(empty.payload.observedComparableLow, null);
  assert.equal(empty.payload.pricePosition, "INSUFFICIENT_DATA");
  const single = analyze([observation("A", "1000.00")], "LOW");
  assert.ok(single.payload.insufficiencyReasons.includes("SINGLE_OBSERVATION"));
  assert.equal(single.payload.descriptiveMedian, "1000.0000");
  assert.equal(single.payload.observedComparableMedian, null);
});

test("mixed currency blocks a single aggregate and compatibility differences create warnings only", () => {
  const result = analyze([
    observation("USD", "1000.00"),
    observation("EUR", "900.00", { currencyCode: "EUR", conditionCode: "OH", transactionType: "exchange", aog: true, observationDate: "2022-01-01", quantity: "3.000" }),
  ]);
  assert.equal(result.payload.observedComparableLow, null);
  assert.ok(result.payload.insufficiencyReasons.includes("CURRENCY_NORMALIZATION_REQUIRED"));
  for (const warning of ["CURRENCY_MIXED", "CONDITION_MIXED", "TRANSACTION_TYPE_MIXED", "AOG_CONTEXT_MIXED", "OLD_EVIDENCE", "QUANTITY_VARIANCE"]) assert.ok(result.payload.warnings.includes(warning));
});

test("exchange refundable core remains exposure while forfeited core gets a separately labeled economic-cost calculation", () => {
  const exchangeTransaction = { ...transaction, conditionCode: "OH", transactionType: "exchange", coreCharge: "2500.00", coreDisposition: "REFUNDABLE", exchangeFee: "200.00", freight: "75.00" };
  const selected = [
    observation("REF", "4500.00", { conditionCode: "OH", transactionType: "exchange", coreCharge: "2500.00", coreDisposition: "REFUNDABLE", exchangeFee: "200.00", freight: "75.00" }),
    observation("FOR", "4600.00", { conditionCode: "OH", transactionType: "exchange", coreCharge: "2000.00", coreDisposition: "FORFEITED", exchangeFee: "150.00", freight: "50.00" }),
  ];
  const result = deterministicComparableAnalysis({ transaction: exchangeTransaction, selected, confidence: "LOW", confidenceReason: "Core terms differ and were reviewed.", today: "2026-08-16" });
  assert.equal(result.payload.forfeitedCoreTotals.length, 1);
  assert.equal(result.payload.forfeitedCoreTotals[0].knownEconomicCost, "6800.0000");
  assert.equal(result.payload.forfeitedCoreTotals[0].observationId, "FOR");
  assert.ok(result.payload.warnings.includes("CORE_TERMS_MIXED"));
});

test("price position supports below, within, and above without an invented significant threshold", () => {
  const selected = [observation("A", "1000.00"), observation("B", "1200.00")];
  assert.equal(analyze(selected).payload.pricePosition, "WITHIN_OBSERVED_RANGE");
  assert.equal(deterministicComparableAnalysis({ transaction: { ...transaction, unitPrice: "900.00" }, selected, confidence: "MEDIUM", confidenceReason: "Fixture", today: "2026-08-16" }).payload.pricePosition, "BELOW_OBSERVED_RANGE");
  assert.equal(deterministicComparableAnalysis({ transaction: { ...transaction, unitPrice: "1300.00" }, selected, confidence: "MEDIUM", confidenceReason: "Fixture", today: "2026-08-16" }).payload.pricePosition, "ABOVE_OBSERVED_RANGE");
});

test("analysis and governance inputs are strict and reject forged calculations or arbitrary fields", () => {
  const decisions = [{ observationId: "01M04ETN9R2XV8P2G73NH625EM", included: true, reasonCode: "EXACT_MATCH", analystNote: "Reviewed" }];
  assert.equal(parseAnalysisInput({ decisions, confidence: "MEDIUM", confidenceReason: "Reviewed evidence." }).decisions.length, 1);
  assert.throws(() => parseAnalysisInput({ decisions, confidence: "MEDIUM", confidenceReason: "Reviewed", marketLow: "1.00" }), /Unexpected field/);
  assert.throws(() => parseAnalysisInput({ decisions: [{ ...decisions[0], reasonCode: "DROP TABLE price_observations" }], confidence: "MEDIUM", confidenceReason: "Reviewed" }), /invalid/);
  assert.throws(() => parseRelationshipInput({ fromPartNumber: "A", toPartNumber: "A", relationshipType: "INTERCHANGEABLE", sourceProvenance: "Fixture", verificationState: "VERIFIED", effectiveFrom: "", effectiveTo: "", notes: "" }), /different part numbers/);
});

test("observation input uses controlled schema and analyst RBAC cannot manage relationships", () => {
  const parsed = parseObservationInput({ provenanceType: "ANALYST_OBSERVATION", internalSourceReference: "SYNTHETIC", originalPartNumber: "TEST-SV-100", conditionCode: "SV", transactionType: "outright", quantity: "1", unitPrice: "1000", currencyCode: "USD", coreCharge: "", coreDisposition: "", exchangeFee: "", freight: "", observationDate: "2026-08-01", warrantyValue: "", warrantyUnit: "", warrantyText: "", aog: false, aircraftApplication: "", regionContext: "", sourceReliability: "HIGH", verificationState: "VERIFIED", permittedUseState: "INTERNAL_ANALYSIS", documentationCodes: ["FAA_8130_3"] });
  assert.equal(parsed.normalizedPartNumber, "TESTSV100");
  assert.equal(roleCan("ANALYST", "analyze"), true);
  assert.equal(roleCan("ANALYST", "create_observation"), true);
  assert.equal(roleCan("ANALYST", "manage_relationships"), false);
  assert.equal(roleCan("AUDITOR", "analyze"), false);
  assert.ok(allowedOperationalStatuses("ADMIN").includes("analysis_ready"));
});

test("Phase 5 source contains no OpenAI, result delivery, or browser-supplied aggregate path", async () => {
  const sources = await Promise.all([
    readFile("db/price-check/domain/comparable-analysis.ts", "utf8"),
    readFile("db/price-check/repositories/comparable-repository.ts", "utf8"),
    readFile("app/api/admin/price-checks/[id]/analysis/route.ts", "utf8"),
    readFile("components/admin/AdminComparableWorkspace.tsx", "utf8"),
  ]);
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /openai|chatgpt|result token|sendgrid|resend/i);
  assert.doesNotMatch(joined, /marketLow:\s*input|marketMedian:\s*input|marketHigh:\s*input/);
});

test("synthetic seed controls are unreachable outside the exact Phase 5 Deploy Preview", async () => {
  const [route, queue] = await Promise.all([
    readFile("app/api/admin/phase-5/seed/route.ts", "utf8"),
    readFile("app/admin/price-checks/page.tsx", "utf8"),
  ]);
  for (const source of [route, queue]) {
    assert.match(source, /CONTEXT\s*===\s*"deploy-preview"/);
    assert.match(source, /BRANCH\s*===\s*"codex\/civilon-price-check-phase-5"/);
  }
});
