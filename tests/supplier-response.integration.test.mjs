import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

import { migrationsDirectory } from "./helpers/migration-archive.mjs";

/** Real disposable Postgres, migrated from empty. No preview or production database. */
async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  try {
    await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const supplier = await import("../db/price-check/repositories/supplier-response-repository.ts");
    const reads = await import("../db/price-check/repositories/marketplace-admin-repository.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, supplier, reads });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

const ulid = (() => {
  let counter = 0;
  return (prefix) => {
    counter += 1;
    return `${prefix}${String(counter).padStart(26 - prefix.length, "0")}`;
  };
})();

const reference = (() => {
  let counter = 0;
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return (prefix) => {
    counter += 1;
    let value = "";
    let remaining = counter;
    for (let index = 0; index < 10; index += 1) {
      value = alphabet[remaining % 32] + value;
      remaining = Math.floor(remaining / 32);
    }
    return `${prefix}-${value}`;
  };
})();

const SUBMITTED_AT = new Date("2026-08-17T12:00:00Z");

async function insertAdmin(db, schema, overrides = {}) {
  const row = {
    id: ulid("AD"),
    identityProviderIssuer: "https://accounts.google.com",
    identityProviderSubject: ulid("SB"),
    displayEmail: `staff-${ulid("E")}@cvlon.com`,
    role: "ADMIN",
    ...overrides,
  };
  await db.insert(schema.adminUsers).values(row);
  return row;
}

async function insertContact(db, schema, overrides = {}) {
  const row = {
    id: ulid("CT"),
    firstName: "Dana",
    lastName: "Ruiz",
    companyName: "Example Aviation Group",
    businessEmail: "Dana.Ruiz@example.com",
    normalizedEmail: "dana.ruiz@example.com",
    country: "US",
    ...overrides,
  };
  await db.insert(schema.marketplaceContacts).values(row);
  return row;
}

async function insertBuyRequest(db, schema, contactId, overrides = {}) {
  const row = {
    id: ulid("BR"),
    publicReference: reference("BR"),
    contactId,
    originalPartNumber: "BR-PART-4100",
    normalizedPartNumber: "BRPART4100",
    description: "Hydraulic actuator",
    quantity: "2",
    notes: "Customer supplied note",
    sourcePage: "/buy-sell-aircraft-parts/buy",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: SUBMITTED_AT,
    ...overrides,
  };
  await db.insert(schema.buyRequests).values(row);
  return row;
}

const NONREGISTERED = {
  supplierKind: "nonregistered_supplier",
  supplierContactId: null,
  supplierNameSnapshot: "Acme Rotables Ltd",
  supplierContactSnapshot: "sourcing@acme-rotables.example",
  supplierCountry: "GB",
  offeredPartNumber: "BR-PART-4100",
  statedCondition: "SV",
  quantityAvailable: "2",
  supplierUnitCost: null,
  currencyCode: null,
  quoteOnRequest: true,
  availabilityState: "subject_to_confirmation",
  locationText: "London hub",
  leadTimeDays: 14,
  documentsSummary: "Supplier says a trace file exists",
  shippingNotes: "Supplier can ship direct",
  expiresAt: null,
};

const ACTOR = (admin) => ({ id: admin.id, role: admin.role });

async function responsesFor(db, schema, buyRequestId) {
  const { eq } = await import("drizzle-orm");
  return db.select().from(schema.supplierResponses)
    .where(eq(schema.supplierResponses.buyRequestId, buyRequestId));
}

async function auditFor(db, schema, aggregateId) {
  const { eq } = await import("drizzle-orm");
  return db.select().from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, aggregateId));
}

/* ------------------------------------------------------------------ create */

test("a nonregistered supplier response is recorded, audited, and defaults to a claim", async () => {
  await withDatabase(async ({ db, schema, supplier, reads }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const before = (await db.select().from(schema.buyRequests))[0];

    const result = await supplier.recordSupplierResponse(db, {
      buyRequestId: buyRequest.id, response: NONREGISTERED, actor: ACTOR(admin),
    });
    assert.equal(result.ok, true);

    const [stored] = await responsesFor(db, schema, buyRequest.id);
    assert.equal(stored.supplierKind, "nonregistered_supplier");
    assert.equal(stored.supplierContactId, null);
    assert.equal(stored.supplierNameSnapshot, "Acme Rotables Ltd");
    assert.equal(stored.supplierContactSnapshot, "sourcing@acme-rotables.example");
    assert.equal(stored.supplierCountry, "GB");
    assert.equal(stored.status, "received");
    assert.equal(stored.availabilityState, "subject_to_confirmation", "a supplier claim is never a Civilon confirmation");
    assert.equal(stored.quoteOnRequest, true);
    assert.equal(stored.supplierUnitCost, null);
    assert.equal(stored.recordedByAdminUserId, admin.id);
    assert.ok(stored.receivedAt instanceof Date, "received_at is server generated");
    assert.equal(stored.normalizedPartNumber, "BRPART4100");

    // The audit row names the response, never the supplier or the cost.
    const audit = await auditFor(db, schema, buyRequest.id);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "SUPPLIER_RESPONSE_RECORDED");
    assert.equal(audit[0].aggregateType, "buy_request");
    assert.equal(audit[0].actorId, admin.id);
    const auditText = JSON.stringify(audit[0]);
    for (const secret of ["Acme Rotables Ltd", "sourcing@acme-rotables.example", "London hub", "trace file", "ship direct"]) {
      assert.equal(auditText.includes(secret), false, `audit leaked ${secret}`);
    }

    // The Buy Request itself is untouched: no status change, no intake rewrite.
    const [after] = await db.select().from(schema.buyRequests);
    assert.deepEqual(after, before, "recording a supplier response must not touch the Buy Request");

    // No outbox row: nobody was contacted.
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 0);
    // No buyer offer was invented.
    assert.equal((await db.select().from(schema.buyerOffers)).length, 0);

    // The detail read surfaces it on the internal side only.
    const detail = await reads.getBuyRequestAdminDetail(db, buyRequest.id);
    assert.equal(detail.supplierResponses.length, 1);
    assert.equal(detail.buyerOffers.length, 0);
  });
});

test("a registered supplier must be live and seller-capable", async () => {
  await withDatabase(async ({ db, schema, supplier }) => {
    const admin = await insertAdmin(db, schema);
    const buyer = await insertContact(db, schema, { actsAsBuyer: true, actsAsSeller: false });
    const seller = await insertContact(db, schema, { companyName: "Halcyon Rotables", actsAsSeller: true, country: "NL" });
    const deleted = await insertContact(db, schema, { actsAsSeller: true, deletedAt: new Date("2026-08-16T00:00:00Z") });
    const buyRequest = await insertBuyRequest(db, schema, buyer.id);

    const registered = { ...NONREGISTERED, supplierKind: "registered_contact", supplierNameSnapshot: null, supplierCountry: null };

    // A buyer-only contact, a deleted contact and an unknown id are all refused
    // with the same answer, and none of them writes a row.
    for (const [label, contactId] of [
      ["buyer-only", buyer.id],
      ["deleted", deleted.id],
      ["unknown", ulid("CT")],
    ]) {
      const refused = await supplier.recordSupplierResponse(db, {
        buyRequestId: buyRequest.id,
        response: { ...registered, supplierContactId: contactId },
        actor: ACTOR(admin),
      });
      assert.deepEqual(refused, { ok: false, reason: "contact_unavailable" }, label);
    }
    assert.equal((await responsesFor(db, schema, buyRequest.id)).length, 0, "no partial row");
    assert.equal((await auditFor(db, schema, buyRequest.id)).length, 0, "no audit for a refusal");

    // The seller-capable contact works, and its name and country are snapshotted.
    const ok = await supplier.recordSupplierResponse(db, {
      buyRequestId: buyRequest.id,
      response: { ...registered, supplierContactId: seller.id },
      actor: ACTOR(admin),
    });
    assert.equal(ok.ok, true);
    const [stored] = await responsesFor(db, schema, buyRequest.id);
    assert.equal(stored.supplierKind, "registered_contact");
    assert.equal(stored.supplierContactId, seller.id);
    assert.equal(stored.supplierNameSnapshot, "Halcyon Rotables");
    assert.equal(stored.supplierCountry, "NL");

    // Only seller-capable, live contacts are offered to the form.
    const offered = await supplier.listSellerCapableContacts(db);
    assert.deepEqual(offered.map((row) => row.id), [seller.id]);
  });
});

test("an unknown Buy Request writes nothing", async () => {
  await withDatabase(async ({ db, schema, supplier }) => {
    const admin = await insertAdmin(db, schema);
    const missing = await supplier.recordSupplierResponse(db, {
      buyRequestId: ulid("BR"), response: NONREGISTERED, actor: ACTOR(admin),
    });
    assert.deepEqual(missing, { ok: false, reason: "not_found" });
    assert.equal((await db.select().from(schema.supplierResponses)).length, 0);
    assert.equal((await db.select().from(schema.auditEvents)).length, 0);
  });
});

test("optional pricing and quote-on-request persist exactly as given", async () => {
  await withDatabase(async ({ db, schema, supplier }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);

    await supplier.recordSupplierResponse(db, {
      buyRequestId: buyRequest.id,
      response: { ...NONREGISTERED, supplierUnitCost: "1800.50", currencyCode: "USD", quoteOnRequest: false },
      actor: ACTOR(admin),
    });
    await supplier.recordSupplierResponse(db, {
      buyRequestId: buyRequest.id,
      response: { ...NONREGISTERED, supplierNameSnapshot: "Second supplier" },
      actor: ACTOR(admin),
    });

    const rows = await responsesFor(db, schema, buyRequest.id);
    const priced = rows.find((row) => row.supplierNameSnapshot === "Acme Rotables Ltd");
    const quoted = rows.find((row) => row.supplierNameSnapshot === "Second supplier");
    assert.equal(priced.supplierUnitCost, "1800.50");
    assert.equal(priced.currencyCode, "USD");
    assert.equal(priced.quoteOnRequest, false);
    assert.equal(quoted.supplierUnitCost, null);
    assert.equal(quoted.currencyCode, null);
    assert.equal(quoted.quoteOnRequest, true);

    // Every availability value round-trips, and the default records no claim.
    for (const state of ["claimed_available", "claimed_lead_time", "unavailable", "unknown"]) {
      const created = await supplier.recordSupplierResponse(db, {
        buyRequestId: buyRequest.id,
        response: { ...NONREGISTERED, supplierNameSnapshot: `S-${state}`, availabilityState: state },
        actor: ACTOR(admin),
      });
      assert.equal(created.ok, true, state);
    }
    const all = await responsesFor(db, schema, buyRequest.id);
    assert.equal(all.filter((row) => row.availabilityState === "subject_to_confirmation").length, 2);
  });
});

test("the schema refuses an invalid kind and contact combination", async () => {
  await withDatabase(async ({ db, schema, supplier }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema, { actsAsSeller: true });
    const buyRequest = await insertBuyRequest(db, schema, contact.id);

    // Bypassing validation: the database is still the backstop.
    let threw = false;
    try {
      await supplier.recordSupplierResponse(db, {
        buyRequestId: buyRequest.id,
        response: { ...NONREGISTERED, supplierNameSnapshot: null },
        actor: ACTOR(admin),
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, true, "supplier_responses_supplier_kind_chk must refuse a nameless nonregistered supplier");
    assert.equal((await responsesFor(db, schema, buyRequest.id)).length, 0);
    assert.equal((await auditFor(db, schema, buyRequest.id)).length, 0, "a rolled-back insert leaves no audit row");
  });
});

/* ------------------------------------------------------------------ status */

test("every legal supplier status edge succeeds and is audited", async () => {
  await withDatabase(async ({ db, schema, supplier }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);

    const chain = ["received", "under_review", "shortlisted", "selected", "declined"];
    const created = await supplier.recordSupplierResponse(db, {
      buyRequestId: buyRequest.id, response: NONREGISTERED, actor: ACTOR(admin),
    });
    const responseId = created.data.supplierResponseId;

    for (let index = 0; index < chain.length - 1; index += 1) {
      const result = await supplier.changeSupplierResponseStatus(db, {
        buyRequestId: buyRequest.id, supplierResponseId: responseId,
        expectedStatus: chain[index], to: chain[index + 1], actor: ACTOR(admin),
      });
      assert.equal(result.ok, true, `${chain[index]} -> ${chain[index + 1]}`);
    }

    const [stored] = await responsesFor(db, schema, buyRequest.id);
    assert.equal(stored.status, "declined");

    const audit = await auditFor(db, schema, buyRequest.id);
    assert.equal(audit.length, chain.length, "one create plus one row per transition");
    assert.equal(audit.filter((row) => row.action === "SUPPLIER_RESPONSE_STATUS_CHANGED").length, chain.length - 1);

    // Selecting a supplier created no buyer offer and moved no Buy Request.
    assert.equal((await db.select().from(schema.buyerOffers)).length, 0);
    assert.equal((await db.select().from(schema.buyRequests))[0].status, "pending_verification");
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 0);
  });
});

test("illegal, terminal, stale and cross-parent status changes are refused", async () => {
  await withDatabase(async ({ db, schema, supplier }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const first = await insertBuyRequest(db, schema, contact.id);
    const second = await insertBuyRequest(db, schema, contact.id);

    const created = await supplier.recordSupplierResponse(db, {
      buyRequestId: first.id, response: NONREGISTERED, actor: ACTOR(admin),
    });
    const responseId = created.data.supplierResponseId;

    // Illegal edge: received straight to selected.
    assert.deepEqual(await supplier.changeSupplierResponseStatus(db, {
      buyRequestId: first.id, supplierResponseId: responseId,
      expectedStatus: "received", to: "selected", actor: ACTOR(admin),
    }), { ok: false, reason: "forbidden_transition" });

    // Cross-parent: the response belongs to the first Buy Request.
    assert.deepEqual(await supplier.changeSupplierResponseStatus(db, {
      buyRequestId: second.id, supplierResponseId: responseId,
      expectedStatus: "received", to: "under_review", actor: ACTOR(admin),
    }), { ok: false, reason: "not_found" });

    // Unknown response id under the right parent.
    assert.deepEqual(await supplier.changeSupplierResponseStatus(db, {
      buyRequestId: first.id, supplierResponseId: ulid("SR"),
      expectedStatus: "received", to: "under_review", actor: ACTOR(admin),
    }), { ok: false, reason: "not_found" });

    // Stale: someone else moved it first.
    await supplier.changeSupplierResponseStatus(db, {
      buyRequestId: first.id, supplierResponseId: responseId,
      expectedStatus: "received", to: "under_review", actor: ACTOR(admin),
    });
    const stale = await supplier.changeSupplierResponseStatus(db, {
      buyRequestId: first.id, supplierResponseId: responseId,
      expectedStatus: "received", to: "declined", actor: ACTOR(admin),
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "conflict");
    assert.equal(stale.currentStatus, "under_review");
    assert.equal((await responsesFor(db, schema, first.id))[0].status, "under_review", "a stale write must not overwrite");

    // Terminal: no resurrection.
    await supplier.changeSupplierResponseStatus(db, {
      buyRequestId: first.id, supplierResponseId: responseId,
      expectedStatus: "under_review", to: "withdrawn", actor: ACTOR(admin),
    });
    for (const to of ["received", "under_review", "shortlisted", "selected", "declined", "expired"]) {
      assert.deepEqual(await supplier.changeSupplierResponseStatus(db, {
        buyRequestId: first.id, supplierResponseId: responseId,
        expectedStatus: "withdrawn", to, actor: ACTOR(admin),
      }), { ok: false, reason: "forbidden_transition" }, `withdrawn -> ${to}`);
    }
    assert.equal((await responsesFor(db, schema, first.id))[0].status, "withdrawn");

    // Two successful moves, and only those, were audited.
    const audit = await auditFor(db, schema, first.id);
    assert.equal(audit.filter((row) => row.action === "SUPPLIER_RESPONSE_STATUS_CHANGED").length, 2);
  });
});

test("a failed audit rolls the supplier write back", async () => {
  await withDatabase(async ({ db, schema, supplier }) => {
    const { sql } = await import("drizzle-orm");
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);

    await db.execute(sql`alter table audit_events add constraint tmp_block check (action <> 'SUPPLIER_RESPONSE_RECORDED')`);
    let threw = false;
    try {
      await supplier.recordSupplierResponse(db, {
        buyRequestId: buyRequest.id, response: NONREGISTERED, actor: ACTOR(admin),
      });
    } catch {
      threw = true;
    }
    await db.execute(sql`alter table audit_events drop constraint tmp_block`);

    assert.equal(threw, true);
    assert.equal((await responsesFor(db, schema, buyRequest.id)).length, 0, "the response must roll back with its audit row");
    assert.equal((await auditFor(db, schema, buyRequest.id)).length, 0);
  });
});

test("supplier data never reaches a buyer offer built alongside it", async () => {
  await withDatabase(async ({ db, schema, supplier, reads }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const created = await supplier.recordSupplierResponse(db, {
      buyRequestId: buyRequest.id, response: NONREGISTERED, actor: ACTOR(admin),
    });

    // A buyer offer that IS linked in the database, as slice 6 will create it.
    await db.insert(schema.buyerOffers).values({
      id: ulid("BO"),
      buyRequestId: buyRequest.id,
      selectedSupplierResponseId: created.data.supplierResponseId,
      version: 1,
      civilonSaleUnitPrice: "2400.00",
      currencyCode: "USD",
      quantity: "2",
      deliveryOption: "nj_pickup",
      createdByAdminUserId: admin.id,
    });

    const detail = await reads.getBuyRequestAdminDetail(db, buyRequest.id);
    const offer = detail.buyerOffers[0];
    const offerText = JSON.stringify(offer);
    for (const secret of [
      "Acme Rotables Ltd", "sourcing@acme-rotables.example", "London hub",
      "Supplier says a trace file exists", "Supplier can ship direct", "GB",
      created.data.supplierResponseId,
    ]) {
      assert.equal(offerText.includes(secret), false, `the buyer offer leaked ${secret}`);
    }
    assert.equal("selectedSupplierResponseId" in offer, false);
    // The internal side still has all of it.
    assert.equal(detail.supplierResponses[0].supplierUnitCost, null);
    assert.equal(detail.supplierResponses[0].supplierNameSnapshot, "Acme Rotables Ltd");
  });
});
