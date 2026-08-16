import "../server-boundary.ts";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import {
  adminUsers,
  auditEvents,
  priceCheckDocumentRequirements,
  priceCheckRevisions,
  priceChecks,
  processingJobs,
  requesters,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import { normalizePartNumber, parseMoney, validateCurrencyCode } from "../domain/normalization.ts";
import {
  assertPriceCheckTransition,
  canTransitionPriceCheck,
  type PriceCheckStatus,
} from "../domain/status-policy.ts";
import type { VerifiedStaffIdentity } from "../../../lib/price-check/admin/identity.ts";

export type LocalAdminUser = typeof adminUsers.$inferSelect;
export type AdminActor = Pick<LocalAdminUser, "id" | "role">;

function correlationId(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

async function appendAudit(
  tx: PriceCheckDb,
  input: {
    aggregateType: string;
    aggregateId: string;
    actorId: string | null;
    action: string;
    beforeVersionReference?: string | null;
    afterVersionReference?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    actorType: "ADMIN",
    actorId: input.actorId,
    action: input.action,
    beforeVersionReference: input.beforeVersionReference ?? null,
    afterVersionReference: input.afterVersionReference ?? null,
    correlationId: correlationId(input.action),
    sanitizedMetadata: input.metadata ?? {},
  });
}

export async function bindOrAuthorizeAdmin(
  db: PriceCheckDb,
  identity: VerifiedStaffIdentity,
  bootstrapAllowed: boolean,
) {
  return db.transaction(async (tx) => {
    const [byIdentity] = await tx
      .select()
      .from(adminUsers)
      .where(and(
        eq(adminUsers.identityProviderIssuer, identity.issuer),
        eq(adminUsers.identityProviderSubject, identity.subject),
      ))
      .limit(1);

    if (byIdentity) {
      if (!byIdentity.active) return { status: "inactive" as const };
      const now = new Date();
      if (byIdentity.lastLoginAt && now.valueOf() - byIdentity.lastLoginAt.valueOf() < 30 * 60 * 1000) {
        return { status: "authorized" as const, user: byIdentity };
      }
      await tx.update(adminUsers).set({ lastLoginAt: now, updatedAt: now }).where(eq(adminUsers.id, byIdentity.id));
      await appendAudit(tx, {
        aggregateType: "admin_user",
        aggregateId: byIdentity.id,
        actorId: byIdentity.id,
        action: "ADMIN_LOGIN",
        metadata: { provider: identity.provider },
      });
      return { status: "authorized" as const, user: { ...byIdentity, lastLoginAt: now } };
    }

    const [emailBinding] = await tx.select().from(adminUsers).where(eq(adminUsers.displayEmail, identity.email)).limit(1);
    if (emailBinding) return { status: "binding_conflict" as const };
    if (!bootstrapAllowed) return { status: "not_allowed" as const };

    const [created] = await tx.insert(adminUsers).values({
      id: generateOrderedId(),
      identityProviderIssuer: identity.issuer,
      identityProviderSubject: identity.subject,
      displayEmail: identity.email,
      role: "ADMIN",
      active: true,
      lastLoginAt: new Date(),
    }).returning();
    await appendAudit(tx, {
      aggregateType: "admin_user",
      aggregateId: created.id,
      actorId: created.id,
      action: "ADMIN_LOGIN_BOUND",
      metadata: { provider: identity.provider, role: "ADMIN" },
    });
    await appendAudit(tx, {
      aggregateType: "admin_user",
      aggregateId: created.id,
      actorId: created.id,
      action: "ADMIN_LOGIN",
      metadata: { provider: identity.provider },
    });
    return { status: "bound" as const, user: created };
  });
}

export type QueueFilters = {
  status?: PriceCheckStatus;
  aog?: "yes" | "no";
  assignee?: string;
  condition?: string;
  transaction?: string;
  age?: "day" | "week" | "older";
  search?: string;
};

export async function listAdminPriceChecks(db: PriceCheckDb, filters: QueueFilters = {}) {
  const clauses = [];
  if (filters.status) clauses.push(eq(priceChecks.status, filters.status));
  if (filters.aog) clauses.push(eq(priceChecks.aog, filters.aog === "yes"));
  if (filters.assignee === "unassigned") clauses.push(sql`${priceChecks.assignedAdminUserId} is null`);
  else if (filters.assignee) clauses.push(eq(priceChecks.assignedAdminUserId, filters.assignee));
  if (filters.condition) clauses.push(eq(priceChecks.conditionCode, filters.condition as typeof priceChecks.conditionCode.enumValues[number]));
  if (filters.transaction) clauses.push(eq(priceChecks.transactionType, filters.transaction as typeof priceChecks.transactionType.enumValues[number]));
  if (filters.age === "day") clauses.push(sql`${priceChecks.submittedAt} >= now() - interval '1 day'`);
  if (filters.age === "week") clauses.push(sql`${priceChecks.submittedAt} >= now() - interval '7 days'`);
  if (filters.age === "older") clauses.push(sql`${priceChecks.submittedAt} < now() - interval '7 days'`);
  if (filters.search?.trim()) {
    const needle = `%${filters.search.trim().slice(0, 120)}%`;
    clauses.push(or(
      ilike(priceChecks.publicReference, needle),
      ilike(priceChecks.normalizedPartNumber, needle.replaceAll("-", "")),
      ilike(requesters.companyName, needle),
      ilike(sql`${requesters.firstName} || ' ' || ${requesters.lastName}`, needle),
    )!);
  }

  return db.select({
    id: priceChecks.id,
    publicReference: priceChecks.publicReference,
    submittedAt: priceChecks.submittedAt,
    aog: priceChecks.aog,
    companyName: requesters.companyName,
    requesterFirstName: requesters.firstName,
    requesterLastName: requesters.lastName,
    originalPartNumber: priceChecks.originalPartNumber,
    conditionCode: priceChecks.conditionCode,
    transactionType: priceChecks.transactionType,
    unitPrice: priceChecks.unitPrice,
    currencyCode: priceChecks.currencyCode,
    status: priceChecks.status,
    assigneeId: adminUsers.id,
    assigneeEmail: adminUsers.displayEmail,
  }).from(priceChecks)
    .innerJoin(requesters, eq(priceChecks.requesterId, requesters.id))
    .leftJoin(adminUsers, eq(priceChecks.assignedAdminUserId, adminUsers.id))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(priceChecks.aog), desc(priceChecks.submittedAt))
    .limit(200);
}

export async function listActiveAdmins(db: PriceCheckDb) {
  return db.select({ id: adminUsers.id, displayEmail: adminUsers.displayEmail, role: adminUsers.role })
    .from(adminUsers)
    .where(eq(adminUsers.active, true))
    .orderBy(asc(adminUsers.displayEmail));
}

export async function getAdminPriceCheckDetail(db: PriceCheckDb, priceCheckId: string) {
  const [record] = await db.select({ priceCheck: priceChecks, requester: requesters, assignee: adminUsers })
    .from(priceChecks)
    .innerJoin(requesters, eq(priceChecks.requesterId, requesters.id))
    .leftJoin(adminUsers, eq(priceChecks.assignedAdminUserId, adminUsers.id))
    .where(eq(priceChecks.id, priceCheckId))
    .limit(1);
  if (!record) return null;

  const [documentation, revisions, audit, jobs, admins] = await Promise.all([
    db.select().from(priceCheckDocumentRequirements).where(eq(priceCheckDocumentRequirements.priceCheckId, priceCheckId)).orderBy(asc(priceCheckDocumentRequirements.requirementCode)),
    db.select().from(priceCheckRevisions).where(eq(priceCheckRevisions.priceCheckId, priceCheckId)).orderBy(desc(priceCheckRevisions.version)),
    db.select().from(auditEvents).where(and(eq(auditEvents.aggregateType, "price_check"), eq(auditEvents.aggregateId, priceCheckId))).orderBy(asc(auditEvents.createdAt)),
    db.select().from(processingJobs).where(eq(processingJobs.aggregateId, priceCheckId)).orderBy(desc(processingJobs.createdAt)),
    listActiveAdmins(db),
  ]);
  return { ...record, documentation, revisions, audit, jobs, admins };
}

export async function assignPriceCheck(
  db: PriceCheckDb,
  input: { priceCheckId: string; assigneeId: string; actor: AdminActor },
) {
  return db.transaction(async (tx) => {
    const [[target], [current]] = await Promise.all([
      tx.select({ id: adminUsers.id, active: adminUsers.active }).from(adminUsers).where(eq(adminUsers.id, input.assigneeId)).limit(1),
      tx.select({ assignedAdminUserId: priceChecks.assignedAdminUserId }).from(priceChecks).where(eq(priceChecks.id, input.priceCheckId)).limit(1),
    ]);
    if (!target?.active || !current) throw new Error("Assignment target is unavailable.");
    await tx.update(priceChecks).set({ assignedAdminUserId: target.id, updatedAt: new Date() }).where(eq(priceChecks.id, input.priceCheckId));
    await appendAudit(tx, {
      aggregateType: "price_check",
      aggregateId: input.priceCheckId,
      actorId: input.actor.id,
      action: "PRICE_CHECK_ASSIGNED",
      metadata: { previousAssigneeId: current.assignedAdminUserId, assigneeId: target.id },
    });
  });
}

export type ReviewedTransactionInput = {
  originalPartNumber: string;
  description: string | null;
  quantity: string;
  quoteOrPurchased: "quote" | "purchased";
  transactionType: "outright" | "exchange" | "repair" | "not_sure";
  conditionCode: "NE" | "NS" | "OH" | "SV" | "AR" | "NOT_SURE";
  unitPrice: string;
  currencyCode: string;
  coreCharge: string | null;
  coreDisposition: "REFUNDABLE" | "FORFEITED" | "UNCLEAR" | "NOT_APPLICABLE" | null;
  exchangeFee: string | null;
  freight: string | null;
  transactionDate: string | null;
  aircraftModel: string | null;
  aog: boolean;
  warrantyValue: string | null;
  warrantyUnit: "DAYS" | "MONTHS" | "YEARS" | "HOURS" | "CYCLES" | "OTHER" | null;
  warrantyText: string | null;
  documentationCodes: string[];
  notes: string | null;
  changeReason: string;
};

export async function createAdminRevision(
  db: PriceCheckDb,
  input: { priceCheckId: string; actor: AdminActor; transaction: ReviewedTransactionInput },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: priceChecks.id }).from(priceChecks).where(eq(priceChecks.id, input.priceCheckId)).limit(1);
    if (!current) throw new Error("Price Check was not found.");
    const [latest] = await tx.select({ version: sql<number>`coalesce(max(${priceCheckRevisions.version}), 0)::int` }).from(priceCheckRevisions).where(eq(priceCheckRevisions.priceCheckId, input.priceCheckId));
    const version = (latest?.version ?? 0) + 1;
    const { changeReason, ...transaction } = input.transaction;
    const snapshot = {
      ...transaction,
      originalPartNumber: transaction.originalPartNumber.trim(),
      normalizedPartNumber: normalizePartNumber(transaction.originalPartNumber),
      unitPrice: parseMoney(transaction.unitPrice),
      currencyCode: validateCurrencyCode(transaction.currencyCode),
    };
    const revisionId = generateOrderedId();
    await tx.insert(priceCheckRevisions).values({
      id: revisionId,
      priceCheckId: input.priceCheckId,
      version,
      normalizedSnapshot: snapshot,
      changeReason: changeReason.trim(),
      actorType: "ADMIN",
      actorId: input.actor.id,
    });
    await tx.update(priceChecks).set({ updatedAt: new Date() }).where(eq(priceChecks.id, input.priceCheckId));
    await appendAudit(tx, {
      aggregateType: "price_check",
      aggregateId: input.priceCheckId,
      actorId: input.actor.id,
      action: "PRICE_CHECK_REVISION_CREATED",
      beforeVersionReference: `revision:${version - 1}`,
      afterVersionReference: `revision:${version}`,
      metadata: { reasonCategory: changeReason.trim().slice(0, 120) },
    });
    return { revisionId, version };
  });
}

export async function changePriceCheckStatus(
  db: PriceCheckDb,
  input: { priceCheckId: string; to: PriceCheckStatus; actor: AdminActor; action?: string; metadata?: Record<string, unknown> },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ status: priceChecks.status }).from(priceChecks).where(eq(priceChecks.id, input.priceCheckId)).limit(1);
    if (!current) throw new Error("Price Check was not found.");
    assertPriceCheckTransition(current.status, input.to);
    const [updated] = await tx.update(priceChecks)
      .set({ status: input.to, updatedAt: new Date(), closedAt: input.to === "closed" ? new Date() : null })
      .where(and(eq(priceChecks.id, input.priceCheckId), eq(priceChecks.status, current.status)))
      .returning({ status: priceChecks.status });
    if (!updated) throw new Error("Concurrent status update rejected.");
    await appendAudit(tx, {
      aggregateType: "price_check",
      aggregateId: input.priceCheckId,
      actorId: input.actor.id,
      action: input.action ?? "PRICE_CHECK_STATUS_CHANGED",
      beforeVersionReference: `status:${current.status}`,
      afterVersionReference: `status:${input.to}`,
      metadata: input.metadata,
    });
    if (input.action && input.action !== "PRICE_CHECK_STATUS_CHANGED") {
      await appendAudit(tx, {
        aggregateType: "price_check",
        aggregateId: input.priceCheckId,
        actorId: input.actor.id,
        action: "PRICE_CHECK_STATUS_CHANGED",
        beforeVersionReference: `status:${current.status}`,
        afterVersionReference: `status:${input.to}`,
      });
    }
    return updated;
  });
}

export function validNextStatuses(current: PriceCheckStatus, permitted: readonly PriceCheckStatus[]) {
  return permitted.filter((status) => canTransitionPriceCheck(current, status));
}
