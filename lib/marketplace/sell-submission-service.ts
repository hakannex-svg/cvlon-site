import "../../db/price-check/server-boundary.ts";

import { createHash } from "node:crypto";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import { generateOrderedId, generatePublicReference } from "../../db/price-check/domain/identifiers.ts";
import {
  createSellSubmission,
  findSellSubmissionByIdempotencyHash,
  type CreateSellSubmissionInput,
} from "../../db/price-check/repositories/sell-submission-repository.ts";
import { LEGAL_DOCUMENT_VERSIONS } from "../legal.ts";
import type { SellSubmissionInput } from "./sell-contract.ts";
import {
  BUY_REQUEST_VERIFY_TOKEN_TTL_MS,
  deriveSellVerificationToken,
  hashVerificationToken,
  marketplaceVerifyTokenKey,
  newVerificationNonce,
} from "./verification.ts";

/** Sell verification links live exactly as long as Buy verification links. */
export const SELL_SUBMISSION_VERIFY_TOKEN_TTL_MS = BUY_REQUEST_VERIFY_TOKEN_TTL_MS;

type PreparedAttachment = CreateSellSubmissionInput["attachments"] extends
  Array<infer Item> | undefined ? Item : never;

type SubmissionDependencies = {
  create: typeof createSellSubmission;
  findByIdempotency: typeof findSellSubmissionByIdempotencyHash;
  generateReference: () => string;
  tokenKey: () => string;
  newNonce: typeof newVerificationNonce;
  /**
   * Verifies handles and returns rows ready to claim. Injected so the storage
   * round trips it performs stay outside the submission transaction and stay
   * substitutable in tests, where no AWS call may ever happen.
   */
  prepareAttachments: (
    db: PriceCheckDb,
    input: { handles: string[]; uploadSessionToken: string | null | undefined },
  ) => Promise<PreparedAttachment[]>;
};

async function defaultPrepareAttachments(
  db: PriceCheckDb,
  input: { handles: string[]; uploadSessionToken: string | null | undefined },
) {
  if (input.handles.length === 0) return [];
  const [{ prepareMarketplaceAttachments }, session] = await Promise.all([
    import("./uploads/binding.ts"),
    import("./uploads/session.ts"),
  ]);
  const tokenHash = input.uploadSessionToken
    ? session.hashMarketplaceUploadSessionToken(
        session.marketplaceUploadSessionKey(),
        input.uploadSessionToken,
      )
    : null;
  return prepareMarketplaceAttachments(db, {
    handles: input.handles,
    uploadSessionToken: input.uploadSessionToken,
    tokenHash,
    intendedAggregateType: "sell_submission",
  });
}

const defaultDependencies: SubmissionDependencies = {
  create: createSellSubmission,
  findByIdempotency: findSellSubmissionByIdempotencyHash,
  generateReference: () => generatePublicReference("SS"),
  tokenKey: () => marketplaceVerifyTokenKey(),
  newNonce: newVerificationNonce,
  prepareAttachments: defaultPrepareAttachments,
};

/**
 * The client-supplied idempotency key is never stored raw: only a labelled
 * digest reaches the database, so a persisted row cannot be correlated back to
 * a browser-held value. The label is Sell-specific, so the same key replayed
 * against the Buy intake produces a different hash and a separate record rather
 * than colliding across the two workflows.
 */
export function sellSubmissionIdempotencyHash(key: string) {
  return createHash("sha256")
    .update(`civilon-sell-submission-submit:v1:${key}`)
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

function submissionInput(
  submission: SellSubmissionInput,
  hash: string,
  publicReference: string,
  verificationToken: CreateSellSubmissionInput["verificationToken"],
  attachments: PreparedAttachment[],
  now: Date,
): CreateSellSubmissionInput {
  return {
    contact: {
      firstName: submission.firstName,
      lastName: submission.lastName,
      companyName: submission.companyName,
      businessEmail: submission.businessEmail,
      phone: submission.phone,
      country: submission.locationCountry,
      stateRegion: submission.locationStateRegion,
      city: submission.locationCity,
      postalCode: submission.locationPostalCode,
      serviceProcessingAcknowledgedAt: now,
    },
    submission: {
      submissionKind: submission.submissionKind,
      originalPartNumber: submission.partNumber,
      description: submission.description,
      quantity: submission.quantity,
      conditionCode: submission.conditionCode,
      estimatedLineItemCount: submission.estimatedLineItemCount,
      quoteOnRequest: submission.quoteOnRequest,
      askingUnitPrice: submission.askingUnitPrice,
      currencyCode: submission.currencyCode,
      canShipToNewJersey: submission.canShipToNewJersey,
      locationCountry: submission.locationCountry,
      locationStateRegion: submission.locationStateRegion,
      locationCity: submission.locationCity,
      locationPostalCode: submission.locationPostalCode,
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
    attachments,
    idempotencyHash: hash,
    correlationId: generateOrderedId(),
    publicReference,
    submittedAt: now,
  };
}

/**
 * Accepts a validated Sell Submission.
 *
 * The verification credential is derived here and immediately discarded: only
 * its keyed hash and the derivation nonce are persisted, and the email handler
 * re-derives the credential from that nonce when it sends. No plaintext token
 * is stored, logged, or returned to the caller.
 *
 * A replay of the same idempotency key returns the original `SS-` reference
 * without creating a second contact, a second token or a second pair of emails.
 */
export async function submitSellSubmission(
  db: PriceCheckDb,
  submission: SellSubmissionInput,
  dependencies: SubmissionDependencies = defaultDependencies,
  options: { now?: Date; uploadSessionToken?: string | null } = {},
) {
  const now = options.now ?? new Date();
  const hash = sellSubmissionIdempotencyHash(submission.idempotencyKey);
  const existing = await dependencies.findByIdempotency(db, hash);
  if (existing) return { reference: existing.publicReference, created: false };

  // Every storage round trip happens here, before the transaction opens. A
  // replay above returns without touching storage at all, so a re-submitted
  // request cannot re-verify — or re-claim — evidence the first one already
  // bound.
  const attachments = await dependencies.prepareAttachments(db, {
    handles: submission.attachmentHandles,
    uploadSessionToken: options.uploadSessionToken,
  });

  const key = dependencies.tokenKey();
  const nonce = dependencies.newNonce();
  const verificationToken = {
    keyedTokenHash: hashVerificationToken(key, deriveSellVerificationToken(key, nonce)),
    tokenDerivationNonce: nonce,
    expiresAt: new Date(now.valueOf() + SELL_SUBMISSION_VERIFY_TOKEN_TTL_MS),
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const publicReference = dependencies.generateReference();
    try {
      const created = await dependencies.create(
        db,
        submissionInput(submission, hash, publicReference, verificationToken, attachments, now),
      );
      return { reference: created.publicReference, created: true };
    } catch (error) {
      const detail = databaseError(error);
      if (
        detail.code === "23505"
        && detail.constraint === "sell_submissions_idempotency_hash_uidx"
      ) {
        const retry = await dependencies.findByIdempotency(db, hash);
        if (retry) return { reference: retry.publicReference, created: false };
      }
      if (
        detail.code === "23505"
        && detail.constraint === "sell_submissions_public_reference_uidx"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Sell Submission reference generation exhausted.");
}
