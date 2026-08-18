import "../server-boundary.ts";

import { and, asc, eq, isNull } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import {
  auditEvents,
  buyRequests,
  marketplaceContacts,
  supplierResponses,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  DEFAULT_SUPPLIER_RESPONSE_STATUS,
  SUPPLIER_RESPONSE_RECORDED_ACTION,
  SUPPLIER_RESPONSE_STATUS_ACTION,
  canTransitionSupplierResponse,
  type SupplierResponseStatusValue,
} from "../domain/supplier-response-policy.ts";

/**
 * Internal sourcing writes: supplier responses against a Buy Request.
 *
 * PRIVATE. Supplier identity, supplier contact, supplier cost, supplier
 * documentation, supplier location and shipping notes exist here and on the
 * authenticated Buy Request detail page, and nowhere else. Nothing in this
 * module writes to `buyer_offers`, changes the Buy Request, enqueues an outbox
 * row, or reaches any customer-facing surface.
 *
 * Recording a response is sourcing bookkeeping, not outreach: Civilon staff
 * spoke to a supplier off-site and are writing down what was said. The supplier
 * is never contacted by this code.
 */

export type SupplierWriteActor = { id: string; role: string };

export type SupplierWriteOutcome<T> =
  | { ok: true; data: T }
  /** No such Buy Request, or no such response under it. */
  | { ok: false; reason: "not_found" }
  /** The registered contact is missing, deleted, or not a seller. */
  | { ok: false; reason: "contact_unavailable" }
  /** The caller's view of the response status was stale. */
  | { ok: false; reason: "conflict"; currentStatus: string }
  /** The graph forbids the move, including out of a terminal state. */
  | { ok: false; reason: "forbidden_transition" };

export type SupplierResponseWriteInput = {
  supplierKind: "registered_contact" | "nonregistered_supplier";
  supplierContactId: string | null;
  supplierNameSnapshot: string | null;
  supplierContactSnapshot: string | null;
  supplierCountry: string | null;
  offeredPartNumber: string | null;
  statedCondition: string | null;
  quantityAvailable: string | null;
  supplierUnitCost: string | null;
  currencyCode: string | null;
  quoteOnRequest: boolean;
  availabilityState: string;
  locationText: string | null;
  leadTimeDays: number | null;
  documentsSummary: string | null;
  shippingNotes: string | null;
  expiresAt: Date | null;
};

/**
 * Contacts a staff member may pick as a registered supplier.
 *
 * Restricted to live, seller-capable contacts. A buyer-only contact is not
 * offered, so the obvious mis-click — sourcing a part from the person who asked
 * for it — is not reachable from the form.
 */
export async function listSellerCapableContacts(db: PriceCheckDb, limit = 200) {
  return db.select({
    id: marketplaceContacts.id,
    companyName: marketplaceContacts.companyName,
    firstName: marketplaceContacts.firstName,
    lastName: marketplaceContacts.lastName,
    country: marketplaceContacts.country,
  }).from(marketplaceContacts)
    .where(and(
      eq(marketplaceContacts.actsAsSeller, true),
      isNull(marketplaceContacts.deletedAt),
    ))
    .orderBy(asc(marketplaceContacts.companyName), asc(marketplaceContacts.id))
    .limit(limit);
}

async function appendAudit(
  tx: Parameters<Parameters<PriceCheckDb["transaction"]>[0]>[0],
  input: { buyRequestId: string; actorId: string; action: string; metadata: Record<string, unknown> },
) {
  await tx.insert(auditEvents).values({
    id: generateOrderedId(),
    // Audited against the Buy Request, so the sourcing history sits on the
    // record it belongs to and appears in the existing detail timeline.
    aggregateType: "buy_request",
    aggregateId: input.buyRequestId,
    actorType: "ADMIN",
    actorId: input.actorId,
    action: input.action,
    correlationId: `${input.action}:${crypto.randomUUID()}`,
    sanitizedMetadata: input.metadata,
  });
}

/**
 * Records what a supplier said.
 *
 * `received_at` is server-generated: a staff member records the conversation,
 * they do not assert when it happened. `availability_state` defaults to
 * `subject_to_confirmation`, so a response with no explicit claim records no
 * claim — never a Civilon confirmation of availability.
 */
export async function recordSupplierResponse(
  db: PriceCheckDb,
  input: { buyRequestId: string; response: SupplierResponseWriteInput; actor: SupplierWriteActor; now?: Date },
): Promise<SupplierWriteOutcome<{ supplierResponseId: string }>> {
  const now = input.now ?? new Date();

  const [parent] = await db.select({ id: buyRequests.id })
    .from(buyRequests).where(eq(buyRequests.id, input.buyRequestId)).limit(1);
  if (!parent) return { ok: false, reason: "not_found" };

  let nameSnapshot = input.response.supplierNameSnapshot;
  let countrySnapshot = input.response.supplierCountry;
  if (input.response.supplierKind === "registered_contact") {
    if (!input.response.supplierContactId) return { ok: false, reason: "contact_unavailable" };
    const [contact] = await db.select({
      id: marketplaceContacts.id,
      companyName: marketplaceContacts.companyName,
      country: marketplaceContacts.country,
      actsAsSeller: marketplaceContacts.actsAsSeller,
      deletedAt: marketplaceContacts.deletedAt,
    }).from(marketplaceContacts)
      .where(eq(marketplaceContacts.id, input.response.supplierContactId)).limit(1);
    // Missing, deleted, or not a seller are all the same answer to the caller:
    // that contact cannot be used, and no more than that.
    if (!contact || contact.deletedAt || !contact.actsAsSeller) {
      return { ok: false, reason: "contact_unavailable" };
    }
    // Snapshot only what the panel needs to name the supplier. The contact's
    // e-mail and telephone stay on the contact record.
    nameSnapshot = nameSnapshot ?? contact.companyName;
    countrySnapshot = countrySnapshot ?? contact.country;
  }

  const supplierResponseId = generateOrderedId();
  return db.transaction(async (tx) => {
    await tx.insert(supplierResponses).values({
      id: supplierResponseId,
      buyRequestId: input.buyRequestId,
      supplierKind: input.response.supplierKind,
      supplierContactId: input.response.supplierContactId,
      supplierNameSnapshot: nameSnapshot,
      supplierContactSnapshot: input.response.supplierContactSnapshot,
      supplierCountry: countrySnapshot,
      offeredPartNumber: input.response.offeredPartNumber,
      normalizedPartNumber: input.response.offeredPartNumber
        ? input.response.offeredPartNumber.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 120) || null
        : null,
      statedCondition: input.response.statedCondition as typeof supplierResponses.statedCondition.enumValues[number] | null,
      quantityAvailable: input.response.quantityAvailable,
      supplierUnitCost: input.response.supplierUnitCost,
      currencyCode: input.response.currencyCode,
      quoteOnRequest: input.response.quoteOnRequest,
      availabilityState: input.response.availabilityState as typeof supplierResponses.availabilityState.enumValues[number],
      locationText: input.response.locationText,
      leadTimeDays: input.response.leadTimeDays,
      documentsSummary: input.response.documentsSummary,
      shippingNotes: input.response.shippingNotes,
      status: DEFAULT_SUPPLIER_RESPONSE_STATUS,
      recordedByAdminUserId: input.actor.id,
      receivedAt: now,
      expiresAt: input.response.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    // The audit row names the response and its shape, never the supplier, the
    // cost, or the documentation text.
    await appendAudit(tx, {
      buyRequestId: input.buyRequestId,
      actorId: input.actor.id,
      action: SUPPLIER_RESPONSE_RECORDED_ACTION,
      metadata: {
        supplierResponseId,
        supplierKind: input.response.supplierKind,
        availabilityState: input.response.availabilityState,
        quoteOnRequest: input.response.quoteOnRequest,
      },
    });

    return { ok: true as const, data: { supplierResponseId } };
  });
}

/**
 * Moves a supplier response through the sourcing graph.
 *
 * Parent-bound and optimistically concurrent, on the same pattern as the
 * aggregate status change. Selecting a supplier does not create a buyer offer,
 * change the Buy Request, or notify anyone; those are separate, deliberate acts.
 */
export async function changeSupplierResponseStatus(
  db: PriceCheckDb,
  input: {
    buyRequestId: string;
    supplierResponseId: string;
    expectedStatus: string;
    to: string;
    actor: SupplierWriteActor;
    now?: Date;
  },
): Promise<SupplierWriteOutcome<{ from: string; to: string }>> {
  const now = input.now ?? new Date();

  const [current] = await db.select({ id: supplierResponses.id, status: supplierResponses.status })
    .from(supplierResponses)
    .where(and(
      eq(supplierResponses.id, input.supplierResponseId),
      eq(supplierResponses.buyRequestId, input.buyRequestId),
    ))
    .limit(1);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== input.expectedStatus) {
    return { ok: false, reason: "conflict", currentStatus: current.status };
  }
  // Terminal rows are refused by the graph, which has no outbound edges.
  if (!canTransitionSupplierResponse(current.status, input.to)) {
    return { ok: false, reason: "forbidden_transition" };
  }

  return db.transaction(async (tx) => {
    const updated = await tx.update(supplierResponses)
      .set({ status: input.to as SupplierResponseStatusValue, updatedAt: now })
      .where(and(
        eq(supplierResponses.id, input.supplierResponseId),
        eq(supplierResponses.buyRequestId, input.buyRequestId),
        eq(supplierResponses.status, current.status as SupplierResponseStatusValue),
      ))
      .returning({ id: supplierResponses.id });
    if (!updated.length) {
      return { ok: false as const, reason: "conflict" as const, currentStatus: current.status };
    }

    await appendAudit(tx, {
      buyRequestId: input.buyRequestId,
      actorId: input.actor.id,
      action: SUPPLIER_RESPONSE_STATUS_ACTION,
      metadata: {
        supplierResponseId: input.supplierResponseId,
        from: current.status,
        to: input.to,
      },
    });

    return { ok: true as const, data: { from: current.status, to: input.to } };
  });
}
