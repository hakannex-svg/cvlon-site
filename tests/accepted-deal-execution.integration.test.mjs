import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";
import { migrationsDirectory } from "./helpers/migration-archive.mjs";

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  try {
    await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const acceptedDeals = await import("../db/price-check/repositories/accepted-deal-repository.ts");
    const offers = await import("../db/price-check/repositories/buyer-offer-repository.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, acceptedDeals, offers });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

const id = (() => {
  let counter = 0;
  return prefix => {
    counter += 1;
    return `${prefix}${String(counter).padStart(26 - prefix.length, "0")}`;
  };
})();

const publicReference = (() => {
  let counter = 0;
  return () => `BR-${String(++counter).padStart(10, "0")}`;
})();

const NOW = new Date("2026-08-19T01:00:00Z");
const OFFER = {
  civilonSaleUnitPrice: "1.00",
  currencyCode: "USD",
  quantity: "1.00",
  statedCondition: "SV",
  documentsSummary: "Synthetic test only",
  deliveryOption: "door_delivery",
  shippingAndExportScope: "Synthetic test only",
  leadTimeDays: 1,
  expiresAt: null,
  selectedSupplierResponseId: null,
};

async function insertAdmin(db, schema) {
  const row = {
    id: id("AD"),
    identityProviderIssuer: "https://accounts.google.com",
    identityProviderSubject: id("SB"),
    displayEmail: `${id("E")}@cvlon.com`,
    role: "ADMIN",
  };
  await db.insert(schema.adminUsers).values(row);
  return row;
}

async function insertContact(db, schema) {
  const email = `${id("M")}@example.com`.toLowerCase();
  const row = {
    id: id("CT"),
    firstName: "Synthetic",
    lastName: "Buyer",
    companyName: "Civilon QA",
    businessEmail: email,
    normalizedEmail: email,
  };
  await db.insert(schema.marketplaceContacts).values(row);
  return row;
}

async function insertRequest(db, schema, contactId, status) {
  const row = {
    id: id("BR"),
    publicReference: publicReference(),
    contactId,
    status,
    originalPartNumber: "SYNTHETIC-EXECUTION-TEST",
    normalizedPartNumber: "SYNTHETICEXECUTIONTEST",
    quantity: "1",
    sourcePage: "/buy-sell-aircraft-parts/buy",
    idempotencyHash: `hash-${id("H")}`,
    submittedAt: NOW,
    verifiedAt: status === "pending_verification" ? null : NOW,
  };
  await db.insert(schema.buyRequests).values(row);
  return row;
}

async function createOfferInStatus(offers, db, requestId, admin, status) {
  const created = await offers.createBuyerOffer(db, {
    buyRequestId: requestId,
    offer: OFFER,
    actor: { id: admin.id, role: admin.role },
    now: NOW,
  });
  assert.equal(created.ok, true);
  if (status === "draft") return created.data;
  assert.equal((await offers.changeBuyerOfferStatus(db, {
    buyRequestId: requestId,
    buyerOfferId: created.data.buyerOfferId,
    expectedStatus: "draft",
    to: "sent",
    actor: { id: admin.id, role: admin.role },
    now: NOW,
  })).ok, true);
  if (status === "sent") return created.data;
  assert.equal((await offers.changeBuyerOfferStatus(db, {
    buyRequestId: requestId,
    buyerOfferId: created.data.buyerOfferId,
    expectedStatus: "sent",
    to: status,
    actor: { id: admin.id, role: admin.role },
    now: NOW,
  })).ok, true);
  return created.data;
}

async function requestRow(db, schema, requestId) {
  const { eq } = await import("drizzle-orm");
  return (await db.select().from(schema.buyRequests).where(eq(schema.buyRequests.id, requestId)))[0];
}

test("verified, sourcing and quoted accepted deals start execution directly with one audit and no outbox", async () => {
  await withDatabase(async ({ db, schema, acceptedDeals, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const { eq } = await import("drizzle-orm");

    for (const status of ["verified", "sourcing", "quoted"]) {
      const request = await insertRequest(db, schema, contact.id, status);
      const accepted = await createOfferInStatus(offers, db, request.id, admin, "accepted");
      const auditBefore = (await db.select().from(schema.auditEvents)
        .where(eq(schema.auditEvents.aggregateId, request.id))).length;
      const outboxBefore = (await db.select().from(schema.notificationOutbox)).length;

      const result = await acceptedDeals.startAcceptedDealExecution(db, {
        buyRequestId: request.id,
        expectedStatus: status,
        actorId: admin.id,
        now: new Date("2026-08-19T01:05:00Z"),
      });
      assert.deepEqual(result, {
        ok: true,
        data: { from: status, to: "converted", offerVersion: accepted.version },
      });
      const stored = await requestRow(db, schema, request.id);
      assert.equal(stored.status, "converted");
      assert.equal(stored.closedAt, null, "Converted remains open work");

      const audit = await db.select().from(schema.auditEvents)
        .where(eq(schema.auditEvents.aggregateId, request.id));
      assert.equal(audit.length, auditBefore + 1);
      const event = audit.find(row => row.action === "BUY_REQUEST_EXECUTION_STARTED");
      assert.ok(event);
      assert.equal(event.actorId, admin.id);
      assert.equal(event.beforeVersionReference, `status:${status}`);
      assert.equal(event.afterVersionReference, "status:converted");
      assert.deepEqual(event.sanitizedMetadata, {
        from: status,
        to: "converted",
        buyerOfferId: accepted.buyerOfferId,
        offerVersion: accepted.version,
      });
      assert.equal((await db.select().from(schema.notificationOutbox)).length, outboxBefore);
    }
  });
});

test("missing, stale, ineligible and non-current acceptances are refused without changing the request", async () => {
  await withDatabase(async ({ db, schema, acceptedDeals, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);

    const missing = await acceptedDeals.startAcceptedDealExecution(db, {
      buyRequestId: id("BR"), expectedStatus: "verified", actorId: admin.id, now: NOW,
    });
    assert.deepEqual(missing, { ok: false, reason: "not_found" });

    const noOffer = await insertRequest(db, schema, contact.id, "verified");
    assert.deepEqual(await acceptedDeals.startAcceptedDealExecution(db, {
      buyRequestId: noOffer.id, expectedStatus: "verified", actorId: admin.id, now: NOW,
    }), { ok: false, reason: "latest_offer_not_accepted" });

    const stale = await insertRequest(db, schema, contact.id, "verified");
    await createOfferInStatus(offers, db, stale.id, admin, "accepted");
    assert.deepEqual(await acceptedDeals.startAcceptedDealExecution(db, {
      buyRequestId: stale.id, expectedStatus: "sourcing", actorId: admin.id, now: NOW,
    }), { ok: false, reason: "conflict", currentStatus: "verified" });

    for (const status of ["pending_verification", "converted", "closed", "spam", "withdrawn"]) {
      const request = await insertRequest(db, schema, contact.id, status);
      await createOfferInStatus(offers, db, request.id, admin, "accepted");
      const result = await acceptedDeals.startAcceptedDealExecution(db, {
        buyRequestId: request.id,
        expectedStatus: status,
        actorId: admin.id,
        now: NOW,
      });
      assert.deepEqual(result, { ok: false, reason: "ineligible_status" }, status);
      assert.equal((await requestRow(db, schema, request.id)).status, status);
    }

    for (const newestStatus of ["draft", "sent", "declined", "expired", "superseded", "withdrawn"]) {
      const request = await insertRequest(db, schema, contact.id, "quoted");
      await createOfferInStatus(offers, db, request.id, admin, "accepted");
      await createOfferInStatus(offers, db, request.id, admin, newestStatus);
      const result = await acceptedDeals.startAcceptedDealExecution(db, {
        buyRequestId: request.id,
        expectedStatus: "quoted",
        actorId: admin.id,
        now: NOW,
      });
      assert.deepEqual(result, { ok: false, reason: "latest_offer_not_accepted" }, newestStatus);
      assert.equal((await requestRow(db, schema, request.id)).status, "quoted");
    }
  });
});
