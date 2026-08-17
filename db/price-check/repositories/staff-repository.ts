import "../server-boundary.ts";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import {
  adminSessions,
  adminStaffInvitations,
  adminUsers,
  auditEvents,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import type { VerifiedStaffIdentity } from "../../../lib/price-check/admin/identity.ts";
import type { AdminRole } from "../../../lib/price-check/admin/policy.ts";

export type StaffActor = { id: string; role: AdminRole };

function correlationId(action: string) {
  return `${action}:${crypto.randomUUID()}`;
}

async function appendStaffAudit(
  tx: PriceCheckDb,
  input: {
    aggregateType: "admin_user" | "admin_staff_invitation";
    aggregateId: string;
    actorId: string | null;
    action: string;
    before?: string | null;
    after?: string | null;
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
    beforeVersionReference: input.before ?? null,
    afterVersionReference: input.after ?? null,
    correlationId: correlationId(input.action),
    sanitizedMetadata: input.metadata ?? {},
  });
}

async function revokeAllSessionsInTransaction(tx: PriceCheckDb, adminUserId: string, now: Date) {
  const revoked = await tx.update(adminSessions)
    .set({ revokedAt: now })
    .where(and(eq(adminSessions.adminUserId, adminUserId), isNull(adminSessions.revokedAt)))
    .returning({ id: adminSessions.id });
  return revoked.length;
}

async function assertNotFinalActiveAdmin(
  tx: PriceCheckDb,
  target: { id: string; role: AdminRole; active: boolean },
  next: { role: AdminRole; active: boolean },
) {
  if (!target.active || target.role !== "ADMIN" || (next.active && next.role === "ADMIN")) return;
  const [result] = await tx.select({ count: sql<number>`count(*)::int` })
    .from(adminUsers)
    .where(and(eq(adminUsers.active, true), eq(adminUsers.role, "ADMIN")));
  if ((result?.count ?? 0) <= 1) {
    throw new Error("The final active ADMIN cannot be changed or disabled.");
  }
}

export async function listStaff(db: PriceCheckDb) {
  const [users, invitations] = await Promise.all([
    db.select({
      id: adminUsers.id,
      email: adminUsers.displayEmail,
      role: adminUsers.role,
      active: adminUsers.active,
      createdAt: adminUsers.createdAt,
      lastLoginAt: adminUsers.lastLoginAt,
      deactivatedAt: adminUsers.deactivatedAt,
    }).from(adminUsers).orderBy(asc(adminUsers.displayEmail)),
    db.select({
      id: adminStaffInvitations.id,
      email: adminStaffInvitations.displayEmail,
      role: adminStaffInvitations.role,
      status: adminStaffInvitations.status,
      createdAt: adminStaffInvitations.createdAt,
      acceptedAt: adminStaffInvitations.acceptedAt,
      revokedAt: adminStaffInvitations.revokedAt,
    }).from(adminStaffInvitations)
      .where(sql`${adminStaffInvitations.status} in ('PENDING', 'REVOKED')`)
      .orderBy(asc(adminStaffInvitations.displayEmail)),
  ]);

  return {
    users,
    invitations,
  };
}

export async function createStaffInvitation(
  db: PriceCheckDb,
  input: { normalizedEmail: string; displayEmail: string; role: AdminRole; actor: StaffActor },
) {
  return db.transaction(async (tx) => {
    const [existingUser] = await tx.select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.displayEmail, input.normalizedEmail))
      .limit(1);
    if (existingUser) throw new Error("This email is already a bound staff account. Update that account instead.");

    const [pending] = await tx.select({ id: adminStaffInvitations.id })
      .from(adminStaffInvitations)
      .where(and(
        eq(adminStaffInvitations.normalizedEmail, input.normalizedEmail),
        eq(adminStaffInvitations.status, "PENDING"),
      ))
      .limit(1);
    if (pending) throw new Error("An active invitation already exists for this email.");

    const now = new Date();
    const [invitation] = await tx.insert(adminStaffInvitations).values({
      id: generateOrderedId(),
      normalizedEmail: input.normalizedEmail,
      displayEmail: input.displayEmail,
      role: input.role,
      status: "PENDING",
      invitedByAdminUserId: input.actor.id,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await appendStaffAudit(tx, {
      aggregateType: "admin_staff_invitation",
      aggregateId: invitation.id,
      actorId: input.actor.id,
      action: "STAFF_INVITED",
      after: `role:${invitation.role};status:PENDING`,
      metadata: { normalizedEmail: invitation.normalizedEmail },
    });
    return invitation;
  });
}

export async function changeInvitationRole(
  db: PriceCheckDb,
  input: { invitationId: string; role: AdminRole; actor: StaffActor },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(adminStaffInvitations)
      .where(eq(adminStaffInvitations.id, input.invitationId)).limit(1);
    if (!current || current.status !== "PENDING") throw new Error("The pending invitation is unavailable.");
    const now = new Date();
    const [updated] = await tx.update(adminStaffInvitations)
      .set({ role: input.role, updatedAt: now })
      .where(and(eq(adminStaffInvitations.id, current.id), eq(adminStaffInvitations.status, "PENDING")))
      .returning();
    if (!updated) throw new Error("The invitation changed before it could be updated.");
    await appendStaffAudit(tx, {
      aggregateType: "admin_staff_invitation",
      aggregateId: updated.id,
      actorId: input.actor.id,
      action: "STAFF_INVITATION_ROLE_CHANGED",
      before: `role:${current.role}`,
      after: `role:${updated.role}`,
    });
    return updated;
  });
}

export async function revokeStaffInvitation(
  db: PriceCheckDb,
  input: { invitationId: string; actor: StaffActor },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(adminStaffInvitations)
      .where(eq(adminStaffInvitations.id, input.invitationId)).limit(1);
    if (!current || current.status !== "PENDING") throw new Error("The pending invitation is unavailable.");
    const now = new Date();
    const [updated] = await tx.update(adminStaffInvitations)
      .set({ status: "REVOKED", revokedAt: now, updatedAt: now })
      .where(and(eq(adminStaffInvitations.id, current.id), eq(adminStaffInvitations.status, "PENDING")))
      .returning();
    if (!updated) throw new Error("The invitation changed before it could be revoked.");
    await appendStaffAudit(tx, {
      aggregateType: "admin_staff_invitation",
      aggregateId: updated.id,
      actorId: input.actor.id,
      action: "STAFF_INVITATION_REVOKED",
      before: "status:PENDING",
      after: "status:REVOKED",
    });
    return updated;
  });
}

export async function bindInvitedAdmin(
  db: PriceCheckDb,
  identity: VerifiedStaffIdentity,
) {
  return db.transaction(async (tx) => {
    const [invitation] = await tx.select().from(adminStaffInvitations)
      .where(and(
        eq(adminStaffInvitations.normalizedEmail, identity.email),
        eq(adminStaffInvitations.status, "PENDING"),
      ))
      .limit(1);
    if (!invitation) return { status: "not_allowed" as const };

    const now = new Date();
    const [created] = await tx.insert(adminUsers).values({
      id: generateOrderedId(),
      identityProviderIssuer: identity.issuer,
      identityProviderSubject: identity.subject,
      displayEmail: identity.email,
      role: invitation.role,
      active: true,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    }).returning();
    const [accepted] = await tx.update(adminStaffInvitations)
      .set({
        status: "ACCEPTED",
        acceptedAdminUserId: created.id,
        acceptedAt: now,
        updatedAt: now,
      })
      .where(and(eq(adminStaffInvitations.id, invitation.id), eq(adminStaffInvitations.status, "PENDING")))
      .returning();
    if (!accepted) throw new Error("The invitation changed before identity binding.");

    await appendStaffAudit(tx, {
      aggregateType: "admin_user",
      aggregateId: created.id,
      actorId: created.id,
      action: "STAFF_IDENTITY_BOUND",
      after: `role:${created.role};active:true`,
      metadata: { invitationId: accepted.id, provider: identity.provider },
    });
    await appendStaffAudit(tx, {
      aggregateType: "admin_user",
      aggregateId: created.id,
      actorId: created.id,
      action: "ADMIN_LOGIN",
      metadata: { provider: identity.provider, authenticationMethods: identity.authenticationMethods },
    });
    return { status: "bound" as const, user: created };
  });
}

export async function changeBoundStaffRole(
  db: PriceCheckDb,
  input: { adminUserId: string; role: AdminRole; actor: StaffActor },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(adminUsers).where(eq(adminUsers.id, input.adminUserId)).limit(1);
    if (!current) throw new Error("The staff account is unavailable.");
    await assertNotFinalActiveAdmin(tx, current, { role: input.role, active: current.active });
    const now = new Date();
    const [updated] = await tx.update(adminUsers)
      .set({ role: input.role, updatedAt: now })
      .where(eq(adminUsers.id, current.id))
      .returning();
    const revokedSessions = await revokeAllSessionsInTransaction(tx, current.id, now);
    await appendStaffAudit(tx, {
      aggregateType: "admin_user",
      aggregateId: updated.id,
      actorId: input.actor.id,
      action: "STAFF_ROLE_CHANGED",
      before: `role:${current.role}`,
      after: `role:${updated.role}`,
      metadata: { sessionsRevoked: revokedSessions },
    });
    return updated;
  });
}

export async function setBoundStaffActive(
  db: PriceCheckDb,
  input: { adminUserId: string; active: boolean; actor: StaffActor },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(adminUsers).where(eq(adminUsers.id, input.adminUserId)).limit(1);
    if (!current) throw new Error("The staff account is unavailable.");
    await assertNotFinalActiveAdmin(tx, current, { role: current.role, active: input.active });
    const now = new Date();
    const [updated] = await tx.update(adminUsers)
      .set({ active: input.active, deactivatedAt: input.active ? null : now, updatedAt: now })
      .where(eq(adminUsers.id, current.id))
      .returning();
    const revokedSessions = input.active ? 0 : await revokeAllSessionsInTransaction(tx, current.id, now);
    await appendStaffAudit(tx, {
      aggregateType: "admin_user",
      aggregateId: updated.id,
      actorId: input.actor.id,
      action: input.active ? "STAFF_REENABLED" : "STAFF_DISABLED",
      before: `active:${current.active}`,
      after: `active:${updated.active}`,
      metadata: { sessionsRevoked: revokedSessions },
    });
    return updated;
  });
}

export async function revokeBoundStaffSessions(
  db: PriceCheckDb,
  input: { adminUserId: string; actor: StaffActor },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: adminUsers.id }).from(adminUsers)
      .where(eq(adminUsers.id, input.adminUserId)).limit(1);
    if (!current) throw new Error("The staff account is unavailable.");
    const count = await revokeAllSessionsInTransaction(tx, current.id, new Date());
    await appendStaffAudit(tx, {
      aggregateType: "admin_user",
      aggregateId: current.id,
      actorId: input.actor.id,
      action: "STAFF_SESSIONS_REVOKED",
      metadata: { sessionsRevoked: count },
    });
    return { count };
  });
}
