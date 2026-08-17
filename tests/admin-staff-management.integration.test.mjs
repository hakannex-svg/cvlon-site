import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NetlifyDB } from "@netlify/database-dev";

const migrationsDirectory = new URL("../netlify/database/migrations/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const sessionSecret = "synthetic-staff-management-session-secret-long-enough";
const identity = (email, subject) => ({
  issuer: "https://accounts.google.com",
  subject,
  email,
  provider: "google-oidc",
  authenticationMethods: ["pwd", "mfa"],
});

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  try {
    await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

async function bootstrapAdmin(db, email = "admin@example.com", subject = "admin-subject") {
  const admins = await import("../db/price-check/repositories/admin-repository.ts");
  return (await admins.bindOrAuthorizeAdmin(db, identity(email, subject), true)).user;
}

test("ADMIN can invite exactly one pending staff authorization and preserve the selected role", async () => {
  await withDatabase(async ({ db, schema }) => {
    const staff = await import("../db/price-check/repositories/staff-repository.ts");
    const actor = await bootstrapAdmin(db);
    const invitation = await staff.createStaffInvitation(db, {
      normalizedEmail: "future.analyst@example.com",
      displayEmail: "Future.Analyst@example.com",
      role: "ANALYST",
      actor,
    });
    assert.equal(invitation.status, "PENDING");
    assert.equal(invitation.role, "ANALYST");
    await assert.rejects(staff.createStaffInvitation(db, {
      normalizedEmail: "future.analyst@example.com",
      displayEmail: "future.analyst@example.com",
      role: "REVIEWER",
      actor,
    }), /active invitation/i);
    const invitations = await db.select().from(schema.adminStaffInvitations);
    assert.equal(invitations.length, 1);
  });
});

test("only an exact pending invitation may bind a first Google identity and immutable subject conflicts remain denied", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const admins = await import("../db/price-check/repositories/admin-repository.ts");
    const staff = await import("../db/price-check/repositories/staff-repository.ts");
    const actor = await bootstrapAdmin(db);
    const invitation = await staff.createStaffInvitation(db, {
      normalizedEmail: "reviewer@example.com",
      displayEmail: "reviewer@example.com",
      role: "REVIEWER",
      actor,
    });
    const uninvited = await admins.bindOrAuthorizeAdmin(db, identity("not-invited@example.com", "outside-subject"), false);
    assert.equal(uninvited.status, "not_allowed");
    assert.equal((await staff.bindInvitedAdmin(db, identity("not-invited@example.com", "outside-subject"))).status, "not_allowed");
    assert.equal((await staff.bindInvitedAdmin(db, identity("wrong@example.com", "wrong-subject"))).status, "not_allowed");

    const bound = await staff.bindInvitedAdmin(db, identity("reviewer@example.com", "reviewer-google-subject"));
    assert.equal(bound.status, "bound");
    assert.equal(bound.user.role, "REVIEWER");
    assert.equal(bound.user.identityProviderIssuer, "https://accounts.google.com");
    assert.equal(bound.user.identityProviderSubject, "reviewer-google-subject");
    const conflict = await admins.bindOrAuthorizeAdmin(db, identity("reviewer@example.com", "substitution-subject"), false);
    assert.equal(conflict.status, "binding_conflict");

    const [storedInvitation] = await db.select().from(schema.adminStaffInvitations).where(eq(schema.adminStaffInvitations.id, invitation.id));
    assert.equal(storedInvitation.status, "ACCEPTED");
    assert.ok(storedInvitation.acceptedAt);
    const events = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, bound.user.id));
    assert.ok(events.some((event) => event.action === "STAFF_IDENTITY_BOUND"));
  });
});

test("role changes, disable, re-enable, and explicit session revocation enforce server-side access immediately", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const staff = await import("../db/price-check/repositories/staff-repository.ts");
    const sessions = await import("../db/price-check/repositories/session-repository.ts");
    const actor = await bootstrapAdmin(db);
    const user = await bootstrapAdmin(db, "worker@example.com", "worker-subject");
    const roleSession = await sessions.createAdminSession(db, user.id, sessionSecret);
    await staff.changeBoundStaffRole(db, { adminUserId: user.id, role: "AUDITOR", actor });
    assert.equal(await sessions.resolveAdminSession(db, roleSession.token, sessionSecret), null);
    const disabledSession = await sessions.createAdminSession(db, user.id, sessionSecret);
    await staff.setBoundStaffActive(db, { adminUserId: user.id, active: false, actor });
    assert.equal(await sessions.resolveAdminSession(db, disabledSession.token, sessionSecret), null);
    await staff.setBoundStaffActive(db, { adminUserId: user.id, active: true, actor });
    assert.equal(await sessions.resolveAdminSession(db, disabledSession.token, sessionSecret), null);
    const newSession = await sessions.createAdminSession(db, user.id, sessionSecret);
    await staff.revokeBoundStaffSessions(db, { adminUserId: user.id, actor });
    assert.equal(await sessions.resolveAdminSession(db, newSession.token, sessionSecret), null);
    const events = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, user.id));
    for (const action of ["STAFF_ROLE_CHANGED", "STAFF_DISABLED", "STAFF_REENABLED", "STAFF_SESSIONS_REVOKED"]) assert.ok(events.some((event) => event.action === action), action);
  });
});

test("pending invitations can change role or revoke, while the final active ADMIN remains protected", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const staff = await import("../db/price-check/repositories/staff-repository.ts");
    const actor = await bootstrapAdmin(db);
    const invitation = await staff.createStaffInvitation(db, {
      normalizedEmail: "pending@example.com", displayEmail: "pending@example.com", role: "ANALYST", actor,
    });
    const changed = await staff.changeInvitationRole(db, { invitationId: invitation.id, role: "AUDITOR", actor });
    assert.equal(changed.role, "AUDITOR");
    const revoked = await staff.revokeStaffInvitation(db, { invitationId: invitation.id, actor });
    assert.equal(revoked.status, "REVOKED");
    await assert.rejects(staff.setBoundStaffActive(db, { adminUserId: actor.id, active: false, actor }), /final active ADMIN/i);
    await assert.rejects(staff.changeBoundStaffRole(db, { adminUserId: actor.id, role: "REVIEWER", actor }), /final active ADMIN/i);
    const events = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, invitation.id));
    for (const action of ["STAFF_INVITED", "STAFF_INVITATION_ROLE_CHANGED", "STAFF_INVITATION_REVOKED"]) assert.ok(events.some((event) => event.action === action), action);
  });
});

test("staff mutation routes require the ADMIN capability, same-origin protection, and server-validated IDs", async () => {
  const [createRoute, invitationRoute, userRoute] = await Promise.all([
    readFile(new URL("../app/api/admin/staff/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/staff/invitations/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/staff/users/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  for (const route of [createRoute, invitationRoute, userRoute]) {
    assert.match(route, /verifyAdminMutationOrigin/);
    assert.match(route, /requireAdminApi\("manage_staff"\)/);
  }
  assert.match(invitationRoute, /isStaffId\(id\)/);
  assert.match(userRoute, /isStaffId\(id\)/);
  const policy = await import("../lib/price-check/admin/policy.ts");
  for (const role of ["ANALYST", "REVIEWER", "AUDITOR"]) assert.equal(policy.roleCan(role, "manage_staff"), false, role);
  assert.equal(policy.roleCan("ADMIN", "manage_staff"), true);
});
