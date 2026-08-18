import "../server-boundary.ts";

import { and, eq, isNull } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import {
  auditEvents,
  buyRequests,
  emailVerificationTokens,
  marketplaceContacts,
  notificationOutbox,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  normalizeEmail,
  normalizePartNumber,
  normalizePhone,
  sanitizeAttribution,
} from "../domain/normalization.ts";

export const BUY_REQUEST_VERIFY_MESSAGE_TYPE = "BUY_REQUEST_VERIFY_EMAIL";
export const BUY_REQUEST_INTERNAL_MESSAGE_TYPE = "BUY_REQUEST_INTERNAL_RECEIVED";
export const BUY_REQUEST_AGGREGATE_TYPE = "buy_request";

/** Operational routing label. Deliberately not a customer or staff address. */
const INTERNAL_RECIPIENT_REFERENCE = "civilon-marketplace-internal";

export type CreateBuyRequestInput = {
  contact: {
    firstName: string;
    lastName: string;
    companyName: string;
    businessEmail: string;
    phone?: string | null;
    country?: string | null;
    serviceProcessingAcknowledgedAt: Date;
  };
  request: {
    originalPartNumber?: string | null;
    description?: string | null;
    quantity: string;
    acceptableCondition: "NOT_SURE" | "ANY" | "NE" | "NS" | "OH" | "SV" | "AR";
    urgency: "not_sure" | "aog" | "critical" | "standard" | "planned";
    neededByDate?: string | null;
    aircraftModel?: string | null;
    applicationNotes?: string | null;
    deliveryCountry?: string | null;
    deliveryPostalCode?: string | null;
    deliveryCity?: string | null;
    fulfillmentPreference: "not_sure" | "door_delivery" | "port_of_entry" | "nj_pickup";
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
  idempotencyHash: string;
  correlationId: string;
  publicReference: string;
  submittedAt?: Date;
};

/**
 * Persists a Buy Request and everything the workflow depends on in one
 * transaction: the contact, the pending request, the single live verification
 * token, the submission audit trail, and both outbox messages.
 *
 * The outbox rows are written here rather than after commit precisely so that
 * admin visibility never depends on email. Either the request and its
 * notifications exist together, or neither does; a provider outage later can
 * only delay delivery, never remove the request.
 */
export async function createBuyRequest(db: PriceCheckDb, input: CreateBuyRequestInput) {
  const contactId = generateOrderedId();
  const buyRequestId = generateOrderedId();
  const tokenId = generateOrderedId();
  const submittedAt = input.submittedAt ?? new Date();
  const attribution = sanitizeAttribution(input.attribution);
  const originalPartNumber = input.request.originalPartNumber?.trim() || null;
  const normalizedPartNumber = originalPartNumber ? normalizePartNumber(originalPartNumber) : null;
  const description = input.request.description?.trim() || null;
  if (!originalPartNumber && !description) {
    throw new Error("A Buy Request requires a part number or a description.");
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
      country: input.contact.country?.trim().toUpperCase() || null,
      actsAsBuyer: true,
      actsAsSeller: false,
      verificationState: "PENDING",
      verificationRequestedAt: submittedAt,
      serviceProcessingAcknowledgedAt: input.contact.serviceProcessingAcknowledgedAt,
      marketingConsentAt: null,
      createdAt: submittedAt,
      updatedAt: submittedAt,
    });

    await tx.insert(buyRequests).values({
      id: buyRequestId,
      publicReference: input.publicReference,
      contactId,
      originalPartNumber,
      normalizedPartNumber,
      description,
      quantity: input.request.quantity,
      acceptableCondition: input.request.acceptableCondition,
      urgency: input.request.urgency,
      neededByDate: input.request.neededByDate ?? null,
      aircraftModel: input.request.aircraftModel?.trim() || null,
      applicationNotes: input.request.applicationNotes?.trim() || null,
      deliveryCountry: input.request.deliveryCountry?.trim().toUpperCase() || null,
      deliveryPostalCode: input.request.deliveryPostalCode?.trim() || null,
      deliveryCity: input.request.deliveryCity?.trim() || null,
      fulfillmentPreference: input.request.fulfillmentPreference,
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
      aggregateType: "buy_request",
      aggregateId: buyRequestId,
      buyRequestId,
      sellSubmissionId: null,
      contactId,
      purpose: "BUY_REQUEST_CONTACT",
      keyedTokenHash: input.verificationToken.keyedTokenHash,
      tokenDerivationNonce: input.verificationToken.tokenDerivationNonce,
      issuedAt: submittedAt,
      expiresAt: input.verificationToken.expiresAt,
    });

    await tx.insert(auditEvents).values([
      {
        id: generateOrderedId(),
        aggregateType: BUY_REQUEST_AGGREGATE_TYPE,
        aggregateId: buyRequestId,
        actorType: "REQUESTER" as const,
        actorId: contactId,
        action: "BUY_REQUEST_SUBMITTED",
        afterVersionReference: "status:pending_verification",
        correlationId: input.correlationId,
        sanitizedMetadata: { sourcePage: input.attribution.sourcePage },
        createdAt: submittedAt,
      },
      {
        id: generateOrderedId(),
        aggregateType: BUY_REQUEST_AGGREGATE_TYPE,
        aggregateId: buyRequestId,
        actorType: "REQUESTER" as const,
        actorId: contactId,
        action: "BUY_REQUEST_LEGAL_ACKNOWLEDGED",
        correlationId: input.correlationId,
        sanitizedMetadata: {
          privacyVersion: input.legalAcknowledgment.privacyVersion,
          termsVersion: input.legalAcknowledgment.termsVersion,
        },
        createdAt: input.legalAcknowledgment.acknowledgedAt,
      },
      {
        id: generateOrderedId(),
        aggregateType: BUY_REQUEST_AGGREGATE_TYPE,
        aggregateId: buyRequestId,
        actorType: "SYSTEM" as const,
        actorId: null,
        action: "BUY_REQUEST_VERIFICATION_TOKEN_ISSUED",
        correlationId: input.correlationId,
        sanitizedMetadata: { expiresAt: input.verificationToken.expiresAt.toISOString() },
        createdAt: submittedAt,
      },
    ]);

    const messages = await tx
      .insert(notificationOutbox)
      .values([
        {
          id: generateOrderedId(),
          messageType: BUY_REQUEST_VERIFY_MESSAGE_TYPE,
          aggregateType: BUY_REQUEST_AGGREGATE_TYPE,
          aggregateId: buyRequestId,
          recipientReference: contactId,
          templateVersion: "buy-request-verify-v1",
          idempotencyKey: `buy-request-verify:${buyRequestId}:v1`,
          nextAttemptAt: submittedAt,
          createdAt: submittedAt,
        },
        {
          id: generateOrderedId(),
          messageType: BUY_REQUEST_INTERNAL_MESSAGE_TYPE,
          aggregateType: BUY_REQUEST_AGGREGATE_TYPE,
          aggregateId: buyRequestId,
          recipientReference: INTERNAL_RECIPIENT_REFERENCE,
          templateVersion: "buy-request-internal-v1",
          idempotencyKey: `buy-request-internal:${buyRequestId}:v1`,
          nextAttemptAt: submittedAt,
          createdAt: submittedAt,
        },
      ])
      .onConflictDoNothing({ target: notificationOutbox.idempotencyKey })
      .returning({ id: notificationOutbox.id, messageType: notificationOutbox.messageType });

    if (messages.length !== 2) {
      throw new Error("Buy Request notifications were not enqueued atomically.");
    }

    return {
      buyRequestId,
      contactId,
      tokenId,
      publicReference: input.publicReference,
      notificationIds: messages.map((message) => message.id),
    };
  });
}

export async function findBuyRequestByIdempotencyHash(db: PriceCheckDb, idempotencyHash: string) {
  const [existing] = await db
    .select({ id: buyRequests.id, publicReference: buyRequests.publicReference })
    .from(buyRequests)
    .where(eq(buyRequests.idempotencyHash, idempotencyHash))
    .limit(1);
  return existing ?? null;
}

/**
 * Everything the customer verification email is allowed to know: where to send
 * it, the reference, the live token's nonce and its expiry. No part number,
 * quantity, urgency, delivery detail or note is selected here, so the template
 * cannot leak what it was never given.
 */
export async function loadBuyRequestVerification(db: PriceCheckDb, buyRequestId: string) {
  const [record] = await db
    .select({
      buyRequestId: buyRequests.id,
      publicReference: buyRequests.publicReference,
      status: buyRequests.status,
      businessEmail: marketplaceContacts.businessEmail,
      tokenId: emailVerificationTokens.id,
      tokenDerivationNonce: emailVerificationTokens.tokenDerivationNonce,
      expiresAt: emailVerificationTokens.expiresAt,
    })
    .from(buyRequests)
    .innerJoin(marketplaceContacts, eq(buyRequests.contactId, marketplaceContacts.id))
    .innerJoin(
      emailVerificationTokens,
      and(
        eq(emailVerificationTokens.buyRequestId, buyRequests.id),
        eq(emailVerificationTokens.contactId, marketplaceContacts.id),
        isNull(emailVerificationTokens.consumedAt),
        isNull(emailVerificationTokens.revokedAt),
      ),
    )
    .where(eq(buyRequests.id, buyRequestId))
    .limit(1);
  if (!record) throw new Error("BUY_REQUEST_VERIFICATION_UNAVAILABLE");
  return record;
}

/** Reference and status only: the internal notice carries no request content. */
export async function loadBuyRequestNotice(db: PriceCheckDb, buyRequestId: string) {
  const [record] = await db
    .select({
      id: buyRequests.id,
      publicReference: buyRequests.publicReference,
      status: buyRequests.status,
      submittedAt: buyRequests.submittedAt,
    })
    .from(buyRequests)
    .where(eq(buyRequests.id, buyRequestId))
    .limit(1);
  if (!record) throw new Error("BUY_REQUEST_NOTICE_UNAVAILABLE");
  return record;
}

/**
 * Completes one Buy Request outbox row under the caller's lease and records the
 * delivery. Losing the lease is an error, not a silent success, so a message
 * cannot be marked sent by a worker that no longer owns it.
 */
export async function markBuyRequestNotificationSucceeded(
  db: PriceCheckDb,
  input: {
    buyRequestId: string;
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
          eq(notificationOutbox.aggregateId, input.buyRequestId),
          eq(notificationOutbox.state, "running"),
          eq(notificationOutbox.leaseOwner, input.leaseOwner),
        ),
      )
      .returning({ id: notificationOutbox.id });
    if (!completed) throw new Error("BUY_REQUEST_DELIVERY_LEASE_LOST");

    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: BUY_REQUEST_AGGREGATE_TYPE,
      aggregateId: input.buyRequestId,
      actorType: "WORKER",
      actorId: null,
      action: "BUY_REQUEST_NOTIFICATION_SENT",
      correlationId: `buy-request-notification:${input.notificationId}`,
      sanitizedMetadata: { messageType: input.messageType, provider: "postmark" },
      createdAt: now,
    });
  });
}

export async function recordBuyRequestNotificationFailure(
  db: PriceCheckDb,
  input: {
    buyRequestId: string;
    notificationId: string;
    messageType: string;
    code: string;
    deadLetter: boolean;
    now?: Date;
  },
) {
  await db.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: BUY_REQUEST_AGGREGATE_TYPE,
    aggregateId: input.buyRequestId,
    actorType: "WORKER",
    actorId: null,
    action: "BUY_REQUEST_NOTIFICATION_FAILED",
    correlationId: `buy-request-notification:${input.notificationId}`,
    sanitizedMetadata: {
      messageType: input.messageType,
      code: input.code,
      deadLetter: input.deadLetter,
    },
    createdAt: input.now ?? new Date(),
  });
}

export type BuyRequestVerificationOutcome =
  | { outcome: "verified"; reference: string }
  | { outcome: "already_verified"; reference: string }
  | { outcome: "unavailable" };

/**
 * Redeems a verification credential by its keyed hash.
 *
 * Every rejection path returns the same opaque `unavailable`, so a caller
 * guessing token values learns nothing about which requests exist. A repeat
 * click by the legitimate holder is `already_verified`, which a caller without
 * the credential can never reach, and which the surface renders identically to
 * a first success.
 */
export async function redeemBuyRequestVerification(
  db: PriceCheckDb,
  input: { keyedTokenHash: string; now?: Date },
): Promise<BuyRequestVerificationOutcome> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ token: emailVerificationTokens, request: buyRequests })
      .from(emailVerificationTokens)
      .innerJoin(buyRequests, eq(emailVerificationTokens.buyRequestId, buyRequests.id))
      .where(eq(emailVerificationTokens.keyedTokenHash, input.keyedTokenHash))
      .limit(1);
    if (!record) return { outcome: "unavailable" };

    const { token, request } = record;
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

    // The token must name exactly this request and exactly this request's
    // contact. A mismatch is a malformed row, never an activation opportunity.
    if (
      token.aggregateType !== "buy_request"
      || token.aggregateId !== request.id
      || token.contactId !== request.contactId
      || token.purpose !== "BUY_REQUEST_CONTACT"
    ) {
      return { outcome: "unavailable" };
    }
    if (token.consumedAt) {
      return request.verifiedAt
        ? { outcome: "already_verified", reference: request.publicReference }
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
    // Staff may have already closed the request. Verification must not resurrect it.
    if (request.status !== "pending_verification") {
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
      .update(buyRequests)
      .set({ status: "verified", verifiedAt: now, updatedAt: now })
      .where(and(eq(buyRequests.id, request.id), eq(buyRequests.status, "pending_verification")))
      .returning({ publicReference: buyRequests.publicReference });
    if (!activated) throw new Error("BUY_REQUEST_VERIFICATION_CONFLICT");

    await tx
      .update(marketplaceContacts)
      .set({
        verificationState: "VERIFIED",
        verifiedAt: now,
        actsAsBuyer: true,
        updatedAt: now,
      })
      .where(eq(marketplaceContacts.id, request.contactId));

    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: BUY_REQUEST_AGGREGATE_TYPE,
      aggregateId: request.id,
      actorType: "SYSTEM",
      actorId: null,
      action: "BUY_REQUEST_CONTACT_VERIFIED",
      beforeVersionReference: "status:pending_verification",
      afterVersionReference: "status:verified",
      correlationId: `buy-request-verification:${token.id}`,
      sanitizedMetadata: { tokenId: token.id },
      createdAt: now,
    });

    return { outcome: "verified", reference: activated.publicReference };
  });
}
