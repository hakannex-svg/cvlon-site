import assert from "node:assert/strict";
import test from "node:test";
import { NetlifyDB } from "@netlify/database-dev";

const migrationsDirectory = new URL(
  "../db/price-check/migrations-netlify-archive/",
  import.meta.url,
).pathname.replace(/^\/(\w:)/, "$1");
const identity = (email, subject) => ({ issuer: "https://accounts.google.com", subject, email, provider: "google-oidc", authenticationMethods: ["pwd", "mfa"] });

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

test("ADMIN creates pending staff, preserves role, rejects duplicates, and binds exact Google identity once", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const repository = await import("../db/price-check/repositories/admin-repository.ts");
    const admin = (await repository.bindOrAuthorizeAdmin(db, identity("hakannex@gmail.com", "admin-subject"), true)).user;
    const pending = await repository.createPendingStaff(db, { email: "  David@CVLON.com ", role: "ANALYST", actor: admin });
    assert.equal(pending.displayEmail, "david@cvlon.com");
    assert.equal(pending.role, "ANALYST");
    assert.equal(pending.identityProviderIssuer, "pending:civilon-google-oidc");
    assert.notEqual(pending.identityProviderSubject, "david@cvlon.com");
    await assert.rejects(repository.createPendingStaff(db, { email: "david@cvlon.com", role: "ADMIN", actor: admin }), /already exists/);
    const wrongEmail = await repository.bindOrAuthorizeAdmin(db, identity("other@cvlon.com", "wrong-subject"), false);
    assert.equal(wrongEmail.status, "not_allowed");
    const bound = await repository.bindOrAuthorizeAdmin(db, identity("david@cvlon.com", "david-google-subject"), false);
    assert.equal(bound.status, "bound");
    assert.equal(bound.user.role, "ANALYST");
    const [stored] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, pending.id));
    assert.equal(stored.identityProviderSubject, "david-google-subject");
    assert.equal((await repository.bindOrAuthorizeAdmin(db, identity("david@cvlon.com", "different-subject"), false)).status, "binding_conflict");
  });
});

test("role changes and disable revoke sessions, re-enable requires login, and final ADMIN is protected", async () => {
  await withDatabase(async ({ db }) => {
    const repository = await import("../db/price-check/repositories/admin-repository.ts");
    const sessions = await import("../db/price-check/repositories/session-repository.ts");
    const admin = (await repository.bindOrAuthorizeAdmin(db, identity("hakannex@gmail.com", "admin-subject-2"), true)).user;
    const staff = (await repository.createPendingStaff(db, { email: "reviewer@cvlon.com", role: "REVIEWER", actor: admin }));
    const bound = (await repository.bindOrAuthorizeAdmin(db, identity("reviewer@cvlon.com", "reviewer-subject"), false)).user;
    const session = await sessions.createAdminSession(db, bound.id, "staff-test-secret");
    await repository.updateStaff(db, { id: bound.id, action: "role", role: "AUDITOR", actor: admin });
    assert.equal(await sessions.resolveAdminSession(db, session.token, "staff-test-secret"), null);
    await repository.updateStaff(db, { id: bound.id, action: "disable", actor: admin });
    assert.equal((await repository.bindOrAuthorizeAdmin(db, identity("reviewer@cvlon.com", "reviewer-subject"), false)).status, "inactive");
    await repository.updateStaff(db, { id: bound.id, action: "enable", actor: admin });
    assert.equal((await repository.bindOrAuthorizeAdmin(db, identity("reviewer@cvlon.com", "reviewer-subject"), false)).status, "authorized");
    await assert.rejects(repository.updateStaff(db, { id: admin.id, action: "disable", actor: admin }), /At least one active Civilon administrator/);
    await assert.rejects(repository.updateStaff(db, { id: admin.id, action: "role", role: "REVIEWER", actor: admin }), /At least one active Civilon administrator/);
    assert.equal(staff.role, "REVIEWER");
  });
});
