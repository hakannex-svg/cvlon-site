import "../server-boundary.ts";

import { and, desc, eq, sql } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import { auditEvents, buyRequests, buyerOffers } from "../schema.ts";
import {
  ACCEPTED_DEAL_EXECUTION_STARTED_ACTION,
  canStartAcceptedDealExecution,
  type AcceptedDealExecutionSourceStatus,
} from "../domain/accepted-deal-policy.ts";
import { generateOrderedId } from "../domain/identifiers.ts";

export type StartAcceptedDealExecutionOutcome =
  | { ok: true; data: { from: AcceptedDealExecutionSourceStatus; to: "converted"; offerVersion: number } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; currentStatus: string }
  | { ok: false; reason: "ineligible_status" }
  | { ok: false; reason: "latest_offer_not_accepted" };

/**
 * Records one narrow fact: Civilon has begun executing the newest accepted
 * offer. The accepted offer and the optimistic request status are both fenced
 * inside the update statement, so a newer offer or another status writer wins
 * cleanly instead of leaving a misleading conversion.
 */
export async function startAcceptedDealExecution(
  db: PriceCheckDb,
  input: {
    buyRequestId: string;
    expectedStatus: AcceptedDealExecutionSourceStatus;
    actorId: string;
    now?: Date;
  },
): Promise<StartAcceptedDealExecutionOutcome> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [request] = await tx.select({ status: buyRequests.status })
      .from(buyRequests)
      .where(eq(buyRequests.id, input.buyRequestId))
      .limit(1);
    if (!request) return { ok: false as const, reason: "not_found" as const };
    if (request.status !== input.expectedStatus) {
      return { ok: false as const, reason: "conflict" as const, currentStatus: request.status };
    }
    if (!canStartAcceptedDealExecution(request.status)) {
      return { ok: false as const, reason: "ineligible_status" as const };
    }

    const [latestOffer] = await tx.select({
      id: buyerOffers.id,
      version: buyerOffers.version,
      status: buyerOffers.status,
    }).from(buyerOffers)
      .where(eq(buyerOffers.buyRequestId, input.buyRequestId))
      .orderBy(desc(buyerOffers.version))
      .limit(1);
    if (!latestOffer || latestOffer.status !== "accepted") {
      return { ok: false as const, reason: "latest_offer_not_accepted" as const };
    }

    const [updated] = await tx.update(buyRequests)
      .set({ status: "converted", updatedAt: now })
      .where(and(
        eq(buyRequests.id, input.buyRequestId),
        eq(buyRequests.status, input.expectedStatus),
        // Bind the mutation to the exact offer just inspected. If any newer
        // offer appears before this statement, the update affects zero rows.
        sql`(
          select ${buyerOffers.id}
          from ${buyerOffers}
          where ${buyerOffers.buyRequestId} = ${buyRequests.id}
          order by ${buyerOffers.version} desc
          limit 1
        ) = ${latestOffer.id}`,
        sql`(
          select ${buyerOffers.status}
          from ${buyerOffers}
          where ${buyerOffers.buyRequestId} = ${buyRequests.id}
          order by ${buyerOffers.version} desc
          limit 1
        ) = 'accepted'`,
      ))
      .returning({ id: buyRequests.id });
    if (!updated) {
      return { ok: false as const, reason: "conflict" as const, currentStatus: request.status };
    }

    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: "buy_request",
      aggregateId: input.buyRequestId,
      actorType: "ADMIN",
      actorId: input.actorId,
      action: ACCEPTED_DEAL_EXECUTION_STARTED_ACTION,
      beforeVersionReference: `status:${request.status}`,
      afterVersionReference: "status:converted",
      correlationId: `${ACCEPTED_DEAL_EXECUTION_STARTED_ACTION}:${crypto.randomUUID()}`,
      sanitizedMetadata: {
        from: request.status,
        to: "converted",
        buyerOfferId: latestOffer.id,
        offerVersion: latestOffer.version,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      data: { from: request.status, to: "converted" as const, offerVersion: latestOffer.version },
    };
  });
}
