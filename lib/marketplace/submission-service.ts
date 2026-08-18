import "../../db/price-check/server-boundary.ts";

import { createHash } from "node:crypto";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import { generateOrderedId, generatePublicReference } from "../../db/price-check/domain/identifiers.ts";
import {
  createBuyRequest,
  findBuyRequestByIdempotencyHash,
  type CreateBuyRequestInput,
} from "../../db/price-check/repositories/buy-request-repository.ts";
import { LEGAL_DOCUMENT_VERSIONS } from "../legal.ts";
import type { BuyRequestSubmission } from "./contract.ts";
import {
  BUY_REQUEST_VERIFY_TOKEN_TTL_MS,
  deriveVerificationToken,
  hashVerificationToken,
  marketplaceVerifyTokenKey,
  newVerificationNonce,
} from "./verification.ts";

type SubmissionDependencies = {
  create: typeof createBuyRequest;
  findByIdempotency: typeof findBuyRequestByIdempotencyHash;
  generateReference: () => string;
  tokenKey: () => string;
  newNonce: typeof newVerificationNonce;
};

const defaultDependencies: SubmissionDependencies = {
  create: createBuyRequest,
  findByIdempotency: findBuyRequestByIdempotencyHash,
  generateReference: () => generatePublicReference("BR"),
  tokenKey: () => marketplaceVerifyTokenKey(),
  newNonce: newVerificationNonce,
};

/**
 * The client-supplied idempotency key is never stored raw: only a labelled
 * digest reaches the database, so a persisted row cannot be correlated back to
 * a browser-held value.
 */
export function buyRequestIdempotencyHash(key: string) {
  return createHash("sha256")
    .update(`civilon-buy-request-submit:v1:${key}`)
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
  submission: BuyRequestSubmission,
  hash: string,
  publicReference: string,
  verificationToken: CreateBuyRequestInput["verificationToken"],
  now: Date,
): CreateBuyRequestInput {
  return {
    contact: {
      firstName: submission.firstName,
      lastName: submission.lastName,
      companyName: submission.companyName,
      businessEmail: submission.businessEmail,
      phone: submission.phone,
      country: submission.deliveryCountry,
      serviceProcessingAcknowledgedAt: now,
    },
    request: {
      originalPartNumber: submission.partNumber,
      description: submission.description,
      quantity: submission.quantity,
      acceptableCondition: submission.acceptableCondition,
      urgency: submission.urgency,
      neededByDate: submission.neededByDate,
      aircraftModel: submission.aircraftModel,
      applicationNotes: submission.applicationNotes,
      deliveryCountry: submission.deliveryCountry,
      deliveryPostalCode: submission.deliveryPostalCode,
      deliveryCity: submission.deliveryCity,
      fulfillmentPreference: submission.fulfillmentPreference,
    },
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
    legalAcknowledgment: {
      acknowledgedAt: now,
      privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
      termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
    },
    verificationToken,
    idempotencyHash: hash,
    correlationId: generateOrderedId(),
    publicReference,
    submittedAt: now,
  };
}

/**
 * Accepts a validated Buy Request.
 *
 * The verification credential is derived here and immediately discarded: only
 * its keyed hash and the derivation nonce are persisted, and the email handler
 * re-derives the credential from that nonce when it sends. No plaintext token
 * is stored, logged, or returned to the caller.
 */
export async function submitBuyRequest(
  db: PriceCheckDb,
  submission: BuyRequestSubmission,
  dependencies: SubmissionDependencies = defaultDependencies,
  options: { now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const hash = buyRequestIdempotencyHash(submission.idempotencyKey);
  const existing = await dependencies.findByIdempotency(db, hash);
  if (existing) return { reference: existing.publicReference, created: false };

  const key = dependencies.tokenKey();
  const nonce = dependencies.newNonce();
  const verificationToken = {
    keyedTokenHash: hashVerificationToken(key, deriveVerificationToken(key, nonce)),
    tokenDerivationNonce: nonce,
    expiresAt: new Date(now.valueOf() + BUY_REQUEST_VERIFY_TOKEN_TTL_MS),
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const publicReference = dependencies.generateReference();
    try {
      const created = await dependencies.create(
        db,
        requestInput(submission, hash, publicReference, verificationToken, now),
      );
      return { reference: created.publicReference, created: true };
    } catch (error) {
      const detail = databaseError(error);
      if (detail.code === "23505" && detail.constraint === "buy_requests_idempotency_hash_uidx") {
        const retry = await dependencies.findByIdempotency(db, hash);
        if (retry) return { reference: retry.publicReference, created: false };
      }
      if (detail.code === "23505" && detail.constraint === "buy_requests_public_reference_uidx") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Buy Request reference generation exhausted.");
}
