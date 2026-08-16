import "../../db/price-check/server-boundary.ts";

import { createHash } from "node:crypto";
import type { PriceCheckDb } from "../../db/price-check/index.ts";
import { generateOrderedId, generatePublicReference } from "../../db/price-check/domain/identifiers.ts";
import {
  createPriceCheckRequest,
  findPriceCheckByIdempotencyHash,
  type CreatePriceCheckRequestInput,
} from "../../db/price-check/repositories/request-repository.ts";
import type { PriceCheckSubmission } from "./contract.ts";

type SubmissionDependencies = {
  create: typeof createPriceCheckRequest;
  findByIdempotency: typeof findPriceCheckByIdempotencyHash;
  generateReference: typeof generatePublicReference;
};

const defaultDependencies: SubmissionDependencies = {
  create: createPriceCheckRequest,
  findByIdempotency: findPriceCheckByIdempotencyHash,
  generateReference: generatePublicReference,
};

function idempotencyHash(key: string) {
  return createHash("sha256")
    .update(`civilon-price-check-submit:v1:${key}`)
    .digest("hex");
}

function databaseError(error: unknown) {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
    const record = candidate as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (record.code || record.constraint) return record;
    candidate = record.cause;
  }
  return {} as { code?: unknown; constraint?: unknown };
}

function requestInput(
  submission: PriceCheckSubmission,
  hash: string,
  publicReference: string,
): CreatePriceCheckRequestInput {
  return {
    requester: {
      firstName: submission.firstName,
      lastName: submission.lastName,
      companyName: submission.companyName,
      businessEmail: submission.businessEmail,
      phone: submission.phone,
      role: submission.role,
      country: submission.country,
      serviceProcessingAcknowledgedAt: new Date(),
      marketingConsentAt: null,
    },
    transaction: {
      originalPartNumber: submission.partNumber,
      description: submission.description,
      quantity: submission.quantity,
      quoteOrPurchased: submission.quoteOrPurchased,
      transactionType: submission.transactionType,
      conditionCode: submission.conditionCode,
      unitPrice: submission.unitPrice,
      currencyCode: submission.currencyCode,
      coreCharge: submission.coreCharge,
      coreDisposition: submission.coreDisposition,
      exchangeFee: submission.exchangeFee,
      freight: submission.freight,
      transactionDate: submission.transactionDate,
      aircraftModel: submission.aircraftModel,
      aog: submission.aog,
      warrantyValue: submission.warrantyValue,
      warrantyUnit: submission.warrantyUnit,
      warrantyText: submission.warrantyText,
      notes: submission.notes,
    },
    documentation: submission.documentationCodes.map((code) => ({
      code,
      otherText: code === "OTHER" ? submission.documentationOther : null,
    })),
    attribution: {
      sourcePage: submission.sourcePage,
      landingPage: submission.landingPage,
      referrer: submission.referrer,
      utmSource: submission.utmSource,
      utmMedium: submission.utmMedium,
      utmCampaign: submission.utmCampaign,
      utmContent: submission.utmContent,
      utmTerm: submission.utmTerm,
    },
    idempotencyHash: hash,
    correlationId: generateOrderedId(),
    publicReference,
  };
}

export async function submitPriceCheck(
  db: PriceCheckDb,
  submission: PriceCheckSubmission,
  dependencies: SubmissionDependencies = defaultDependencies,
) {
  const hash = idempotencyHash(submission.idempotencyKey);
  const existing = await dependencies.findByIdempotency(db, hash);
  if (existing) return { reference: existing.publicReference, created: false };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const publicReference = dependencies.generateReference();
    try {
      const created = await dependencies.create(
        db,
        requestInput(submission, hash, publicReference),
      );
      return { reference: created.publicReference, created: true };
    } catch (error) {
      const detail = databaseError(error);
      if (detail.code === "23505" && detail.constraint === "price_checks_idempotency_hash_uidx") {
        const retry = await dependencies.findByIdempotency(db, hash);
        if (retry) return { reference: retry.publicReference, created: false };
      }
      if (detail.code === "23505" && detail.constraint === "price_checks_public_reference_uidx") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Price Check reference generation exhausted.");
}
