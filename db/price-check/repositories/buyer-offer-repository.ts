import "../server-boundary.ts";

import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import { auditEvents, buyRequests, buyerOffers, supplierResponses } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  BUYER_OFFER_DRAFTED_ACTION,
  BUYER_OFFER_DRAFT_REPLACED_ACTION,
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
 * This module writes `buyer_offers` and its audit rows and nothing else. It
 * never reads a supplier cost, never updates a supplier response, never moves
 * the Buy Request, and never enqueues a notification. Sending an offer is a
 * thing a staff member does outside this system; all this records is that they
 * say they did.
 */

export type BuyerOfferActor = { id: string; role: string };

export type BuyerOfferOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_found" }
  /** The chosen supplier response belongs to a different Buy Request. */
  | { ok: false; reason: "supplier_response_unavailable" }
  | { ok: false; reason: "conflict"; currentStatus: string }
  | { ok: false; reason: "forbidden_transition" }
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
  input: { buyRequestId: string; actorId: string; action: string; metadata: Record<string, unknown> },
) {
  await tx.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: "buy_request",
    aggregateId: input.buyRequestId,
    actorType: "ADMIN",
    actorId: input.actorId,
    action: input.action,
    correlationId: `${input.action}:${crypto.randomUUID()}`,
    sanitizedMetadata: input.metadata,
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
 * `sent` means a staff member confirms they sent the offer to the buyer outside
 * this system; `sent_at` records when they said so, not a delivery receipt.
 * `expired` and `withdrawn` stamp no response timestamp, because neither is one.
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
