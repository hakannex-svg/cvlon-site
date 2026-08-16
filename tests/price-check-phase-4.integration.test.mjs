import assert from "node:assert/strict";
import test from "node:test";
import { NetlifyDB } from "@netlify/database-dev";

const migrationsDirectory = new URL("../netlify/database/migrations/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  try {
    const applied = await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ server, db, schema, applied });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

async function seedRequest(db) {
  const { createPriceCheckRequest } = await import("../db/price-check/repositories/request-repository.ts");
  return createPriceCheckRequest(db, {
    requester: { firstName: "Synthetic", lastName: "Reviewer", companyName: "Example Aviation Test", businessEmail: "phase4@example.com", phone: "+1 202 555 0134", role: "Buyer", country: "US", serviceProcessingAcknowledgedAt: new Date() },
    transaction: { originalPartNumber: "ABC-123", description: "Synthetic component", quantity: "1", quoteOrPurchased: "quote", transactionType: "exchange", conditionCode: "OH", unitPrice: "4500", currencyCode: "USD", coreCharge: "2500", coreDisposition: "REFUNDABLE", exchangeFee: "200", freight: "75", transactionDate: "2026-08-15", aircraftModel: "Synthetic aircraft", aog: true, warrantyValue: "12", warrantyUnit: "MONTHS", warrantyText: "Synthetic warranty", notes: "Synthetic only" },
    documentation: [{ code: "FAA_8130_3" }],
    attribution: { sourcePage: "/price-check" },
    idempotencyHash: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
  });
}

test("first verified Netlify Identity login binds an ADMIN, subsequent subject authorization is durable, and rebinding is denied", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    const { sql } = await import("drizzle-orm");
    const { bindOrAuthorizeAdmin } = await import("../db/price-check/repositories/admin-repository.ts");
    assert.equal(applied.length, 3);
    const identity = { issuer: "netlify-identity:synthetic-site", subject: "identity-subject-hakan", email: "hakannex@gmail.com", provider: "netlify-identity" };
    const first = await bindOrAuthorizeAdmin(db, identity, true);
    assert.equal(first.status, "bound");
    assert.equal(first.user.role, "ADMIN");
    const second = await bindOrAuthorizeAdmin(db, identity, false);
    assert.equal(second.status, "authorized");
    const conflict = await bindOrAuthorizeAdmin(db, { ...identity, subject: "different-subject" }, true);
    assert.equal(conflict.status, "binding_conflict");
    const denied = await bindOrAuthorizeAdmin(db, { ...identity, subject: "unauthorized", email: "hakan@shipnex.com" }, false);
    assert.equal(denied.status, "not_allowed");
    const [admins] = await db.select({ count: sql`count(*)::int` }).from(schema.adminUsers);
    assert.equal(admins.count, 1);
    const events = await db.select().from(schema.auditEvents);
    assert.ok(events.some(event => event.action === "ADMIN_LOGIN_BOUND"));
    assert.ok(events.some(event => event.action === "ADMIN_LOGIN"));
  });
});

test("inactive staff is rejected and local role remains authoritative", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const { bindOrAuthorizeAdmin } = await import("../db/price-check/repositories/admin-repository.ts");
    const identity = { issuer: "netlify-identity:synthetic-site", subject: "identity-subject-david", email: "david@cvlon.com", provider: "netlify-identity" };
    const bound = await bindOrAuthorizeAdmin(db, identity, true);
    await db.update(schema.adminUsers).set({ active: false, role: "AUDITOR" }).where(eq(schema.adminUsers.id, bound.user.id));
    const inactive = await bindOrAuthorizeAdmin(db, identity, true);
    assert.equal(inactive.status, "inactive");
  });
});

test("assignment, revision, normalization, status, and audit are transactional while original submission stays immutable", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const repository = await import("../db/price-check/repositories/admin-repository.ts");
    const identity = { issuer: "netlify-identity:synthetic-site", subject: "identity-subject-hakan", email: "hakannex@gmail.com", provider: "netlify-identity" };
    const admin = (await repository.bindOrAuthorizeAdmin(db, identity, true)).user;
    const created = await seedRequest(db);
    await repository.assignPriceCheck(db, { priceCheckId: created.priceCheckId, assigneeId: admin.id, actor: admin });
    const revised = await repository.createAdminRevision(db, { priceCheckId: created.priceCheckId, actor: admin, transaction: {
      originalPartNumber: "ABC-123-1", description: "Corrected synthetic component", quantity: "2", quoteOrPurchased: "quote", transactionType: "exchange", conditionCode: "OH", unitPrice: "4400", currencyCode: "USD", coreCharge: "2400", coreDisposition: "REFUNDABLE", exchangeFee: "180", freight: "70", transactionDate: "2026-08-15", aircraftModel: "Synthetic aircraft", aog: true, warrantyValue: "12", warrantyUnit: "MONTHS", warrantyText: "Synthetic warranty", documentationCodes: ["FAA_8130_3", "TEST_REPORT"], notes: "Synthetic correction", changeReason: "Customer clarification",
    }});
    assert.equal(revised.version, 2);
    await repository.changePriceCheckStatus(db, { priceCheckId: created.priceCheckId, to: "needs_information", actor: admin, action: "PRICE_CHECK_INFORMATION_REQUESTED", metadata: { category: "Documentation", customerNote: "Synthetic clarification", internalNote: null } });

    const [stored] = await db.select().from(schema.priceChecks).where(eq(schema.priceChecks.id, created.priceCheckId));
    assert.equal(stored.originalPartNumber, "ABC-123");
    assert.equal(stored.normalizedPartNumber, "ABC123");
    assert.equal(stored.assignedAdminUserId, admin.id);
    assert.equal(stored.status, "needs_information");
    const revisions = await db.select().from(schema.priceCheckRevisions).where(eq(schema.priceCheckRevisions.priceCheckId, created.priceCheckId));
    assert.equal(revisions.length, 2);
    assert.equal(revisions[1].normalizedSnapshot.originalPartNumber, "ABC-123-1");
    assert.equal(revisions[1].normalizedSnapshot.normalizedPartNumber, "ABC1231");
    const events = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, created.priceCheckId));
    for (const action of ["PRICE_CHECK_ASSIGNED", "PRICE_CHECK_REVISION_CREATED", "PRICE_CHECK_INFORMATION_REQUESTED", "PRICE_CHECK_STATUS_CHANGED"]) assert.ok(events.some(event => event.action === action), action);
  });
});

test("failed assignment and revision attempts leave the aggregate unchanged", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq, sql } = await import("drizzle-orm");
    const repository = await import("../db/price-check/repositories/admin-repository.ts");
    const admin = (await repository.bindOrAuthorizeAdmin(db, { issuer: "netlify-identity:synthetic-site", subject: "subject", email: "david@cvlon.com", provider: "netlify-identity" }, true)).user;
    const created = await seedRequest(db);
    await assert.rejects(repository.assignPriceCheck(db, { priceCheckId: created.priceCheckId, assigneeId: "01AAAAAAAAAAAAAAAAAAAAAAAA", actor: admin }));
    await assert.rejects(repository.createAdminRevision(db, { priceCheckId: "01BBBBBBBBBBBBBBBBBBBBBBBB", actor: admin, transaction: {} }));
    const [stored] = await db.select().from(schema.priceChecks).where(eq(schema.priceChecks.id, created.priceCheckId));
    assert.equal(stored.assignedAdminUserId, null);
    const [count] = await db.select({ count: sql`count(*)::int` }).from(schema.priceCheckRevisions).where(eq(schema.priceCheckRevisions.priceCheckId, created.priceCheckId));
    assert.equal(count.count, 1);
  });
});
