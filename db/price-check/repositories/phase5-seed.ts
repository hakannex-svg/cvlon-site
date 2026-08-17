import "../server-boundary.ts";

import { count, eq } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import { priceChecks, priceObservations } from "../schema.ts";
import { normalizePartNumber } from "../domain/normalization.ts";
import { createPriceCheckRequest } from "./request-repository.ts";
import { assignPriceCheck, changePriceCheckStatus, type AdminActor } from "./admin-repository.ts";
import { createGovernedObservation, createGovernedPartRelationship } from "./comparable-repository.ts";

const SOURCE_PAGE = "/phase-5-synthetic-preview";
const SOURCE_PREFIX = "PHASE5-SYNTHETIC:";

type Scenario = {
  code: string;
  partNumber: string;
  submittedPrice: string;
  conditionCode: "NE" | "NS" | "OH" | "SV" | "AR" | "NOT_SURE";
  transactionType: "outright" | "exchange" | "repair" | "not_sure";
  aog?: boolean;
  coreCharge?: string | null;
  coreDisposition?: "REFUNDABLE" | "FORFEITED" | "UNCLEAR" | "NOT_APPLICABLE" | null;
  exchangeFee?: string | null;
};

const scenarios: Scenario[] = [
  { code: "A", partNumber: "SYN-SV-100", submittedPrice: "1175.00", conditionCode: "SV", transactionType: "outright" },
  { code: "B", partNumber: "SYN-EX-200", submittedPrice: "5200.00", conditionCode: "OH", transactionType: "exchange", coreCharge: "2500.00", coreDisposition: "REFUNDABLE", exchangeFee: "200.00" },
  { code: "C", partNumber: "SYN-ONE-300", submittedPrice: "950.00", conditionCode: "SV", transactionType: "outright" },
  { code: "D", partNumber: "SYN-ZERO-400", submittedPrice: "1800.00", conditionCode: "NE", transactionType: "outright" },
  { code: "E", partNumber: "SYN-REL-500", submittedPrice: "2300.00", conditionCode: "SV", transactionType: "outright" },
  { code: "F", partNumber: "SYN-FX-600", submittedPrice: "2100.00", conditionCode: "SV", transactionType: "outright" },
  { code: "G", partNumber: "SYN-MIX-700", submittedPrice: "3300.00", conditionCode: "NE", transactionType: "outright" },
  { code: "H", partNumber: "SYN-OLD-800", submittedPrice: "1400.00", conditionCode: "NS", transactionType: "outright" },
  { code: "I", partNumber: "SYN-AOG-900", submittedPrice: "4800.00", conditionCode: "SV", transactionType: "outright", aog: true },
];

async function seedRequest(db: PriceCheckDb, actor: AdminActor, scenario: Scenario) {
  const created = await createPriceCheckRequest(db, {
    requester: {
      firstName: "Synthetic",
      lastName: `Scenario ${scenario.code}`,
      companyName: `Example Phase 5 Scenario ${scenario.code} Aviation`,
      businessEmail: `phase5-${scenario.code.toLowerCase()}@example.com`,
      phone: "+1 202 555 0155",
      role: "Buyer",
      country: "US",
      serviceProcessingAcknowledgedAt: new Date(),
    },
    transaction: {
      originalPartNumber: scenario.partNumber,
      description: `Synthetic scenario ${scenario.code} component`,
      quantity: "1",
      quoteOrPurchased: "quote",
      transactionType: scenario.transactionType,
      conditionCode: scenario.conditionCode,
      unitPrice: scenario.submittedPrice,
      currencyCode: "USD",
      coreCharge: scenario.coreCharge ?? null,
      coreDisposition: scenario.coreDisposition ?? (scenario.transactionType === "exchange" ? "REFUNDABLE" : "NOT_APPLICABLE"),
      exchangeFee: scenario.exchangeFee ?? null,
      freight: "75.00",
      transactionDate: "2026-08-01",
      aircraftModel: "Synthetic business aircraft",
      aog: scenario.aog ?? false,
      warrantyValue: "12",
      warrantyUnit: "MONTHS",
      warrantyText: null,
      notes: `Synthetic Phase 5 owner-review scenario ${scenario.code}`,
    },
    documentation: [{ code: "FAA_8130_3" }],
    attribution: { sourcePage: SOURCE_PAGE },
    idempotencyHash: `phase5-synthetic-${scenario.code.toLowerCase()}-20260816`,
    correlationId: `phase5-seed:${scenario.code}`,
  });
  await assignPriceCheck(db, { priceCheckId: created.priceCheckId, assigneeId: actor.id, actor });
  await changePriceCheckStatus(db, { priceCheckId: created.priceCheckId, to: "ready_for_analysis", actor });
  return created;
}
async function observation(db: PriceCheckDb, actor: AdminActor, input: {
  reference: string;
  partNumber: string;
  price: string;
  conditionCode?: "NE" | "NS" | "OH" | "SV" | "AR" | "NOT_SURE";
  transactionType?: "outright" | "exchange" | "repair" | "not_sure";
  currencyCode?: "USD" | "EUR";
  observationDate?: string;
  aog?: boolean;
  verificationState?: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
  permittedUseState?: "PENDING" | "INTERNAL_ANALYSIS" | "AGGREGATE_ONLY" | "PROHIBITED";
  coreDisposition?: "REFUNDABLE" | "FORFEITED" | "UNCLEAR" | "NOT_APPLICABLE";
}) {
  return createGovernedObservation(db, {
    actor,
    documentationCodes: ["FAA_8130_3"],
    observation: {
      provenanceType: "ANALYST_OBSERVATION",
      internalSourceReference: `${SOURCE_PREFIX}${input.reference}`,
      originalPartNumber: input.partNumber,
      normalizedPartNumber: normalizePartNumber(input.partNumber),
      conditionCode: input.conditionCode ?? "SV",
      transactionType: input.transactionType ?? "outright",
      quantity: input.reference.endsWith("Q3") ? "3.000" : "1.000",
      unitPrice: input.price,
      currencyCode: input.currencyCode ?? "USD",
      coreCharge: input.transactionType === "exchange" ? "2500.00" : null,
      coreDisposition: input.coreDisposition ?? (input.transactionType === "exchange" ? "REFUNDABLE" : "NOT_APPLICABLE"),
      exchangeFee: input.transactionType === "exchange" ? "200.00" : null,
      freight: "75.00",
      observationDate: input.observationDate ?? "2026-07-01",
      warrantyValue: "12.00",
      warrantyUnit: "MONTHS",
      warrantyText: null,
      aog: input.aog ?? false,
      aircraftApplication: "Synthetic business aircraft",
      regionContext: "US",
      sourceReliability: input.reference.endsWith("LOW") ? "LOW" : "HIGH",
      verificationState: input.verificationState ?? "VERIFIED",
      permittedUseState: input.permittedUseState ?? "INTERNAL_ANALYSIS",
    },
  });
}

export async function seedPhase5SyntheticPreview(db: PriceCheckDb, actor: AdminActor) {
  const [[existingRequests], [existingObservations]] = await Promise.all([
    db.select({ value: count() }).from(priceChecks).where(eq(priceChecks.sourcePage, SOURCE_PAGE)),
    db.select({ value: count() }).from(priceObservations).where(eq(priceObservations.internalSourceReference, `${SOURCE_PREFIX}A-1`)),
  ]);
  if ((existingRequests?.value ?? 0) > 0 || (existingObservations?.value ?? 0) > 0) {
    const [observationCount] = await db.select({ value: count() }).from(priceObservations);
    return { seeded: false, requestCount: existingRequests?.value ?? 0, observationCount: observationCount?.value ?? 0 };
  }

  for (const scenario of scenarios) await seedRequest(db, actor, scenario);
  for (const [index, price] of ["900", "1000", "1100", "1200", "1300", "1400"].entries()) await observation(db, actor, { reference: `A-${index + 1}`, partNumber: "SYN-SV-100", price });
  for (const [index, price] of ["2400", "2600", "2800", "3000", "3200"].entries()) await observation(db, actor, { reference: `B-${index + 1}`, partNumber: "SYN-EX-200", price, conditionCode: "OH", transactionType: "exchange", coreDisposition: index === 4 ? "FORFEITED" : "REFUNDABLE" });
  await observation(db, actor, { reference: "C-1", partNumber: "SYN-ONE-300", price: "1000" });
  for (const [index, price] of ["2100", "2200", "2400"].entries()) await observation(db, actor, { reference: `E-X-${index + 1}`, partNumber: "SYN-REL-500", price });
  await createGovernedPartRelationship(db, { actor, relationship: { fromNormalizedPartNumber: "SYNREL500", toNormalizedPartNumber: "SYNREL450", relationshipType: "SUPERSEDED_BY", sourceProvenance: `${SOURCE_PREFIX}E-RELATIONSHIP`, verificationState: "VERIFIED", effectiveFrom: "2024-01-01", effectiveTo: null, notes: "Synthetic governed superseded-part example." } });
  for (const [index, price] of ["2000", "2250", "2500"].entries()) await observation(db, actor, { reference: `E-R-${index + 1}`, partNumber: "SYN-REL-450", price });
  for (const [index, price] of ["1800", "2000", "2200"].entries()) await observation(db, actor, { reference: `F-USD-${index + 1}`, partNumber: "SYN-FX-600", price });
  for (const [index, price] of ["1600", "1900"].entries()) await observation(db, actor, { reference: `F-EUR-${index + 1}`, partNumber: "SYN-FX-600", price, currencyCode: "EUR" });
  for (const [index, condition] of ["NE", "NS", "OH", "SV"].entries()) await observation(db, actor, { reference: `G-${condition}`, partNumber: "SYN-MIX-700", price: String(2800 + index * 300), conditionCode: condition });
  await observation(db, actor, { reference: "G-Q3", partNumber: "SYN-MIX-700", price: "3500", conditionCode: "NE" });
  for (const [index, year] of [2019, 2020, 2021, 2022].entries()) await observation(db, actor, { reference: `H-${year}`, partNumber: "SYN-OLD-800", price: String(1000 + index * 150), conditionCode: "NS", observationDate: `${year}-06-15` });
  for (const [index, aog] of [true, true, false, false].entries()) await observation(db, actor, { reference: `I-${index + 1}`, partNumber: "SYN-AOG-900", price: String(4000 + index * 250), aog });
  await observation(db, actor, { reference: "J-UNVERIFIED", partNumber: "SYN-SV-100", price: "1500", verificationState: "UNVERIFIED" });
  await observation(db, actor, { reference: "K-PROHIBITED", partNumber: "SYN-SV-100", price: "1600", permittedUseState: "PROHIBITED" });
  const [observationCount] = await db.select({ value: count() }).from(priceObservations);
  return { seeded: true, requestCount: scenarios.length, observationCount: observationCount?.value ?? 0 };
}
