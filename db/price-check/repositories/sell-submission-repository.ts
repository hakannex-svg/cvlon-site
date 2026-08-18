import "../server-boundary.ts";

import { and, eq, inArray, isNull } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import {
  auditEvents,
  emailVerificationTokens,
  marketplaceAttachments,
  marketplaceContacts,
  marketplacePendingUploads,
  notificationOutbox,
  sellSubmissions,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  normalizeEmail,
  normalizePartNumber,
  normalizePhone,
  sanitizeAttribution,
} from "../domain/normalization.ts";

export const SELL_SUBMISSION_VERIFY_MESSAGE_TYPE = "SELL_SUBMISSION_VERIFY_EMAIL";
export const SELL_SUBMISSION_INTERNAL_MESSAGE_TYPE = "SELL_SUBMISSION_INTERNAL_RECEIVED";
export const SELL_SUBMISSION_AGGREGATE_TYPE = "sell_submission";
export const SELL_SUBMISSION_TOKEN_PURPOSE = "SELL_SUBMISSION_CONTACT";

/** Operational routing label. Deliberately not a supplier or staff address. */
const INTERNAL_RECIPIENT_REFERENCE = "civilon-marketplace-internal";

/** The contact role recorded for a supplier offering parts to Civilon. */
const SELLER_CONTACT_ROLE = "seller";

export type CreateSellSubmissionInput = {
  contact: {
    firstName: string;
    lastName: string;
    companyName: string;
    businessEmail: string;
    phone?: string | null;
    country?: string | null;
    stateRegion?: string | null;
    city?: string | null;
    postalCode?: string | null;
    serviceProcessingAcknowledgedAt: Date;
  };
  submission: {
    submissionKind: "single_part" | "bulk_inventory";
    originalPartNumber?: string | null;
    description?: string | null;
    quantity?: string | null;
    conditionCode?: "NOT_SURE" | "NE" | "NS" | "OH" | "SV" | "AR" | null;
    estimatedLineItemCount?: number | null;
    quoteOnRequest: boolean;
    askingUnitPrice?: string | null;
    currencyCode?: string | null;
    canShipToNewJersey?: boolean | null;
    locationCountry?: string | null;
    locationStateRegion?: string | null;
    locationCity?: string | null;
    locationPostalCode?: string | null;
  };
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
  legalAcknowledgment: {
    acknowledgedAt: Date;
    privacyVersion: string;
    termsVersion: string;
  };
  /** Keyed hash and derivation nonce only. The credential never reaches this layer. */
  verificationToken: {
    keyedTokenHash: string;
    tokenDerivationNonce: string;
    expiresAt: Date;
  };
  /**
   * Already-verified evidence, prepared outside this transaction. Each entry
   * names a pending upload row this transaction will claim; no storage call
   * happens while the transaction is open.
   */
  attachments?: Array<{
    id: string;
    pendingUploadId: string;
    uploadSessionId: string;
    displayFilename: string;
    objectKey: string;
    declaredMime: string;
    detectedMime: string;
    purpose: string;
    byteSize: number;
  }>;
  idempotencyHash: string;
  correlationId: string;
  publicReference: string;
  submittedAt?: Date;
};

/**
 * Persists a Sell Submission and everything the workflow depends on in one
 * transaction: the seller contact, the pending submission, the single live
 * verification token, the submission audit trail, and both outbox messages.
 *
 * The seller contact is created fresh rather than matched to an existing
 * marketplace contact by email. Identity is not proven at first touch, so
 * attaching a new offer to an existing row would let anyone who knows a
 * supplier's address write into that supplier's record. Deduplication stays an
 * admin decision, exactly as `marketplace_contacts` documents.
 *
 * The outbox rows are written here rather than after commit precisely so that
 * staff visibility never depends on email. Either the submission and its
 * notifications exist together, or neither does; a provider outage later can
 * only delay delivery, never remove the offer.
 *
 * Nothing here writes a listing, publication, search or expiry state: a Sell
 * Submission has no shelf life and slow-moving inventory is never aged out.
 */
export async function createSellSubmission(db: PriceCheckDb, input: CreateSellSubmissionInput) {
  const contactId = generateOrderedId();
  const sellSubmissionId = generateOrderedId();
  const tokenId = generateOrderedId();
  const submittedAt = input.submittedAt ?? new Date();
  const attribution = sanitizeAttribution(input.attribution);
  const isBulk = input.submission.submissionKind === "bulk_inventory";

  const originalPartNumber = isBulk ? null : input.submission.originalPartNumber?.trim() || null;
  const normalizedPartNumber = originalPartNumber ? normalizePartNumber(originalPartNumber) : null;
  const description = input.submission.description?.trim() || null;
  const quantity = isBulk ? null : input.submission.quantity?.trim() || null;
  const askingUnitPrice = isBulk ? null : input.submission.askingUnitPrice?.trim() || null;
  const currencyCode = askingUnitPrice
    ? input.submission.currencyCode?.trim().toUpperCase() || null
    : null;
  const quoteOnRequest = isBulk ? true : input.submission.quoteOnRequest;

  if (!isBulk && !originalPartNumber && !description) {
    throw new Error("A single-part Sell Submission requires a part number or a description.");
  }
  if (!quoteOnRequest && !askingUnitPrice) {
    throw new Error("A Sell Submission that is not quote-on-request requires an asking unit price.");
  }
  if (askingUnitPrice && !currencyCode) {
    throw new Error("An asking unit price requires an approved currency.");
  }

  return db.transaction(async (tx) => {
    await tx.insert(marketplaceContacts).values({
      id: contactId,
      firstName: input.contact.firstName.trim(),
      lastName: input.contact.lastName.trim(),
      companyName: input.contact.companyName.trim(),
      businessEmail: input.contact.businessEmail.trim(),
      normalizedEmail: normalizeEmail(input.contact.businessEmail),
      phone: input.contact.phone?.trim() || null,
      normalizedPhone: input.contact.phone ? normalizePhone(input.contact.phone) : null,
      role: SELLER_CONTACT_ROLE,
      country: input.contact.country?.trim().toUpperCase() || null,
      stateRegion: input.contact.stateRegion?.trim() || null,
      city: input.contact.city?.trim() || null,
      postalCode: input.contact.postalCode?.trim() || null,
      actsAsBuyer: false,
      actsAsSeller: true,
      verificationState: "PENDING",
      verificationRequestedAt: submittedAt,
      serviceProcessingAcknowledgedAt: input.contact.serviceProcessingAcknowledgedAt,
      marketingConsentAt: null,
      createdAt: submittedAt,
      updatedAt: submittedAt,
    });

    await tx.insert(sellSubmissions).values({
      id: sellSubmissionId,
      publicReference: input.publicReference,
      contactId,
      submissionKind: input.submission.submissionKind,
      originalPartNumber,
      normalizedPartNumber,
      description,
      quantity,
      conditionCode: isBulk ? null : input.submission.conditionCode ?? null,
      askingUnitPrice,
      currencyCode,
      quoteOnRequest,
      estimatedLineItemCount: isBulk ? input.submission.estimatedLineItemCount ?? null : null,
      locationCountry: input.submission.locationCountry?.trim().toUpperCase() || null,
      locationStateRegion: input.submission.locationStateRegion?.trim() || null,
      locationCity: input.submission.locationCity?.trim() || null,
      locationPostalCode: input.submission.locationPostalCode?.trim() || null,
      canShipToNewJersey: input.submission.canShipToNewJersey ?? null,
      // No upload slice yet, so there is nothing a document summary could
      // describe. It stays null rather than being filled with intake prose.
      documentsSummary: null,
      status: "pending_verification",
      verificationRequestedAt: submittedAt,
      sourcePage: input.attribution.sourcePage,
      ...attribution,
      idempotencyHash: input.idempotencyHash,
      submittedAt,
      createdAt: submittedAt,
      updatedAt: submittedAt,
    });

    await tx.insert(emailVerificationTokens).values({
      id: tokenId,
      aggregateType: "sell_submission",
      aggregateId: sellSubmissionId,
      buyRequestId: null,
      sellSubmissionId,
      contactId,
      purpose: "SELL_SUBMISSION_CONTACT",
      keyedTokenHash: input.verificationToken.keyedTokenHash,
      tokenDerivationNonce: input.verificationToken.tokenDerivationNonce,
      issuedAt: submittedAt,
      expiresAt: input.verificationToken.expiresAt,
    });

    // Evidence is claimed in the same transaction as the submission it belongs
    // to. Either the offer and its attachments both exist, or neither does —
    // there is no window in which a seller's file is bound to a submission that
    // was never written, and none in which a submission references evidence
    // some other request claimed first.
    const attachmentInput = input.attachments ?? [];
    for (const attachment of attachmentInput) {
      const [claimed] = await tx
        .update(marketplacePendingUploads)
        .set({
          state: "BOUND",
          claimedSellSubmissionId: sellSubmissionId,
          updatedAt: submittedAt,
        })
        .where(and(
          eq(marketplacePendingUploads.id, attachment.pendingUploadId),
          eq(marketplacePendingUploads.uploadSessionId, attachment.uploadSessionId),
          inArray(marketplacePendingUploads.state, ["AUTHORIZED", "UPLOADED"]),
          isNull(marketplacePendingUploads.claimedBuyRequestId),
          isNull(marketplacePendingUploads.claimedSellSubmissionId),
        ))
        .returning({ id: marketplacePendingUploads.id });
      // A handle is single-use. A second attempt matches nothing, and aborting
      // here rolls back the whole submission rather than silently dropping the
      // evidence the seller believed they had attached.
      if (!claimed) throw new Error("MARKETPLACE_UPLOAD_HANDLE_ALREADY_USED");
    }

    if (attachmentInput.length > 0) {
      await tx.insert(marketplaceAttachments).values(attachmentInput.map((attachment) => ({
        id: attachment.id,
        aggregateType: "sell_submission" as const,
        aggregateId: sellSubmissionId,
        buyRequestId: null,
        sellSubmissionId,
        purpose: attachment.purpose as
          | "INVENTORY_SPREADSHEET"
          | "WAREHOUSE_BUSINESS_EVIDENCE"
          | "CUSTODY_PART_PHOTO"
          | "PART_NUMBER_SERIAL_PHOTO"
          | "RELEASE_SUPPORTING_DOCUMENT"
          | "OTHER",
        uploadedByType: "CONTACT" as const,
        displayFilename: attachment.displayFilename,
        objectKey: attachment.objectKey,
        storageProvider: "AWS_S3",
        declaredMime: attachment.declaredMime,
        detectedMime: attachment.detectedMime,
        byteSize: String(attachment.byteSize),
        contentDigest: null,
        // The scan tag was read and the signature verified before this
        // transaction opened. `quarantineReleasedAt` stays null regardless:
        // a clean scan means the object may be reviewed by staff, not that it
        // leaves the private quarantine namespace. Nothing here is ever public.
        scanState: "CLEAN" as const,
        quarantineReleasedAt: null,
        retentionClass: "MARKETPLACE_INTAKE_EVIDENCE" as const,
        sourcePendingUploadId: attachment.pendingUploadId,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      })));
    }

    await tx.insert(auditEvents).values([
      {
        id: generateOrderedId(),
        aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
        aggregateId: sellSubmissionId,
        actorType: "REQUESTER" as const,
        actorId: contactId,
        action: "SELL_SUBMISSION_SUBMITTED",
        afterVersionReference: "status:pending_verification",
        correlationId: input.correlationId,
        // Mode and source page only. A part number, a quantity, a price or a
        // location in an audit row would be a second copy of the offer.
        sanitizedMetadata: {
          submissionKind: input.submission.submissionKind,
          sourcePage: input.attribution.sourcePage,
        },
        createdAt: submittedAt,
      },
      {
        id: generateOrderedId(),
        aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
        aggregateId: sellSubmissionId,
        actorType: "REQUESTER" as const,
        actorId: contactId,
        action: "SELL_SUBMISSION_LEGAL_ACKNOWLEDGED",
        correlationId: input.correlationId,
        sanitizedMetadata: {
          privacyVersion: input.legalAcknowledgment.privacyVersion,
          termsVersion: input.legalAcknowledgment.termsVersion,
        },
        createdAt: input.legalAcknowledgment.acknowledgedAt,
      },
      {
        id: generateOrderedId(),
        aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
        aggregateId: sellSubmissionId,
        actorType: "SYSTEM" as const,
        actorId: null,
        action: "SELL_SUBMISSION_VERIFICATION_TOKEN_ISSUED",
        correlationId: input.correlationId,
        sanitizedMetadata: { expiresAt: input.verificationToken.expiresAt.toISOString() },
        createdAt: submittedAt,
      },
    ]);

    if (attachmentInput.length > 0) {
      // Identifier, purpose, type and size — never the seller's filename, and
      // never anything read from inside the file. The audit trail records that
      // evidence was attached, not what the evidence says.
      await tx.insert(auditEvents).values(attachmentInput.map((attachment) => ({
        id: generateOrderedId(),
        aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
        aggregateId: sellSubmissionId,
        actorType: "REQUESTER" as const,
        actorId: contactId,
        action: "SELL_SUBMISSION_ATTACHMENT_BOUND",
        correlationId: input.correlationId,
        sanitizedMetadata: {
          attachmentId: attachment.id,
          purpose: attachment.purpose,
          detectedMime: attachment.detectedMime,
          byteSize: attachment.byteSize,
          retentionClass: "MARKETPLACE_INTAKE_EVIDENCE",
        },
        createdAt: submittedAt,
      })));
    }

    const messages = await tx
      .insert(notificationOutbox)
      .values([
        {
          id: generateOrderedId(),
          messageType: SELL_SUBMISSION_VERIFY_MESSAGE_TYPE,
          aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
          aggregateId: sellSubmissionId,
          recipientReference: contactId,
          templateVersion: "sell-submission-verify-v1",
          idempotencyKey: `sell-submission-verify:${sellSubmissionId}:v1`,
          nextAttemptAt: submittedAt,
          createdAt: submittedAt,
        },
        {
          id: generateOrderedId(),
          messageType: SELL_SUBMISSION_INTERNAL_MESSAGE_TYPE,
          aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
          aggregateId: sellSubmissionId,
          recipientReference: INTERNAL_RECIPIENT_REFERENCE,
          templateVersion: "sell-submission-internal-v1",
          idempotencyKey: `sell-submission-internal:${sellSubmissionId}:v1`,
          nextAttemptAt: submittedAt,
          createdAt: submittedAt,
        },
      ])
      .onConflictDoNothing({ target: notificationOutbox.idempotencyKey })
      .returning({ id: notificationOutbox.id, messageType: notificationOutbox.messageType });

    if (messages.length !== 2) {
      throw new Error("Sell Submission notifications were not enqueued atomically.");
    }

    return {
      sellSubmissionId,
      contactId,
      tokenId,
      publicReference: input.publicReference,
      notificationIds: messages.map((message) => message.id),
      attachmentIds: attachmentInput.map((attachment) => attachment.id),
    };
  });
}

export async function findSellSubmissionByIdempotencyHash(
  db: PriceCheckDb,
  idempotencyHash: string,
) {
  const [existing] = await db
    .select({ id: sellSubmissions.id, publicReference: sellSubmissions.publicReference })
    .from(sellSubmissions)
    .where(eq(sellSubmissions.idempotencyHash, idempotencyHash))
    .limit(1);
  return existing ?? null;
}

/**
 * Everything the supplier verification email is allowed to know: where to send
 * it, the reference, the live token's nonce and its expiry. No part number,
 * quantity, price, currency, location or inventory detail is selected here, so
 * the template cannot leak what it was never given.
 */
export async function loadSellSubmissionVerification(db: PriceCheckDb, sellSubmissionId: string) {
  const [record] = await db
    .select({
      sellSubmissionId: sellSubmissions.id,
      publicReference: sellSubmissions.publicReference,
      status: sellSubmissions.status,
      businessEmail: marketplaceContacts.businessEmail,
      tokenId: emailVerificationTokens.id,
      tokenDerivationNonce: emailVerificationTokens.tokenDerivationNonce,
      expiresAt: emailVerificationTokens.expiresAt,
    })
    .from(sellSubmissions)
    .innerJoin(marketplaceContacts, eq(sellSubmissions.contactId, marketplaceContacts.id))
    .innerJoin(
      emailVerificationTokens,
      and(
        eq(emailVerificationTokens.sellSubmissionId, sellSubmissions.id),
        eq(emailVerificationTokens.contactId, marketplaceContacts.id),
        isNull(emailVerificationTokens.consumedAt),
        isNull(emailVerificationTokens.revokedAt),
      ),
    )
    .where(eq(sellSubmissions.id, sellSubmissionId))
    .limit(1);
  if (!record) throw new Error("SELL_SUBMISSION_VERIFICATION_UNAVAILABLE");
  return record;
}

/** Reference and status only: the internal notice carries no offer content. */
export async function loadSellSubmissionNotice(db: PriceCheckDb, sellSubmissionId: string) {
  const [record] = await db
    .select({
      id: sellSubmissions.id,
      publicReference: sellSubmissions.publicReference,
      status: sellSubmissions.status,
      submittedAt: sellSubmissions.submittedAt,
    })
    .from(sellSubmissions)
    .where(eq(sellSubmissions.id, sellSubmissionId))
    .limit(1);
  if (!record) throw new Error("SELL_SUBMISSION_NOTICE_UNAVAILABLE");
  return record;
}

/**
 * Completes one Sell Submission outbox row under the caller's lease and records
 * the delivery. Losing the lease is an error, not a silent success, so a message
 * cannot be marked sent by a worker that no longer owns it.
 */
export async function markSellSubmissionNotificationSucceeded(
  db: PriceCheckDb,
  input: {
    sellSubmissionId: string;
    notificationId: string;
    messageType: string;
    leaseOwner: string;
    providerMessageId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [completed] = await tx
      .update(notificationOutbox)
      .set({
        state: "succeeded",
        sentAt: now,
        providerMessageId: input.providerMessageId,
        leaseOwner: null,
        leaseExpiresAt: null,
        sanitizedFailureCode: null,
      })
      .where(
        and(
          eq(notificationOutbox.id, input.notificationId),
          eq(notificationOutbox.aggregateId, input.sellSubmissionId),
          eq(notificationOutbox.state, "running"),
          eq(notificationOutbox.leaseOwner, input.leaseOwner),
        ),
      )
      .returning({ id: notificationOutbox.id });
    if (!completed) throw new Error("SELL_SUBMISSION_DELIVERY_LEASE_LOST");

    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: input.sellSubmissionId,
      actorType: "WORKER",
      actorId: null,
      action: "SELL_SUBMISSION_NOTIFICATION_SENT",
      correlationId: `sell-submission-notification:${input.notificationId}`,
      sanitizedMetadata: { messageType: input.messageType, provider: "postmark" },
      createdAt: now,
    });
  });
}

export async function recordSellSubmissionNotificationFailure(
  db: PriceCheckDb,
  input: {
    sellSubmissionId: string;
    notificationId: string;
    messageType: string;
    code: string;
    deadLetter: boolean;
    now?: Date;
  },
) {
  await db.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
    aggregateId: input.sellSubmissionId,
    actorType: "WORKER",
    actorId: null,
    action: "SELL_SUBMISSION_NOTIFICATION_FAILED",
    correlationId: `sell-submission-notification:${input.notificationId}`,
    sanitizedMetadata: {
      messageType: input.messageType,
      code: input.code,
      deadLetter: input.deadLetter,
    },
    createdAt: input.now ?? new Date(),
  });
}

export type SellSubmissionVerificationOutcome =
  | { outcome: "verified"; reference: string }
  | { outcome: "already_verified"; reference: string }
  | { outcome: "unavailable" };

/**
 * Redeems a verification credential by its keyed hash.
 *
 * Every rejection path returns the same opaque `unavailable`, so a caller
 * guessing token values learns nothing about which submissions exist. A repeat
 * click by the legitimate holder is `already_verified`, which a caller without
 * the credential can never reach, and which the surface renders identically to
 * a first success.
 *
 * The join is to `sell_submissions` and the token must name the sell aggregate
 * and the sell purpose, so a Buy Request credential presented here can only
 * ever be `unavailable` — the two aggregates never activate each other.
 */
export async function redeemSellSubmissionVerification(
  db: PriceCheckDb,
  input: { keyedTokenHash: string; now?: Date },
): Promise<SellSubmissionVerificationOutcome> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ token: emailVerificationTokens, submission: sellSubmissions })
      .from(emailVerificationTokens)
      .innerJoin(sellSubmissions, eq(emailVerificationTokens.sellSubmissionId, sellSubmissions.id))
      .where(eq(emailVerificationTokens.keyedTokenHash, input.keyedTokenHash))
      .limit(1);
    if (!record) return { outcome: "unavailable" };

    const { token, submission } = record;
    const revoke = async () => {
      await tx
        .update(emailVerificationTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(emailVerificationTokens.id, token.id),
            isNull(emailVerificationTokens.consumedAt),
            isNull(emailVerificationTokens.revokedAt),
          ),
        );
    };

    // The token must name exactly this submission and exactly this submission's
    // contact. A mismatch is a malformed row, never an activation opportunity.
    if (
      token.aggregateType !== "sell_submission"
      || token.aggregateId !== submission.id
      || token.contactId !== submission.contactId
      || token.purpose !== "SELL_SUBMISSION_CONTACT"
    ) {
      return { outcome: "unavailable" };
    }
    if (token.consumedAt) {
      return submission.verifiedAt
        ? { outcome: "already_verified", reference: submission.publicReference }
        : { outcome: "unavailable" };
    }
    if (token.revokedAt) return { outcome: "unavailable" };
    if (token.expiresAt <= now) {
      await revoke();
      return { outcome: "unavailable" };
    }
    if (token.attemptCount + 1 > token.maxAttemptCount) {
      await revoke();
      return { outcome: "unavailable" };
    }
    // Staff may have already closed, declined or spam-marked the submission.
    // Verification must not resurrect it.
    if (submission.status !== "pending_verification") {
      await revoke();
      return { outcome: "unavailable" };
    }

    const [consumed] = await tx
      .update(emailVerificationTokens)
      .set({ consumedAt: now, attemptCount: token.attemptCount + 1 })
      .where(
        and(
          eq(emailVerificationTokens.id, token.id),
          eq(emailVerificationTokens.attemptCount, token.attemptCount),
          isNull(emailVerificationTokens.consumedAt),
          isNull(emailVerificationTokens.revokedAt),
        ),
      )
      .returning({ id: emailVerificationTokens.id });
    if (!consumed) return { outcome: "unavailable" };

    const [activated] = await tx
      .update(sellSubmissions)
      .set({ status: "verified", verifiedAt: now, updatedAt: now })
      .where(
        and(
          eq(sellSubmissions.id, submission.id),
          eq(sellSubmissions.status, "pending_verification"),
        ),
      )
      .returning({ publicReference: sellSubmissions.publicReference });
    if (!activated) throw new Error("SELL_SUBMISSION_VERIFICATION_CONFLICT");

    // Exactly the contact this submission names, and only its seller role.
    await tx
      .update(marketplaceContacts)
      .set({
        verificationState: "VERIFIED",
        verifiedAt: now,
        actsAsSeller: true,
        updatedAt: now,
      })
      .where(eq(marketplaceContacts.id, submission.contactId));

    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: submission.id,
      actorType: "SYSTEM",
      actorId: null,
      action: "SELL_SUBMISSION_CONTACT_VERIFIED",
      beforeVersionReference: "status:pending_verification",
      afterVersionReference: "status:verified",
      correlationId: `sell-submission-verification:${token.id}`,
      sanitizedMetadata: { tokenId: token.id },
      createdAt: now,
    });

    return { outcome: "verified", reference: activated.publicReference };
  });
}
