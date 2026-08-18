import "../server-boundary.ts";

import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import {
  auditEvents,
  buyRequests,
  buyerOffers,
  marketplaceContacts,
  notificationOutbox,
  supplierResponses,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  BUYER_OFFER_DRAFTED_ACTION,
  BUYER_OFFER_DRAFT_REPLACED_ACTION,
  BUYER_OFFER_AGGREGATE_TYPE,
  BUYER_OFFER_BUYER_RESPONDED_ACTION,
  BUYER_OFFER_DELIVERY_MESSAGE_TYPE,
  BUYER_OFFER_DELIVERY_QUEUED_ACTION,
  BUYER_OFFER_NOTIFICATION_FAILED_ACTION,
  BUYER_OFFER_NOTIFICATION_SENT_ACTION,
  BUYER_OFFER_RESPONSE_MESSAGE_TYPE,
  BUYER_OFFER_STATUS_ACTION,
  BUYER_OFFER_SUPERSEDED_ACTION,
  DEFAULT_BUYER_OFFER_STATUS,
  buyerOfferTimestampFor,
  canTransitionBuyerOffer,
  type BuyerOfferStatusValue,
} from "../domain/buyer-offer-policy.ts";

/**
 * Civilon's own offer to the buyer: the resale side.
 *
 * It never reads a supplier cost, never updates a supplier response and never
 * moves the Buy Request. Delivery and response notices use the shared outbox,
 * but every buyer-facing read is a deliberately supplier-free projection.
 */

export type BuyerOfferActor = { id: string; role: string };

export type BuyerOfferOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_found" }
  /** The chosen supplier response belongs to a different Buy Request. */
  | { ok: false; reason: "supplier_response_unavailable" }
  | { ok: false; reason: "conflict"; currentStatus: string }
  | { ok: false; reason: "forbidden_transition" }
  | { ok: false; reason: "buyer_unverified" }
  | { ok: false; reason: "expiry_required" }
  /** An expiry that is already past cannot survive `buyer_offers_expiry_chk`. */
  | { ok: false; reason: "expiry_in_past" };

export type BuyerOfferWriteInput = {
  civilonSaleUnitPrice: string;
  currencyCode: string;
  quantity: string;
  statedCondition: string | null;
  documentsSummary: string | null;
  deliveryOption: string;
  shippingAndExportScope: string | null;
  leadTimeDays: number | null;
  expiresAt: Date | null;
  selectedSupplierResponseId: string | null;
};

async function appendAudit(
  tx: Parameters<Parameters<PriceCheckDb["transaction"]>[0]>[0],
  input: {
    buyRequestId: string;
    actorId?: string | null;
    actorType?: "ADMIN" | "SYSTEM" | "WORKER";
    action: string;
    metadata: Record<string, unknown>;
    before?: string | null;
    after?: string | null;
    now?: Date;
  },
) {
  await tx.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: "buy_request",
    aggregateId: input.buyRequestId,
    actorType: input.actorType ?? "ADMIN",
    actorId: input.actorId ?? null,
    action: input.action,
    beforeVersionReference: input.before ?? null,
    afterVersionReference: input.after ?? null,
    correlationId: `${input.action}:${crypto.randomUUID()}`,
    sanitizedMetadata: input.metadata,
    createdAt: input.now,
  });
}

export type CreatedBuyerOffer = {
  buyerOfferId: string;
  version: number;
  /** The unsent working draft this one replaced, if there was one. */
  replacedDraftId: string | null;
};

/**
 * Drafts a new Civilon offer.
 *
 * Versioning: the next version is `max(version) + 1` over every row for this
 * Buy Request, computed and inserted inside one transaction. The schema's
 * `buyer_offers_version_uidx` on `(buy_request_id, version)` is the arbiter — a
 * concurrent second writer collides there and its transaction fails rather than
 * quietly reusing a version.
 *
 * What happens to earlier offers:
 *
 *  - A **sent** offer is left exactly as it is. The buyer is still holding it,
 *    and this draft may never be sent; marking it superseded now would record a
 *    replacement that has not happened. Superseding is done by
 *    `changeBuyerOfferStatus` at the moment the replacement is actually sent.
 *  - An **unsent draft** is replaced. A draft is a working document that no
 *    buyer has seen, and the schema gives it nowhere to go: every status other
 *    than `draft` requires a `sent_at`, so a draft cannot be withdrawn or
 *    superseded without stamping a send that never happened. The replacement is
 *    recorded in the append-only audit trail even though the draft row is gone.
 *  - An **accepted, declined, expired, withdrawn or already superseded** offer
 *    is left exactly as it is. Accepted history is never rewritten.
 */
export async function createBuyerOffer(
  db: PriceCheckDb,
  input: { buyRequestId: string; offer: BuyerOfferWriteInput; actor: BuyerOfferActor; now?: Date },
): Promise<BuyerOfferOutcome<CreatedBuyerOffer>> {
  const now = input.now ?? new Date();

  const [parent] = await db.select({ id: buyRequests.id })
    .from(buyRequests).where(eq(buyRequests.id, input.buyRequestId)).limit(1);
  if (!parent) return { ok: false, reason: "not_found" };

  // The internal pointer must belong to this Buy Request. A response from
  // another request is not a choice a staff member could have meant.
  if (input.offer.selectedSupplierResponseId) {
    const [response] = await db.select({ id: supplierResponses.id })
      .from(supplierResponses)
      .where(and(
        eq(supplierResponses.id, input.offer.selectedSupplierResponseId),
        eq(supplierResponses.buyRequestId, input.buyRequestId),
      ))
      .limit(1);
    if (!response) return { ok: false, reason: "supplier_response_unavailable" };
  }

  const buyerOfferId = generateOrderedId();
  return db.transaction(async (tx) => {
    const existing = await tx.select({
      id: buyerOffers.id,
      version: buyerOffers.version,
      status: buyerOffers.status,
    }).from(buyerOffers)
      .where(eq(buyerOffers.buyRequestId, input.buyRequestId))
      .orderBy(desc(buyerOffers.version));

    const nextVersion = existing.reduce((highest, row) => Math.max(highest, row.version), 0) + 1;

    let replacedDraftId: string | null = null;
    const draft = existing.find((row) => row.status === "draft");
    if (draft) {
      await tx.delete(buyerOffers).where(and(eq(buyerOffers.id, draft.id), eq(buyerOffers.status, "draft")));
      replacedDraftId = draft.id;
      await appendAudit(tx, {
        buyRequestId: input.buyRequestId,
        actorId: input.actor.id,
        action: BUYER_OFFER_DRAFT_REPLACED_ACTION,
        metadata: { buyerOfferId: draft.id, version: draft.version, replacedByVersion: nextVersion },
      });
    }

    await tx.insert(buyerOffers).values({
      id: buyerOfferId,
      buyRequestId: input.buyRequestId,
      selectedSupplierResponseId: input.offer.selectedSupplierResponseId,
      version: nextVersion,
      civilonSaleUnitPrice: input.offer.civilonSaleUnitPrice,
      currencyCode: input.offer.currencyCode,
      quantity: input.offer.quantity,
      statedCondition: input.offer.statedCondition as typeof buyerOffers.statedCondition.enumValues[number] | null,
      documentsSummary: input.offer.documentsSummary,
      deliveryOption: input.offer.deliveryOption as typeof buyerOffers.deliveryOption.enumValues[number],
      shippingAndExportScope: input.offer.shippingAndExportScope,
      leadTimeDays: input.offer.leadTimeDays,
      status: DEFAULT_BUYER_OFFER_STATUS,
      createdByAdminUserId: input.actor.id,
      expiresAt: input.offer.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    // Minimal metadata: which offer, which version, which buyer-facing delivery
    // option. Not the price, not the supplier pointer, not the buyer.
    await appendAudit(tx, {
      buyRequestId: input.buyRequestId,
      actorId: input.actor.id,
      action: BUYER_OFFER_DRAFTED_ACTION,
      metadata: {
        buyerOfferId,
        version: nextVersion,
        deliveryOption: input.offer.deliveryOption,
      },
    });

    return { ok: true as const, data: { buyerOfferId, version: nextVersion, replacedDraftId } };
  });
}

/**
 * Moves an offer through the graph.
 *
 * This low-level graph remains useful for internal expiry/withdrawal and tests.
 * The admin route cannot use it for `sent`, `accepted` or `declined`: delivery
 * and buyer response now have dedicated, outbox-backed mutations below.
 *
 * Sending is also the moment any earlier offer stops being the live one. Once
 * this row is fenced into `sent`, every other `sent` offer on the same Buy
 * Request is superseded in the same transaction: the buyer now holds this
 * version, so the previous one is genuinely replaced. Their `sent_at` and all
 * their terms are preserved; only the status and `superseded_at` change. A
 * stale or failed send supersedes nothing, because the fenced update runs first
 * and returns before any of this.
 */
export async function changeBuyerOfferStatus(
  db: PriceCheckDb,
  input: {
    buyRequestId: string;
    buyerOfferId: string;
    expectedStatus: string;
    to: string;
    actor: BuyerOfferActor;
    now?: Date;
  },
): Promise<BuyerOfferOutcome<{ from: string; to: string }>> {
  const now = input.now ?? new Date();

  const [current] = await db.select({
    id: buyerOffers.id,
    status: buyerOffers.status,
    version: buyerOffers.version,
    expiresAt: buyerOffers.expiresAt,
  }).from(buyerOffers)
    .where(and(
      eq(buyerOffers.id, input.buyerOfferId),
      eq(buyerOffers.buyRequestId, input.buyRequestId),
    ))
    .limit(1);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== input.expectedStatus) {
    return { ok: false, reason: "conflict", currentStatus: current.status };
  }
  if (!canTransitionBuyerOffer(current.status, input.to)) {
    return { ok: false, reason: "forbidden_transition" };
  }
  // `buyer_offers_expiry_chk` requires `expires_at > sent_at`. An expiry that
  // has already passed would fail there; say so instead of throwing.
  if (input.to === "sent" && current.expiresAt && current.expiresAt.valueOf() <= now.valueOf()) {
    return { ok: false, reason: "expiry_in_past" };
  }

  const stamp = buyerOfferTimestampFor(input.to);
  return db.transaction(async (tx) => {
    const updated = await tx.update(buyerOffers)
      .set({
        status: input.to as BuyerOfferStatusValue,
        updatedAt: now,
        ...(stamp === "sentAt" ? { sentAt: now } : {}),
        ...(stamp === "respondedAt" ? { respondedAt: now } : {}),
        ...(stamp === "supersededAt" ? { supersededAt: now } : {}),
      })
      .where(and(
        eq(buyerOffers.id, input.buyerOfferId),
        eq(buyerOffers.buyRequestId, input.buyRequestId),
        eq(buyerOffers.status, current.status as BuyerOfferStatusValue),
      ))
      .returning({ id: buyerOffers.id });
    if (!updated.length) {
      // Someone else moved this offer between the read and the write. Nothing
      // has been superseded, because nothing has been sent.
      return { ok: false as const, reason: "conflict" as const, currentStatus: current.status };
    }

    if (input.to === "sent") {
      const replaced = await tx.select({ id: buyerOffers.id, version: buyerOffers.version })
        .from(buyerOffers)
        .where(and(
          eq(buyerOffers.buyRequestId, input.buyRequestId),
          eq(buyerOffers.status, "sent"),
          ne(buyerOffers.id, input.buyerOfferId),
        ));
      for (const previous of replaced) {
        await tx.update(buyerOffers)
          .set({ status: "superseded", supersededAt: now, updatedAt: now })
          .where(and(
            eq(buyerOffers.id, previous.id),
            eq(buyerOffers.buyRequestId, input.buyRequestId),
            eq(buyerOffers.status, "sent"),
          ));
        await appendAudit(tx, {
          buyRequestId: input.buyRequestId,
          actorId: input.actor.id,
          action: BUYER_OFFER_SUPERSEDED_ACTION,
          metadata: {
            buyerOfferId: previous.id,
            version: previous.version,
            supersededByVersion: current.version,
          },
        });
      }
    }

    await appendAudit(tx, {
      buyRequestId: input.buyRequestId,
      actorId: input.actor.id,
      action: BUYER_OFFER_STATUS_ACTION,
      metadata: {
        buyerOfferId: input.buyerOfferId,
        version: current.version,
        from: current.status,
        to: input.to,
      },
    });

    return { ok: true as const, data: { from: current.status, to: input.to } };
  });
}

const INTERNAL_RECIPIENT_REFERENCE = "civilon-marketplace-internal";

export type BuyerOfferCustomerRecord = {
  buyerOfferId: string;
  buyRequestId: string;
  businessEmail: string;
  reference: string;
  version: number;
  civilonSaleUnitPrice: string;
  currencyCode: string;
  quantity: string;
  statedCondition: string | null;
  documentsSummary: string | null;
  deliveryOption: typeof buyerOffers.deliveryOption.enumValues[number];
  shippingAndExportScope: string | null;
  leadTimeDays: number | null;
  sentAt: Date;
  expiresAt: Date;
  status: "sent" | "accepted" | "declined";
  respondedAt: Date | null;
};

/**
 * Sends one exact draft through Civilon's own outbox.
 *
 * The offer transition, superseding of an earlier live version, delivery row,
 * and both audit events commit together. A provider outage can delay the email,
 * but it cannot leave an unaudited send or a sent offer with no delivery job.
 */
export async function queueBuyerOfferDelivery(
  db: PriceCheckDb,
  input: {
    buyRequestId: string;
    buyerOfferId: string;
    expectedStatus: "draft";
    actor: BuyerOfferActor;
    now?: Date;
  },
): Promise<BuyerOfferOutcome<{ notificationId: string; version: number }>> {
  const now = input.now ?? new Date();
  if (!(input.actor.role === "REVIEWER" || input.actor.role === "ADMIN")) {
    return { ok: false, reason: "forbidden_transition" };
  }
  return db.transaction(async (tx) => {
    const [record] = await tx.select({
      id: buyerOffers.id,
      version: buyerOffers.version,
      status: buyerOffers.status,
      expiresAt: buyerOffers.expiresAt,
      contactId: marketplaceContacts.id,
      contactVerificationState: marketplaceContacts.verificationState,
      requestVerifiedAt: buyRequests.verifiedAt,
    }).from(buyerOffers)
      .innerJoin(buyRequests, eq(buyerOffers.buyRequestId, buyRequests.id))
      .innerJoin(marketplaceContacts, eq(buyRequests.contactId, marketplaceContacts.id))
      .where(and(
        eq(buyerOffers.id, input.buyerOfferId),
        eq(buyerOffers.buyRequestId, input.buyRequestId),
      ))
      .limit(1);
    if (!record) return { ok: false as const, reason: "not_found" as const };
    if (record.status !== input.expectedStatus) {
      return { ok: false as const, reason: "conflict" as const, currentStatus: record.status };
    }
    if (record.contactVerificationState !== "VERIFIED" || !record.requestVerifiedAt) {
      return { ok: false as const, reason: "buyer_unverified" as const };
    }
    if (!record.expiresAt) return { ok: false as const, reason: "expiry_required" as const };
    if (record.expiresAt.valueOf() <= now.valueOf()) {
      return { ok: false as const, reason: "expiry_in_past" as const };
    }

    const [sent] = await tx.update(buyerOffers)
      .set({ status: "sent", sentAt: now, updatedAt: now })
      .where(and(
        eq(buyerOffers.id, input.buyerOfferId),
        eq(buyerOffers.buyRequestId, input.buyRequestId),
        eq(buyerOffers.status, "draft"),
      ))
      .returning({ id: buyerOffers.id });
    if (!sent) {
      return { ok: false as const, reason: "conflict" as const, currentStatus: record.status };
    }

    const earlier = await tx.select({ id: buyerOffers.id, version: buyerOffers.version })
      .from(buyerOffers)
      .where(and(
        eq(buyerOffers.buyRequestId, input.buyRequestId),
        eq(buyerOffers.status, "sent"),
        ne(buyerOffers.id, input.buyerOfferId),
      ));
    for (const previous of earlier) {
      const [superseded] = await tx.update(buyerOffers)
        .set({ status: "superseded", supersededAt: now, updatedAt: now })
        .where(and(
          eq(buyerOffers.id, previous.id),
          eq(buyerOffers.buyRequestId, input.buyRequestId),
          eq(buyerOffers.status, "sent"),
        ))
        .returning({ id: buyerOffers.id });
      if (superseded) {
        await appendAudit(tx, {
          buyRequestId: input.buyRequestId,
          actorId: input.actor.id,
          action: BUYER_OFFER_SUPERSEDED_ACTION,
          metadata: {
            buyerOfferId: previous.id,
            version: previous.version,
            supersededByVersion: record.version,
          },
          now,
        });
      }
    }

    const [message] = await tx.insert(notificationOutbox).values({
      id: generateOrderedId(),
      messageType: BUYER_OFFER_DELIVERY_MESSAGE_TYPE,
      aggregateType: BUYER_OFFER_AGGREGATE_TYPE,
      aggregateId: input.buyerOfferId,
      recipientReference: record.contactId,
      templateVersion: "buyer-offer-to-buyer-v1",
      idempotencyKey: `buyer-offer-delivery:${input.buyerOfferId}:v${record.version}:v1`,
      nextAttemptAt: now,
      createdAt: now,
    }).onConflictDoNothing({ target: notificationOutbox.idempotencyKey }).returning({ id: notificationOutbox.id });
    if (!message) throw new Error("BUYER_OFFER_DELIVERY_NOT_ENQUEUED");

    await appendAudit(tx, {
      buyRequestId: input.buyRequestId,
      actorId: input.actor.id,
      action: BUYER_OFFER_STATUS_ACTION,
      before: `offer:${record.version}:draft`,
      after: `offer:${record.version}:sent`,
      metadata: { buyerOfferId: input.buyerOfferId, version: record.version, from: "draft", to: "sent" },
      now,
    });
    await appendAudit(tx, {
      buyRequestId: input.buyRequestId,
      actorId: input.actor.id,
      action: BUYER_OFFER_DELIVERY_QUEUED_ACTION,
      after: `offer:${record.version}:sent`,
      metadata: { buyerOfferId: input.buyerOfferId, version: record.version, notificationId: message.id },
      now,
    });
    return { ok: true as const, data: { notificationId: message.id, version: record.version } };
  });
}

/** The only database projection that may cross into a buyer surface. */
export async function loadBuyerOfferCustomerRecord(
  db: PriceCheckDb,
  buyerOfferId: string,
  now = new Date(),
): Promise<BuyerOfferCustomerRecord | null> {
  const [record] = await db.select({
    buyerOfferId: buyerOffers.id,
    buyRequestId: buyRequests.id,
    businessEmail: marketplaceContacts.businessEmail,
    reference: buyRequests.publicReference,
    version: buyerOffers.version,
    civilonSaleUnitPrice: buyerOffers.civilonSaleUnitPrice,
    currencyCode: buyerOffers.currencyCode,
    quantity: buyerOffers.quantity,
    statedCondition: buyerOffers.statedCondition,
    documentsSummary: buyerOffers.documentsSummary,
    deliveryOption: buyerOffers.deliveryOption,
    shippingAndExportScope: buyerOffers.shippingAndExportScope,
    leadTimeDays: buyerOffers.leadTimeDays,
    sentAt: buyerOffers.sentAt,
    expiresAt: buyerOffers.expiresAt,
    status: buyerOffers.status,
    respondedAt: buyerOffers.respondedAt,
  }).from(buyerOffers)
    .innerJoin(buyRequests, eq(buyerOffers.buyRequestId, buyRequests.id))
    .innerJoin(marketplaceContacts, eq(buyRequests.contactId, marketplaceContacts.id))
    .where(eq(buyerOffers.id, buyerOfferId))
    .limit(1);
  if (!record || !record.sentAt || !record.expiresAt || record.expiresAt.valueOf() <= now.valueOf()) return null;
  if (!(record.status === "sent" || record.status === "accepted" || record.status === "declined")) return null;
  return { ...record, status: record.status };
}

export type BuyerOfferResponseBinding = {
  buyerOfferId: string;
  version: number;
  sentAt: Date;
  expiresAt: Date;
};

/** Atomic, exact-version buyer response plus one idempotent internal notice. */
export async function recordBuyerOfferResponse(
  db: PriceCheckDb,
  input: BuyerOfferResponseBinding & { decision: "accepted" | "declined"; now?: Date },
): Promise<{ outcome: "recorded" | "already_recorded"; decision: "accepted" | "declined" } | { outcome: "unavailable" }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [current] = await tx.select({
      id: buyerOffers.id,
      buyRequestId: buyerOffers.buyRequestId,
      version: buyerOffers.version,
      status: buyerOffers.status,
      sentAt: buyerOffers.sentAt,
      expiresAt: buyerOffers.expiresAt,
    }).from(buyerOffers).where(eq(buyerOffers.id, input.buyerOfferId)).limit(1);
    if (!current || !current.sentAt || !current.expiresAt) return { outcome: "unavailable" as const };
    if (
      current.version !== input.version
      || current.sentAt.valueOf() !== input.sentAt.valueOf()
      || current.expiresAt.valueOf() !== input.expiresAt.valueOf()
      || current.expiresAt.valueOf() <= now.valueOf()
    ) return { outcome: "unavailable" as const };
    if (current.status === input.decision) {
      return { outcome: "already_recorded" as const, decision: input.decision };
    }
    if (current.status !== "sent") return { outcome: "unavailable" as const };

    const [updated] = await tx.update(buyerOffers)
      .set({ status: input.decision, respondedAt: now, updatedAt: now })
      .where(and(
        eq(buyerOffers.id, input.buyerOfferId),
        eq(buyerOffers.version, input.version),
        eq(buyerOffers.status, "sent"),
        eq(buyerOffers.sentAt, input.sentAt),
        eq(buyerOffers.expiresAt, input.expiresAt),
        gt(buyerOffers.expiresAt, now),
      ))
      .returning({ id: buyerOffers.id });
    if (!updated) return { outcome: "unavailable" as const };

    await appendAudit(tx, {
      buyRequestId: current.buyRequestId,
      actorType: "SYSTEM",
      action: BUYER_OFFER_BUYER_RESPONDED_ACTION,
      before: `offer:${current.version}:sent`,
      after: `offer:${current.version}:${input.decision}`,
      metadata: { buyerOfferId: current.id, version: current.version, decision: input.decision },
      now,
    });
    const [notice] = await tx.insert(notificationOutbox).values({
      id: generateOrderedId(),
      messageType: BUYER_OFFER_RESPONSE_MESSAGE_TYPE,
      aggregateType: BUYER_OFFER_AGGREGATE_TYPE,
      aggregateId: current.id,
      recipientReference: INTERNAL_RECIPIENT_REFERENCE,
      templateVersion: "buyer-offer-response-internal-v1",
      idempotencyKey: `buyer-offer-response:${current.id}:v${current.version}:${input.decision}:v1`,
      nextAttemptAt: now,
      createdAt: now,
    }).onConflictDoNothing({ target: notificationOutbox.idempotencyKey }).returning({ id: notificationOutbox.id });
    if (!notice) throw new Error("BUYER_OFFER_RESPONSE_NOTICE_NOT_ENQUEUED");
    return { outcome: "recorded" as const, decision: input.decision };
  });
}

export async function loadBuyerOfferResponseNotice(db: PriceCheckDb, buyerOfferId: string) {
  const [record] = await db.select({
    buyerOfferId: buyerOffers.id,
    buyRequestId: buyRequests.id,
    reference: buyRequests.publicReference,
    version: buyerOffers.version,
    status: buyerOffers.status,
    respondedAt: buyerOffers.respondedAt,
  }).from(buyerOffers)
    .innerJoin(buyRequests, eq(buyerOffers.buyRequestId, buyRequests.id))
    .where(and(
      eq(buyerOffers.id, buyerOfferId),
      inArray(buyerOffers.status, ["accepted", "declined"]),
    ))
    .limit(1);
  if (!record || !record.respondedAt || !(record.status === "accepted" || record.status === "declined")) {
    throw new Error("BUYER_OFFER_RESPONSE_NOTICE_UNAVAILABLE");
  }
  return { ...record, status: record.status };
}

export async function markBuyerOfferNotificationSucceeded(
  db: PriceCheckDb,
  input: { buyerOfferId: string; notificationId: string; messageType: string; leaseOwner: string; providerMessageId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [offer] = await tx.select({ buyRequestId: buyerOffers.buyRequestId, version: buyerOffers.version })
      .from(buyerOffers).where(eq(buyerOffers.id, input.buyerOfferId)).limit(1);
    if (!offer) throw new Error("BUYER_OFFER_NOTIFICATION_UNAVAILABLE");
    const [completed] = await tx.update(notificationOutbox).set({
      state: "succeeded",
      sentAt: now,
      providerMessageId: input.providerMessageId,
      leaseOwner: null,
      leaseExpiresAt: null,
      sanitizedFailureCode: null,
    }).where(and(
      eq(notificationOutbox.id, input.notificationId),
      eq(notificationOutbox.aggregateId, input.buyerOfferId),
      eq(notificationOutbox.messageType, input.messageType),
      eq(notificationOutbox.state, "running"),
      eq(notificationOutbox.leaseOwner, input.leaseOwner),
    )).returning({ id: notificationOutbox.id });
    if (!completed) throw new Error("BUYER_OFFER_DELIVERY_LEASE_LOST");
    await appendAudit(tx, {
      buyRequestId: offer.buyRequestId,
      actorType: "WORKER",
      action: BUYER_OFFER_NOTIFICATION_SENT_ACTION,
      after: `offer:${offer.version}`,
      metadata: { buyerOfferId: input.buyerOfferId, version: offer.version, messageType: input.messageType, provider: "postmark" },
      now,
    });
  });
}

export async function recordBuyerOfferNotificationFailure(
  db: PriceCheckDb,
  input: { buyerOfferId: string; notificationId: string; messageType: string; code: string; deadLetter: boolean; now?: Date },
) {
  const [offer] = await db.select({ buyRequestId: buyerOffers.buyRequestId, version: buyerOffers.version })
    .from(buyerOffers).where(eq(buyerOffers.id, input.buyerOfferId)).limit(1);
  if (!offer) return;
  await db.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: "buy_request",
    aggregateId: offer.buyRequestId,
    actorType: "WORKER",
    actorId: null,
    action: BUYER_OFFER_NOTIFICATION_FAILED_ACTION,
    afterVersionReference: `offer:${offer.version}`,
    correlationId: `buyer-offer-notification:${input.notificationId}`,
    sanitizedMetadata: {
      buyerOfferId: input.buyerOfferId,
      version: offer.version,
      messageType: input.messageType,
      code: input.code,
      deadLetter: input.deadLetter,
    },
    createdAt: input.now ?? new Date(),
  });
}

/**
 * Supplier responses a staff member may attach as the internal pointer.
 *
 * Returns only the id, the supplier's own label and its sourcing status, for a
 * `<select>` on the authenticated Buy Request page. Never leaves the server
 * except into that admin page.
 */
export async function listSelectableSupplierResponses(db: PriceCheckDb, buyRequestId: string) {
  return db.select({
    id: supplierResponses.id,
    label: sql<string>`coalesce(${supplierResponses.supplierNameSnapshot}, 'Supplier')`,
    status: supplierResponses.status,
  }).from(supplierResponses)
    .where(eq(supplierResponses.buyRequestId, buyRequestId))
    .orderBy(desc(supplierResponses.receivedAt))
    .limit(100);
}
