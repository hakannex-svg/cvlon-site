import "../server-boundary.ts";

import { and, eq } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import {
  auditEvents,
  priceCheckDocumentRequirements,
  priceCheckRevisions,
  priceChecks,
  requesters,
} from "../schema.ts";
import { generateOrderedId, generatePublicReference } from "../domain/identifiers.ts";
import {
  normalizeEmail,
  normalizePartNumber,
  normalizePhone,
  sanitizeAttribution,
  sanitizeOtherDocumentationText,
  validateCurrencyCode,
  parseMoney,
} from "../domain/normalization.ts";
import {
  assertPriceCheckTransition,
  type PriceCheckStatus,
} from "../domain/status-policy.ts";

type DocumentationCode =
  | "FAA_8130_3"
  | "EASA_FORM_1"
  | "DUAL_RELEASE"
  | "OEM_MANUFACTURER_COC"
  | "MATERIAL_CERTIFICATION"
  | "REMOVAL_RECORDS"
  | "TEARDOWN_EVALUATION_REPORT"
  | "TEST_REPORT"
  | "OTHER"
  | "NOT_SURE";

export type CreatePriceCheckRequestInput = {
  requester: {
    firstName: string;
    lastName: string;
    companyName: string;
    businessEmail: string;
    phone: string;
    role?: string | null;
    country: string;
    serviceProcessingAcknowledgedAt: Date;
    marketingConsentAt?: Date | null;
  };
  transaction: {
    originalPartNumber: string;
    description?: string | null;
    quantity: string;
    quoteOrPurchased: "quote" | "purchased";
    transactionType: "outright" | "exchange" | "repair" | "not_sure";
    conditionCode: "NE" | "NS" | "OH" | "SV" | "AR" | "NOT_SURE";
    unitPrice: string | number;
    currencyCode: string;
    coreCharge?: string | number | null;
    coreDisposition?:
      | "REFUNDABLE"
      | "FORFEITED"
      | "UNCLEAR"
      | "NOT_APPLICABLE"
      | null;
    exchangeFee?: string | number | null;
    freight?: string | number | null;
    transactionDate?: string | null;
    transactionDateUncertain?: boolean;
    aircraftModel?: string | null;
    aog: boolean;
    warrantyValue?: string | null;
    warrantyUnit?: "DAYS" | "MONTHS" | "YEARS" | "HOURS" | "CYCLES" | "OTHER" | null;
    warrantyText?: string | null;
    notes?: string | null;
  };
  documentation?: Array<{ code: DocumentationCode; otherText?: string | null }>;
  attribution: {
    sourcePage: string;
    landingPage?: string | null;
    referrer?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
  };
  idempotencyHash: string;
  correlationId: string;
  submittedAt?: Date;
};

function nullableMoney(value?: string | number | null) {
  return value === null || value === undefined ? null : parseMoney(value);
}

export async function createPriceCheckRequest(
  db: PriceCheckDb,
  input: CreatePriceCheckRequestInput,
) {
  const requesterId = generateOrderedId();
  const priceCheckId = generateOrderedId();
  const revisionId = generateOrderedId();
  const publicReference = generatePublicReference();
  const submittedAt = input.submittedAt ?? new Date();
  const attribution = sanitizeAttribution(input.attribution);
  const normalizedPartNumber = normalizePartNumber(
    input.transaction.originalPartNumber,
  );

  return db.transaction(async (tx) => {
    await tx.insert(requesters).values({
      id: requesterId,
      firstName: input.requester.firstName.trim(),
      lastName: input.requester.lastName.trim(),
      companyName: input.requester.companyName.trim(),
      businessEmail: input.requester.businessEmail.trim(),
      normalizedEmail: normalizeEmail(input.requester.businessEmail),
      phone: input.requester.phone.trim(),
      normalizedPhone: normalizePhone(input.requester.phone),
      role: input.requester.role?.trim() || null,
      country: input.requester.country.trim().toUpperCase(),
      serviceProcessingAcknowledgedAt:
        input.requester.serviceProcessingAcknowledgedAt,
      marketingConsentAt: input.requester.marketingConsentAt ?? null,
    });

    await tx.insert(priceChecks).values({
      id: priceCheckId,
      publicReference,
      requesterId,
      originalPartNumber: input.transaction.originalPartNumber.trim(),
      normalizedPartNumber,
      description: input.transaction.description?.trim() || null,
      quantity: input.transaction.quantity,
      quoteOrPurchased: input.transaction.quoteOrPurchased,
      transactionType: input.transaction.transactionType,
      conditionCode: input.transaction.conditionCode,
      unitPrice: parseMoney(input.transaction.unitPrice),
      currencyCode: validateCurrencyCode(input.transaction.currencyCode),
      coreCharge: nullableMoney(input.transaction.coreCharge),
      coreDisposition: input.transaction.coreDisposition ?? null,
      exchangeFee: nullableMoney(input.transaction.exchangeFee),
      freight: nullableMoney(input.transaction.freight),
      transactionDate: input.transaction.transactionDate ?? null,
      transactionDateUncertain:
        input.transaction.transactionDateUncertain ?? false,
      aircraftModel: input.transaction.aircraftModel?.trim() || null,
      aog: input.transaction.aog,
      warrantyValue: input.transaction.warrantyValue ?? null,
      warrantyUnit: input.transaction.warrantyUnit ?? null,
      warrantyText: input.transaction.warrantyText?.trim() || null,
      notes: input.transaction.notes?.trim() || null,
      sourcePage: input.attribution.sourcePage,
      ...attribution,
      idempotencyHash: input.idempotencyHash,
      submittedAt,
    });

    const requirements = (input.documentation ?? []).map((requirement) => ({
      priceCheckId,
      requirementCode: requirement.code,
      otherText:
        requirement.code === "OTHER"
          ? sanitizeOtherDocumentationText(requirement.otherText ?? "")
          : null,
    }));
    if (requirements.length > 0) {
      await tx.insert(priceCheckDocumentRequirements).values(requirements);
    }

    const initialSnapshot = {
      originalPartNumber: input.transaction.originalPartNumber.trim(),
      normalizedPartNumber,
      quantity: input.transaction.quantity,
      quoteOrPurchased: input.transaction.quoteOrPurchased,
      transactionType: input.transaction.transactionType,
      conditionCode: input.transaction.conditionCode,
      unitPrice: parseMoney(input.transaction.unitPrice),
      currencyCode: validateCurrencyCode(input.transaction.currencyCode),
      aog: input.transaction.aog,
    };
    await tx.insert(priceCheckRevisions).values({
      id: revisionId,
      priceCheckId,
      version: 1,
      normalizedSnapshot: initialSnapshot,
      changeReason: "Original submitted transaction",
      actorType: "REQUESTER",
      actorId: requesterId,
    });
    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: "price_check",
      aggregateId: priceCheckId,
      actorType: "REQUESTER",
      actorId: requesterId,
      action: "price_check.submitted",
      afterVersionReference: "revision:1",
      correlationId: input.correlationId,
      sanitizedMetadata: { sourcePage: input.attribution.sourcePage },
    });

    return { priceCheckId, requesterId, revisionId, publicReference };
  });
}

export async function transitionPriceCheckStatus(
  db: PriceCheckDb,
  priceCheckId: string,
  to: PriceCheckStatus,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: priceChecks.status })
      .from(priceChecks)
      .where(eq(priceChecks.id, priceCheckId))
      .limit(1);
    if (!current) throw new Error("Price Check was not found.");

    assertPriceCheckTransition(current.status, to);
    const [updated] = await tx
      .update(priceChecks)
      .set({
        status: to,
        updatedAt: new Date(),
        closedAt: to === "closed" ? new Date() : null,
      })
      .where(and(eq(priceChecks.id, priceCheckId), eq(priceChecks.status, current.status)))
      .returning({ id: priceChecks.id, status: priceChecks.status });
    if (!updated) throw new Error("Concurrent Price Check status update rejected.");
    return updated;
  });
}
