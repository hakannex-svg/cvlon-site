import "../server-boundary.ts";

import { and, eq } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import {
  adminUsers,
  auditEvents,
  buyRequests,
  marketplaceAttachments,
  marketplaceContacts,
  marketplaceNotes,
  sellSubmissions,
} from "../schema.ts";
import { type InternalReviewState } from "../domain/internal-review.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  canTransitionMarketplace,
  marketplaceAuditActions,
  marketplaceStatusClosesRecord,
  marketplaceTransitionAction,
  marketplaceTransitionKind,
  type MarketplaceAggregate,
} from "../domain/marketplace-status-policy.ts";

/**
 * The marketplace admin write path.
 *
 * Kept apart from `marketplace-admin-repository.ts`, which is read-only by
 * construction and asserted to contain no insert, update or transaction. Every
 * function here writes the aggregate and appends its audit row inside one
 * transaction, so a recorded change and its evidence cannot come apart.
 *
 * Nothing here touches an intake column. `submitted_at`, `public_reference`,
 * the part, the description, the attribution and the customer's own notes are
 * written once at intake and never again.
 */

export type MarketplaceWriteActor = { id: string; role: string };

export type MarketplaceWriteOutcome<T> =
  | { ok: true; data: T }
  /** The record does not exist. */
  | { ok: false; reason: "not_found" }
  /** The caller's view was stale: the stored status is not what it expected. */
  | { ok: false; reason: "conflict"; currentStatus: string }
  /** The graph forbids it, or the caller lacks the capability for it. */
  | { ok: false; reason: "forbidden_transition" }
  /** The assignee does not exist or is not active. */
  | { ok: false; reason: "assignee_unavailable" };

function aggregateTable(aggregate: MarketplaceAggregate) {
  return aggregate === "buy_request" ? buyRequests : sellSubmissions;
}

async function appendAudit(
  tx: Parameters<Parameters<PriceCheckDb["transaction"]>[0]>[0],
  input: {
    aggregate: MarketplaceAggregate;
    aggregateId: string;
    actorId: string;
    action: string;
    metadata: Record<string, unknown>;
  },
) {
  await tx.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: input.aggregate,
    aggregateId: input.aggregateId,
    actorType: "ADMIN",
    actorId: input.actorId,
    action: input.action,
    correlationId: `${input.action}:${crypto.randomUUID()}`,
    sanitizedMetadata: input.metadata,
  });
}

export type StatusChangeResult = { from: string; to: string; action: string };

/**
 * Moves a record to a new status under optimistic concurrency.
 *
 * The update predicate repeats the expected status, so two staff members acting
 * on the same stale view cannot both succeed: the second update matches zero
 * rows and is reported as a conflict rather than silently overwriting.
 *
 * `pending_verification -> verified` is a staff override. The schema's
 * `*_pending_verification_chk` requires `verified_at` to be set for any status
 * past `pending_verification`, so the aggregate's own `verified_at` is stamped
 * with the override time. The customer's contact record is deliberately NOT
 * touched: `marketplace_contacts.verification_state` still says the customer
 * never confirmed their address, the detail page shows that separately, and the
 * override is recorded under its own audit action naming the staff member.
 */
export async function changeMarketplaceStatus(
  db: PriceCheckDb,
  input: {
    aggregate: MarketplaceAggregate;
    id: string;
    expectedStatus: string;
    to: string;
    actor: MarketplaceWriteActor;
    roleCan: (role: string, capability: string) => boolean;
    now?: Date;
  },
): Promise<MarketplaceWriteOutcome<StatusChangeResult>> {
  const table = aggregateTable(input.aggregate);
  const now = input.now ?? new Date();

  const [current] = await db.select({ id: table.id, status: table.status, verifiedAt: table.verifiedAt })
    .from(table).where(eq(table.id, input.id)).limit(1);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== input.expectedStatus) {
    return { ok: false, reason: "conflict", currentStatus: current.status };
  }

  // Terminal rows are rejected here by the graph, which has no outbound edges.
  if (!canTransitionMarketplace(input.aggregate, current.status, input.to)) {
    return { ok: false, reason: "forbidden_transition" };
  }
  const kind = marketplaceTransitionKind(input.aggregate, current.status, input.to);
  const capability = kind === "ordinary" ? "transition_marketplace" : "exceptional_marketplace_transition";
  if (!input.roleCan(input.actor.role, capability)) return { ok: false, reason: "forbidden_transition" };

  const action = marketplaceTransitionAction(input.aggregate, current.status, input.to);
  const manualVerification = kind === "manual_verification";

  return db.transaction(async (tx) => {
    const updated = await tx.update(table)
      .set({
        status: input.to as typeof table.status.enumValues[number],
        updatedAt: now,
        ...(manualVerification && !current.verifiedAt ? { verifiedAt: now } : {}),
        ...(marketplaceStatusClosesRecord(input.to) ? { closedAt: now } : {}),
      })
      .where(and(eq(table.id, input.id), eq(table.status, current.status as typeof table.status.enumValues[number])))
      .returning({ id: table.id });
    if (!updated.length) {
      // Someone else moved the row between the read and the write.
      return { ok: false, reason: "conflict" as const, currentStatus: current.status };
    }

    await appendAudit(tx, {
      aggregate: input.aggregate,
      aggregateId: input.id,
      actorId: input.actor.id,
      action,
      metadata: {
        from: current.status,
        to: input.to,
        transition: kind,
        ...(manualVerification ? { verificationOverride: true, contactVerificationUnchanged: true } : {}),
      },
    });

    return { ok: true as const, data: { from: current.status, to: input.to, action } };
  });
}

export type AssignmentResult = { previousAssigneeId: string | null; assigneeId: string | null };

/** Assigns or unassigns a record. An inactive or unknown staff id is refused. */
export async function assignMarketplaceRecord(
  db: PriceCheckDb,
  input: {
    aggregate: MarketplaceAggregate;
    id: string;
    assigneeId: string | null;
    actor: MarketplaceWriteActor;
    now?: Date;
  },
): Promise<MarketplaceWriteOutcome<AssignmentResult>> {
  const table = aggregateTable(input.aggregate);
  const now = input.now ?? new Date();

  const [current] = await db.select({ id: table.id, assignedAdminUserId: table.assignedAdminUserId })
    .from(table).where(eq(table.id, input.id)).limit(1);
  if (!current) return { ok: false, reason: "not_found" };

  if (input.assigneeId) {
    const [target] = await db.select({ id: adminUsers.id, active: adminUsers.active })
      .from(adminUsers).where(eq(adminUsers.id, input.assigneeId)).limit(1);
    if (!target || !target.active) return { ok: false, reason: "assignee_unavailable" };
  }

  return db.transaction(async (tx) => {
    await tx.update(table)
      .set({ assignedAdminUserId: input.assigneeId, updatedAt: now })
      .where(eq(table.id, input.id));

    await appendAudit(tx, {
      aggregate: input.aggregate,
      aggregateId: input.id,
      actorId: input.actor.id,
      action: marketplaceAuditActions(input.aggregate).assigned,
      metadata: { previousAssigneeId: current.assignedAdminUserId, assigneeId: input.assigneeId },
    });

    return {
      ok: true as const,
      data: { previousAssigneeId: current.assignedAdminUserId, assigneeId: input.assigneeId },
    };
  });
}

export type NoteResult = { noteId: string };

/**
 * Appends an internal staff note.
 *
 * Append only: there is no update or delete path here, and `redacted_at` is
 * never written. The note reaches `marketplace_notes` and the audit row and
 * nothing else — no outbox row is enqueued, no template is rendered, and no
 * customer surface reads this table. The audit metadata records the note's id
 * and length, never its text, so redacting the note later actually redacts it.
 */
export async function addMarketplaceNote(
  db: PriceCheckDb,
  input: {
    aggregate: MarketplaceAggregate;
    id: string;
    body: string;
    actor: MarketplaceWriteActor;
    now?: Date;
  },
): Promise<MarketplaceWriteOutcome<NoteResult>> {
  const table = aggregateTable(input.aggregate);
  const now = input.now ?? new Date();

  const [current] = await db.select({ id: table.id }).from(table).where(eq(table.id, input.id)).limit(1);
  if (!current) return { ok: false, reason: "not_found" };

  const noteId = generateOrderedId();
  return db.transaction(async (tx) => {
    await tx.insert(marketplaceNotes).values({
      id: noteId,
      aggregateType: input.aggregate,
      aggregateId: input.id,
      buyRequestId: input.aggregate === "buy_request" ? input.id : null,
      sellSubmissionId: input.aggregate === "sell_submission" ? input.id : null,
      adminUserId: input.actor.id,
      body: input.body,
      createdAt: now,
      updatedAt: now,
    });

    await appendAudit(tx, {
      aggregate: input.aggregate,
      aggregateId: input.id,
      actorId: input.actor.id,
      action: marketplaceAuditActions(input.aggregate).noteAdded,
      metadata: { noteId, length: input.body.length },
    });

    return { ok: true as const, data: { noteId } };
  });
}

export type ReviewChangeResult = {
  from: InternalReviewState;
  to: InternalReviewState;
  changed: boolean;
};

/**
 * Sets the internal business review state of the contact behind a Buy Request
 * or Sell Submission. Internal only: this never touches the contact's email
 * `verification_state`, never enqueues an outbox row, and is never rendered on
 * a customer surface. The audit row is attached to the aggregate the staff
 * member was working from, and records the old and new state and the actor.
 */
export async function setContactBusinessReview(
  db: PriceCheckDb,
  input: {
    aggregate: MarketplaceAggregate;
    id: string;
    state: InternalReviewState;
    actor: MarketplaceWriteActor;
    now?: Date;
  },
): Promise<MarketplaceWriteOutcome<ReviewChangeResult>> {
  const table = aggregateTable(input.aggregate);
  const now = input.now ?? new Date();

  const [record] = await db.select({ id: table.id, contactId: table.contactId })
    .from(table).where(eq(table.id, input.id)).limit(1);
  if (!record) return { ok: false, reason: "not_found" };

  const [contact] = await db.select({
    id: marketplaceContacts.id,
    businessReviewState: marketplaceContacts.businessReviewState,
  }).from(marketplaceContacts)
    .where(eq(marketplaceContacts.id, record.contactId))
    .limit(1);
  if (!contact) return { ok: false, reason: "not_found" };

  // Setting the state it already has is a no-op, not an audit event.
  if (contact.businessReviewState === input.state) {
    return { ok: true, data: { from: contact.businessReviewState, to: input.state, changed: false } };
  }

  return db.transaction(async (tx) => {
    const updated = await tx.update(marketplaceContacts)
      .set({
        businessReviewState: input.state,
        businessReviewedAt: input.state === "not_reviewed" ? null : now,
        businessReviewedByAdminUserId: input.state === "not_reviewed" ? null : input.actor.id,
        updatedAt: now,
      })
      .where(and(
        eq(marketplaceContacts.id, contact.id),
        eq(marketplaceContacts.businessReviewState, contact.businessReviewState),
      ))
      .returning({ id: marketplaceContacts.id });
    if (!updated.length) {
      return { ok: false, reason: "conflict" as const, currentStatus: contact.businessReviewState };
    }

    await appendAudit(tx, {
      aggregate: input.aggregate,
      aggregateId: input.id,
      actorId: input.actor.id,
      action: input.aggregate === "buy_request"
        ? "BUY_REQUEST_BUSINESS_REVIEW_CHANGED"
        : "SELL_SUBMISSION_BUSINESS_REVIEW_CHANGED",
      metadata: {
        contactId: contact.id,
        from: contact.businessReviewState,
        to: input.state,
        emailVerificationUnchanged: true,
      },
    });

    return { ok: true as const, data: { from: contact.businessReviewState, to: input.state, changed: true } };
  });
}

/**
 * Sets the internal review state of one bound Sell Submission attachment. The
 * attachment must belong to the named submission and must not be deleted.
 * Internal only, and audited with the old and new state and the actor.
 */
export async function setAttachmentReview(
  db: PriceCheckDb,
  input: {
    sellSubmissionId: string;
    attachmentId: string;
    state: InternalReviewState;
    actor: MarketplaceWriteActor;
    now?: Date;
  },
): Promise<MarketplaceWriteOutcome<ReviewChangeResult>> {
  const now = input.now ?? new Date();

  const [attachment] = await db.select({
    id: marketplaceAttachments.id,
    reviewState: marketplaceAttachments.reviewState,
    scanState: marketplaceAttachments.scanState,
    deletedAt: marketplaceAttachments.deletedAt,
  }).from(marketplaceAttachments)
    .where(and(
      eq(marketplaceAttachments.id, input.attachmentId),
      eq(marketplaceAttachments.sellSubmissionId, input.sellSubmissionId),
    ))
    .limit(1);
  // A deleted attachment is no longer evidence, so it is no longer reviewable.
  if (!attachment || attachment.deletedAt || attachment.scanState !== "CLEAN") {
    return { ok: false, reason: "not_found" };
  }

  if (attachment.reviewState === input.state) {
    return { ok: true, data: { from: attachment.reviewState, to: input.state, changed: false } };
  }

  return db.transaction(async (tx) => {
    const updated = await tx.update(marketplaceAttachments)
      .set({
        reviewState: input.state,
        reviewedAt: input.state === "not_reviewed" ? null : now,
        reviewedByAdminUserId: input.state === "not_reviewed" ? null : input.actor.id,
        updatedAt: now,
      })
      .where(and(
        eq(marketplaceAttachments.id, attachment.id),
        eq(marketplaceAttachments.reviewState, attachment.reviewState),
      ))
      .returning({ id: marketplaceAttachments.id });
    if (!updated.length) {
      return { ok: false, reason: "conflict" as const, currentStatus: attachment.reviewState };
    }

    await appendAudit(tx, {
      aggregate: "sell_submission",
      aggregateId: input.sellSubmissionId,
      actorId: input.actor.id,
      action: "SELL_SUBMISSION_ATTACHMENT_REVIEW_CHANGED",
      metadata: {
        attachmentId: attachment.id,
        from: attachment.reviewState,
        to: input.state,
      },
    });

    return { ok: true as const, data: { from: attachment.reviewState, to: input.state, changed: true } };
  });
}
