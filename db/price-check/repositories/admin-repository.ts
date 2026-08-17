import "../server-boundary.ts";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { PriceCheckDb } from "../index.ts";
import {
  adminUsers,
  adminSessions,
  attachmentExtractions,
  attachments,
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
import { PENDING_STAFF_ISSUER, normalizeBootstrapEmail, type VerifiedStaffIdentity } from "../../../lib/price-check/admin/identity.ts";

export type LocalAdminUser = typeof adminUsers.$inferSelect;
export type AdminActor = Pick<LocalAdminUser, "id" | "role">;

export const staffRoles = ["ADMIN", "REVIEWER", "ANALYST", "AUDITOR"] as const;
export type StaffRole = (typeof staffRoles)[number];

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
        metadata: {
          provider: identity.provider,
          authenticationMethods: identity.authenticationMethods,
        },
      });
      return { status: "authorized" as const, user: { ...byIdentity, lastLoginAt: now } };
    }

    const [emailBinding] = await tx.select().from(adminUsers).where(eq(adminUsers.displayEmail, identity.email)).limit(1);
    if (emailBinding) {
      if (!emailBinding.active) return { status: "inactive" as const };
      if (emailBinding.identityProviderIssuer === PENDING_STAFF_ISSUER) {
        const now = new Date();
        const [bound] = await tx.update(adminUsers).set({
          identityProviderIssuer: identity.issuer,
          identityProviderSubject: identity.subject,
          lastLoginAt: now,
          updatedAt: now,
        }).where(and(eq(adminUsers.id, emailBinding.id), eq(adminUsers.identityProviderIssuer, PENDING_STAFF_ISSUER))).returning();
        if (!bound) return { status: "binding_conflict" as const };
        await appendAudit(tx, { aggregateType: "admin_user", aggregateId: bound.id, actorId: bound.id, action: "STAFF_IDENTITY_BOUND", metadata: { provider: identity.provider } });
        await appendAudit(tx, { aggregateType: "admin_user", aggregateId: bound.id, actorId: bound.id, action: "ADMIN_LOGIN", metadata: { provider: identity.provider, authenticationMethods: identity.authenticationMethods } });
        return { status: "bound" as const, user: bound };
      }
      const isApprovedIdentityMigration = bootstrapAllowed &&
        identity.provider === "google-oidc" &&
        identity.issuer === "https://accounts.google.com" &&
        emailBinding.identityProviderIssuer.startsWith("netlify-identity:");
      if (!isApprovedIdentityMigration) return { status: "binding_conflict" as const };

      const now = new Date();
      const [rebound] = await tx.update(adminUsers).set({
        identityProviderIssuer: identity.issuer,
        identityProviderSubject: identity.subject,
        lastLoginAt: now,
        updatedAt: now,
      }).where(eq(adminUsers.id, emailBinding.id)).returning();
      await appendAudit(tx, {
        aggregateType: "admin_user",
        aggregateId: rebound.id,
        actorId: rebound.id,
        action: "ADMIN_IDENTITY_REBOUND",
        metadata: {
          fromProvider: "netlify-identity",
          toProvider: identity.provider,
          authenticationMethods: identity.authenticationMethods,
        },
      });
      await appendAudit(tx, {
        aggregateType: "admin_user",
        aggregateId: rebound.id,
        actorId: rebound.id,
        action: "ADMIN_LOGIN",
        metadata: {
          provider: identity.provider,
          authenticationMethods: identity.authenticationMethods,
        },
      });
      return { status: "rebound" as const, user: rebound };
    }
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
      metadata: {
        provider: identity.provider,
        role: "ADMIN",
        authenticationMethods: identity.authenticationMethods,
      },
    });
    await appendAudit(tx, {
      aggregateType: "admin_user",
      aggregateId: created.id,
      actorId: created.id,
      action: "ADMIN_LOGIN",
      metadata: {
        provider: identity.provider,
        authenticationMethods: identity.authenticationMethods,
      },
    });
    return { status: "bound" as const, user: created };
  });
}

export async function listStaff(db: PriceCheckDb) {
  return db.select({
    id: adminUsers.id,
    displayEmail: adminUsers.displayEmail,
    role: adminUsers.role,
    active: adminUsers.active,
    identityProviderIssuer: adminUsers.identityProviderIssuer,
    identityProviderSubject: adminUsers.identityProviderSubject,
    createdAt: adminUsers.createdAt,
    updatedAt: adminUsers.updatedAt,
    lastLoginAt: adminUsers.lastLoginAt,
    deactivatedAt: adminUsers.deactivatedAt,
  }).from(adminUsers).orderBy(asc(adminUsers.displayEmail));
}

function assertStaffRole(role: string): asserts role is StaffRole {
  if (!staffRoles.includes(role as StaffRole)) throw new Error("Choose a valid staff role.");
}

export async function createPendingStaff(db: PriceCheckDb, input: { email: string; role: StaffRole; actor: AdminActor }) {
  const email = normalizeBootstrapEmail(input.email);
  if (!email || email.length > 320 || !email.includes("@")) throw new Error("Enter a valid login email.");
  assertStaffRole(input.role);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.displayEmail, email)).limit(1);
    if (existing) throw new Error("A staff record already exists for that email.");
    const id = generateOrderedId();
    const [created] = await tx.insert(adminUsers).values({
      id,
      identityProviderIssuer: PENDING_STAFF_ISSUER,
      identityProviderSubject: randomBytes(32).toString("base64url"),
      displayEmail: email,
      role: input.role,
      active: true,
    }).returning();
    await appendAudit(tx, { aggregateType: "admin_user", aggregateId: id, actorId: input.actor.id, action: "STAFF_CREATED_PENDING", metadata: { role: input.role, email } });
    return created;
  });
}

async function assertNotFinalAdmin(tx: PriceCheckDb, targetId: string, nextRole: StaffRole, nextActive: boolean) {
  const [target] = await tx.select({ role: adminUsers.role, active: adminUsers.active }).from(adminUsers).where(eq(adminUsers.id, targetId)).limit(1);
  if (!target) throw new Error("Staff member was not found.");
  if (target.role === "ADMIN" && target.active && (nextRole !== "ADMIN" || !nextActive)) {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(adminUsers).where(and(eq(adminUsers.role, "ADMIN"), eq(adminUsers.active, true)));
    if (Number(count) <= 1) throw new Error("At least one active Civilon administrator is required.");
  }
}

async function revokeUserSessions(tx: PriceCheckDb, userId: string, now = new Date()) {
  await tx.update(adminSessions).set({ revokedAt: now }).where(and(eq(adminSessions.adminUserId, userId), sql`${adminSessions.revokedAt} is null`));
}

export async function updateStaff(db: PriceCheckDb, input: { id: string; action: "role" | "disable" | "enable" | "revoke"; role?: StaffRole; actor: AdminActor }) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(adminUsers).where(eq(adminUsers.id, input.id)).limit(1);
    if (!current) throw new Error("Staff member was not found.");
    const now = new Date();
    if (input.action === "revoke") {
      await revokeUserSessions(tx, current.id, now);
      await appendAudit(tx, { aggregateType: "admin_user", aggregateId: current.id, actorId: input.actor.id, action: "STAFF_SESSIONS_REVOKED" });
      return current;
    }
    if (input.action === "role") {
      if (!input.role) throw new Error("Choose a role.");
      assertStaffRole(input.role);
      await assertNotFinalAdmin(tx, current.id, input.role, current.active);
      const [updated] = await tx.update(adminUsers).set({ role: input.role, updatedAt: now }).where(eq(adminUsers.id, current.id)).returning();
      await revokeUserSessions(tx, current.id, now);
      await appendAudit(tx, { aggregateType: "admin_user", aggregateId: current.id, actorId: input.actor.id, action: "STAFF_ROLE_CHANGED", metadata: { from: current.role, to: input.role } });
      return updated;
    }
    const active = input.action === "enable";
    await assertNotFinalAdmin(tx, current.id, current.role, active);
    const [updated] = await tx.update(adminUsers).set({ active, deactivatedAt: active ? null : now, updatedAt: now }).where(eq(adminUsers.id, current.id)).returning();
    if (!active) await revokeUserSessions(tx, current.id, now);
    await appendAudit(tx, { aggregateType: "admin_user", aggregateId: current.id, actorId: input.actor.id, action: active ? "STAFF_REENABLED" : "STAFF_DISABLED" });
    return updated;
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

  const [documentation, revisions, audit, jobs, admins, uploadedDocuments, extractions] = await Promise.all([
    db.select().from(priceCheckDocumentRequirements).where(eq(priceCheckDocumentRequirements.priceCheckId, priceCheckId)).orderBy(asc(priceCheckDocumentRequirements.requirementCode)),
    db.select().from(priceCheckRevisions).where(eq(priceCheckRevisions.priceCheckId, priceCheckId)).orderBy(desc(priceCheckRevisions.version)),
    db.select().from(auditEvents).where(and(eq(auditEvents.aggregateType, "price_check"), eq(auditEvents.aggregateId, priceCheckId))).orderBy(asc(auditEvents.createdAt)),
    db.select().from(processingJobs).where(or(
      eq(processingJobs.aggregateId, priceCheckId),
      sql`${processingJobs.aggregateId} in (select id from attachments where price_check_id = ${priceCheckId})`,
    )).orderBy(desc(processingJobs.createdAt)),
    listActiveAdmins(db),
    db.select().from(attachments).where(and(eq(attachments.priceCheckId, priceCheckId), sql`${attachments.deletedAt} is null`)).orderBy(asc(attachments.createdAt)),
    db.select({ extraction: attachmentExtractions, attachmentId: attachments.id, filename: attachments.displayFilename })
      .from(attachmentExtractions).innerJoin(attachments, eq(attachmentExtractions.attachmentId, attachments.id))
      .where(eq(attachments.priceCheckId, priceCheckId)).orderBy(desc(attachmentExtractions.createdAt)),
  ]);
  return { ...record, documentation, revisions, audit, jobs, admins, attachments: uploadedDocuments, extractions };
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
    const [current] = await tx.select({ status: priceChecks.status, currentAnalysisId: priceChecks.currentAnalysisId }).from(priceChecks).where(eq(priceChecks.id, input.priceCheckId)).limit(1);
    if (!current) throw new Error("Price Check was not found.");
    assertPriceCheckTransition(current.status, input.to);
    if (input.to === "analysis_ready" && !current.currentAnalysisId) throw new Error("A persisted analysis version is required before analysis ready.");
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
    if (input.to === "analysis_ready") {
      await appendAudit(tx, {
        aggregateType: "price_check",
        aggregateId: input.priceCheckId,
        actorId: input.actor.id,
        action: "ANALYSIS_MARKED_READY",
        beforeVersionReference: `status:${current.status}`,
        afterVersionReference: `analysis:${current.currentAnalysisId}`,
      });
    }
    return updated;
  });
}

export function validNextStatuses(current: PriceCheckStatus, permitted: readonly PriceCheckStatus[]) {
  return permitted.filter((status) => canTransitionPriceCheck(current, status));
}
