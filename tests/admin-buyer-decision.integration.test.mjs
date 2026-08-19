import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

import { migrationsDirectory } from "./helpers/migration-archive.mjs";

const SUBMITTED_AT = new Date("2026-08-17T12:00:00Z");
const VERIFIED_AT = new Date("2026-08-17T12:30:00Z");
const SENT_AT = new Date("2026-08-18T10:00:00Z");
const RESPONDED_AT = new Date("2026-08-18T11:00:00Z");

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  try {
    await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const repository = await import("../db/price-check/repositories/marketplace-admin-repository.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    try {
      await run({ db, schema, repository });
    } finally {
      await db.$client.end();
    }
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

const ulid = (() => {
  let counter = 0;
  return (prefix) => `${prefix}${String(++counter).padStart(26 - prefix.length, "0")}`;
})();

const reference = (() => {
  let counter = 0;
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return () => {
    let value = "";
    let remaining = ++counter;
    for (let index = 0; index < 10; index += 1) {
      value = alphabet[remaining % 32] + value;
      remaining = Math.floor(remaining / 32);
    }
    return `BR-${value}`;
  };
})();

async function insertContact(db, schema) {
  const id = ulid("CT");
  await db.insert(schema.marketplaceContacts).values({
    id,
    firstName: "Dana",
    lastName: "Ruiz",
    companyName: `Example Aviation ${id.slice(-4)}`,
    businessEmail: `${id.toLowerCase()}@example.com`,
    normalizedEmail: `${id.toLowerCase()}@example.com`,
    verificationState: "VERIFIED",
    verifiedAt: VERIFIED_AT,
  });
  return id;
}

async function insertBuyRequest(db, schema, overrides = {}) {
  const contactId = await insertContact(db, schema);
  const row = {
    id: ulid("BR"),
    publicReference: reference(),
    contactId,
    originalPartNumber: `PN-${ulid("P")}`,
    normalizedPartNumber: `PN${ulid("N")}`,
    quantity: "1",
    status: "verified",
    sourcePage: "/buy-sell-aircraft-parts/buy",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: SUBMITTED_AT,
    verifiedAt: VERIFIED_AT,
    ...overrides,
  };
  await db.insert(schema.buyRequests).values(row);
  return row;
}

async function insertOffer(db, schema, buyRequestId, version, status) {
  const decided = status === "accepted" || status === "declined";
  const row = {
    id: ulid("BO"),
    buyRequestId,
    version,
    civilonSaleUnitPrice: "2500.00",
    currencyCode: "USD",
    quantity: "1",
    deliveryOption: "door_delivery",
    status,
    sentAt: status === "draft" ? null : SENT_AT,
    respondedAt: decided ? RESPONDED_AT : null,
    supersededAt: status === "superseded" ? RESPONDED_AT : null,
  };
  await db.insert(schema.buyerOffers).values(row);
  return row;
}

test("latest buyer decisions count and filter the same distinct open Buy Requests", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const noOffer = await insertBuyRequest(db, schema);

    const staleDecline = await insertBuyRequest(db, schema);
    await insertOffer(db, schema, staleDecline.id, 1, "declined");
    await insertOffer(db, schema, staleDecline.id, 2, "sent");

    const accepted = await insertBuyRequest(db, schema, { status: "sourcing" });
    await insertOffer(db, schema, accepted.id, 1, "accepted");

    const declined = await insertBuyRequest(db, schema, { status: "quoted" });
    await insertOffer(db, schema, declined.id, 1, "superseded");
    await insertOffer(db, schema, declined.id, 2, "declined");

    const latestAccepted = await insertBuyRequest(db, schema);
    await insertOffer(db, schema, latestAccepted.id, 1, "declined");
    await insertOffer(db, schema, latestAccepted.id, 2, "superseded");
    await insertOffer(db, schema, latestAccepted.id, 3, "accepted");

    const staleAcceptance = await insertBuyRequest(db, schema);
    await insertOffer(db, schema, staleAcceptance.id, 1, "accepted");
    await insertOffer(db, schema, staleAcceptance.id, 2, "draft");

    for (const status of ["converted", "closed", "spam", "withdrawn"]) {
      const concluded = await insertBuyRequest(db, schema, { status });
      await insertOffer(db, schema, concluded.id, 1, status === "closed" ? "declined" : "accepted");
    }

    const requestsBefore = await db.select().from(schema.buyRequests);
    const offersBefore = await db.select().from(schema.buyerOffers);

    assert.deepEqual(await repository.countBuyerDecisions(db), {
      accepted: 2,
      declined: 1,
    });

    const acceptedRows = await repository.listUnifiedAdminQueue(db, {
      type: "buy_request",
      decision: "accepted",
    });
    const declinedRows = await repository.listUnifiedAdminQueue(db, {
      type: "buy_request",
      decision: "declined",
    });
    assert.deepEqual(
      new Set(acceptedRows.map((row) => row.id)),
      new Set([accepted.id, latestAccepted.id]),
    );
    assert.deepEqual(declinedRows.map((row) => row.id), [declined.id]);
    assert.equal(acceptedRows.some((row) => row.id === noOffer.id), false);
    assert.equal(acceptedRows.some((row) => row.id === staleAcceptance.id), false);
    assert.equal(declinedRows.some((row) => row.id === staleDecline.id), false);

    assert.deepEqual(
      await repository.listUnifiedAdminQueue(db, { type: "buy_request", decision: "accepted'--" }),
      [],
      "a malformed decision fails closed instead of widening the list",
    );

    for (const row of [...acceptedRows, ...declinedRows]) {
      assert.deepEqual(Object.keys(row).sort(), [
        "assigneeEmail", "assigneeId", "businessReviewState", "companyName", "contactName",
        "id", "partNumber", "publicReference", "status", "submittedAt", "type", "urgency",
        "verificationState",
      ].sort());
    }

    assert.deepEqual(await db.select().from(schema.buyRequests), requestsBefore);
    assert.deepEqual(await db.select().from(schema.buyerOffers), offersBefore);
  });
});
