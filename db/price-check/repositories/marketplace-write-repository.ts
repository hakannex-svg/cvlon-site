import "../server-boundary.ts";

import { and, eq } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import {
  adminUsers,
  auditEvents,
  buyRequests,
  marketplaceNotes,
  sellSubmissions,
} from "../schema.ts";
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
