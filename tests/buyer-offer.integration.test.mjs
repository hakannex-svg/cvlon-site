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
    const offers = await import("../db/price-check/repositories/buyer-offer-repository.ts");
    const supplier = await import("../db/price-check/repositories/supplier-response-repository.ts");
    const reads = await import("../db/price-check/repositories/marketplace-admin-repository.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, offers, supplier, reads });
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
const OFFER = {
  civilonSaleUnitPrice: "2400.00",
  currencyCode: "USD",
  quantity: "2.00",
  statedCondition: "SV",
  documentsSummary: "Trace paperwork where available",
  deliveryOption: "nj_pickup",
  shippingAndExportScope: "Delivered duty unpaid",
  leadTimeDays: 21,
  expiresAt: null,
  selectedSupplierResponseId: null,
};

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
    quantity: "2",
    sourcePage: "/buy-sell-aircraft-parts/buy",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: SUBMITTED_AT,
    ...overrides,
  };
  await db.insert(schema.buyRequests).values(row);
  return row;
}

const SUPPLIER = {
  supplierKind: "nonregistered_supplier",
  supplierContactId: null,
  supplierNameSnapshot: "Acme Rotables Ltd",
  supplierContactSnapshot: "sourcing@acme-rotables.example",
  supplierCountry: "GB",
  offeredPartNumber: "BR-PART-4100",
  statedCondition: "SV",
  quantityAvailable: "2",
  supplierUnitCost: "1800.00",
  currencyCode: "USD",
  quoteOnRequest: false,
  availabilityState: "subject_to_confirmation",
  locationText: "London hub",
  leadTimeDays: 14,
  documentsSummary: "Supplier says a trace file exists",
  shippingNotes: "Supplier can ship direct",
  expiresAt: null,
};

const ACTOR = (admin) => ({ id: admin.id, role: admin.role });

async function offersFor(db, schema, buyRequestId) {
  const { asc, eq } = await import("drizzle-orm");
  return db.select().from(schema.buyerOffers)
    .where(eq(schema.buyerOffers.buyRequestId, buyRequestId))
    .orderBy(asc(schema.buyerOffers.version));
}

async function auditFor(db, schema, aggregateId) {
  const { eq } = await import("drizzle-orm");
  return db.select().from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, aggregateId));
}

/* ------------------------------------------------------------- versioning */

test("the first draft is version 1 and versions climb from there", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const before = (await db.select().from(schema.buyRequests))[0];

    const first = await offers.createBuyerOffer(db, { buyRequestId: buyRequest.id, offer: OFFER, actor: ACTOR(admin) });
    assert.equal(first.ok, true);
    assert.equal(first.data.version, 1);
    assert.equal("supersededOfferId" in first.data, false, "create reports no supersede");
    assert.equal(first.data.replacedDraftId, null);

    const [stored] = await offersFor(db, schema, buyRequest.id);
    assert.equal(stored.status, "draft");
    assert.equal(stored.sentAt, null, "a draft has never been sent");
    assert.equal(stored.civilonSaleUnitPrice, "2400.00");
    assert.equal(stored.deliveryOption, "nj_pickup");
    assert.equal(stored.createdByAdminUserId, admin.id);

    // The Buy Request and the outbox are untouched.
    assert.deepEqual((await db.select().from(schema.buyRequests))[0], before);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 0);

    const audit = await auditFor(db, schema, buyRequest.id);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "BUYER_OFFER_DRAFTED");
    const auditText = JSON.stringify(audit[0]);
    assert.equal(auditText.includes("2400.00"), false, "the audit must not carry the price");
  });
});

test("a new draft replaces an unsent draft and keeps versions climbing", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);

    const first = await offers.createBuyerOffer(db, { buyRequestId: buyRequest.id, offer: OFFER, actor: ACTOR(admin) });
    const second = await offers.createBuyerOffer(db, {
      buyRequestId: buyRequest.id,
      offer: { ...OFFER, civilonSaleUnitPrice: "2500.00" },
      actor: ACTOR(admin),
    });
    assert.equal(second.data.version, 2, "versions never reuse a number");
    assert.equal(second.data.replacedDraftId, first.data.buyerOfferId);
    assert.equal("supersededOfferId" in second.data, false);

    const rows = await offersFor(db, schema, buyRequest.id);
    assert.equal(rows.length, 1, "only the current draft survives");
    assert.equal(rows[0].version, 2);
    assert.equal(rows[0].civilonSaleUnitPrice, "2500.00");

    // The replacement is in the append-only trail even though the row is gone.
    const audit = await auditFor(db, schema, buyRequest.id);
    assert.equal(audit.filter((row) => row.action === "BUYER_OFFER_DRAFT_REPLACED").length, 1);
    assert.equal(audit.filter((row) => row.action === "BUYER_OFFER_DRAFTED").length, 2);
  });
});

test("a sent offer stays live until the replacement is actually sent", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const other = await insertBuyRequest(db, schema, contact.id);

    // Another Buy Request with its own sent offer, to prove parent binding.
    const foreign = await offers.createBuyerOffer(db, { buyRequestId: other.id, offer: OFFER, actor: ACTOR(admin) });
    await offers.changeBuyerOfferStatus(db, {
      buyRequestId: other.id, buyerOfferId: foreign.data.buyerOfferId,
      expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    });
    const foreignBefore = (await offersFor(db, schema, other.id))[0];

    // 1. Create v1 and mark it sent.
    const first = await offers.createBuyerOffer(db, { buyRequestId: buyRequest.id, offer: OFFER, actor: ACTOR(admin) });
    await offers.changeBuyerOfferStatus(db, {
      buyRequestId: buyRequest.id, buyerOfferId: first.data.buyerOfferId,
      expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    });
    const v1AfterSend = (await offersFor(db, schema, buyRequest.id))[0];
    assert.equal(v1AfterSend.status, "sent");

    // 2. Create v2 as a draft. v1 must be byte-identical: the buyer still holds
    //    it, and this draft may never be sent.
    const second = await offers.createBuyerOffer(db, {
      buyRequestId: buyRequest.id, offer: { ...OFFER, civilonSaleUnitPrice: "2600.00" }, actor: ACTOR(admin),
    });
    assert.equal(second.data.version, 2);
    assert.equal("supersededOfferId" in second.data, false, "create no longer reports a supersede");
    assert.equal(second.data.replacedDraftId, null);

    let rows = await offersFor(db, schema, buyRequest.id);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], v1AfterSend, "v1 is untouched by drafting v2");
    assert.equal(rows[0].status, "sent");
    assert.equal(rows[0].supersededAt, null);
    assert.equal(rows[1].status, "draft");
    assert.equal(
      (await auditFor(db, schema, buyRequest.id)).filter((row) => row.action === "BUYER_OFFER_SUPERSEDED").length,
      0,
      "nothing is superseded merely by drafting",
    );

    // 3. A stale send of v2 changes nothing at all.
    const stale = await offers.changeBuyerOfferStatus(db, {
      buyRequestId: buyRequest.id, buyerOfferId: second.data.buyerOfferId,
      expectedStatus: "sent", to: "accepted", actor: ACTOR(admin),
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "conflict");
    rows = await offersFor(db, schema, buyRequest.id);
    assert.deepEqual(rows[0], v1AfterSend, "a failed send must not supersede v1");
    assert.equal(rows[1].status, "draft");

    // 4. Sending v2 supersedes v1, in the same transaction, preserving its terms.
    const sent = await offers.changeBuyerOfferStatus(db, {
      buyRequestId: buyRequest.id, buyerOfferId: second.data.buyerOfferId,
      expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    });
    assert.equal(sent.ok, true);

    rows = await offersFor(db, schema, buyRequest.id);
    assert.equal(rows.length, 2, "the superseded offer is kept as history");
    assert.equal(rows[0].status, "superseded");
    assert.notEqual(rows[0].supersededAt, null);
    assert.deepEqual(rows[0].sentAt, v1AfterSend.sentAt, "its send record survives unchanged");
    assert.equal(rows[0].civilonSaleUnitPrice, "2400.00", "its terms are not rewritten");
    assert.equal(rows[0].deliveryOption, v1AfterSend.deliveryOption);
    assert.equal(rows[0].respondedAt, null, "superseding is not a buyer response");
    assert.equal(rows[1].status, "sent");
    assert.notEqual(rows[1].sentAt, null);
    assert.equal(rows[1].civilonSaleUnitPrice, "2600.00");

    // 5. Audit: exactly one supersede row, complete and minimal.
    const audit = await auditFor(db, schema, buyRequest.id);
    const superseded = audit.filter((row) => row.action === "BUYER_OFFER_SUPERSEDED");
    assert.equal(superseded.length, 1);
    assert.deepEqual(superseded[0].sanitizedMetadata, {
      buyerOfferId: first.data.buyerOfferId, version: 1, supersededByVersion: 2,
    });
    assert.equal(superseded[0].actorId, admin.id);
    // Two sends, each with its own status row.
    assert.equal(audit.filter((row) => row.action === "BUYER_OFFER_STATUS_CHANGED").length, 2);

    // 6. The other Buy Request's sent offer was never touched.
    assert.deepEqual((await offersFor(db, schema, other.id))[0], foreignBefore);
  });
});

test("sending supersedes nothing when there is no other sent offer", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);

    const first = await offers.createBuyerOffer(db, { buyRequestId: buyRequest.id, offer: OFFER, actor: ACTOR(admin) });
    await offers.changeBuyerOfferStatus(db, {
      buyRequestId: buyRequest.id, buyerOfferId: first.data.buyerOfferId,
      expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    });
    const audit = await auditFor(db, schema, buyRequest.id);
    assert.equal(audit.filter((row) => row.action === "BUYER_OFFER_SUPERSEDED").length, 0);
    assert.equal((await offersFor(db, schema, buyRequest.id))[0].supersededAt, null);
  });
});

test("accepted and other terminal history is never touched by a new draft", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);

    const first = await offers.createBuyerOffer(db, { buyRequestId: buyRequest.id, offer: OFFER, actor: ACTOR(admin) });
    await offers.changeBuyerOfferStatus(db, {
      buyRequestId: buyRequest.id, buyerOfferId: first.data.buyerOfferId,
      expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    });
    await offers.changeBuyerOfferStatus(db, {
      buyRequestId: buyRequest.id, buyerOfferId: first.data.buyerOfferId,
      expectedStatus: "sent", to: "accepted", actor: ACTOR(admin),
    });
    const acceptedBefore = (await offersFor(db, schema, buyRequest.id))[0];

    const second = await offers.createBuyerOffer(db, {
      buyRequestId: buyRequest.id, offer: { ...OFFER, civilonSaleUnitPrice: "9999.00" }, actor: ACTOR(admin),
    });
    assert.equal(second.data.version, 2);
    assert.equal("supersededOfferId" in second.data, false, "create reports no supersede");
    assert.equal(second.data.replacedDraftId, null);

    const rows = await offersFor(db, schema, buyRequest.id);
    assert.deepEqual(rows[0], acceptedBefore, "accepted history is byte-identical afterwards");
    assert.equal(rows[0].status, "accepted");
    assert.notEqual(rows[0].respondedAt, null);
  });
});

test("a concurrent second draft cannot reuse a version", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);

    // Two drafts raced onto the same version would violate
    // buyer_offers_version_uidx; one transaction must fail rather than reuse it.
    const results = await Promise.allSettled([
      offers.createBuyerOffer(db, { buyRequestId: buyRequest.id, offer: OFFER, actor: ACTOR(admin) }),
      offers.createBuyerOffer(db, { buyRequestId: buyRequest.id, offer: OFFER, actor: ACTOR(admin) }),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.ok);
    const rows = await offersFor(db, schema, buyRequest.id);
    const versions = rows.map((row) => row.version);
    assert.equal(new Set(versions).size, versions.length, "no version is reused");
    assert.ok(succeeded.length >= 1, "at least one draft lands");
    assert.ok(rows.length >= 1);
  });
});

/* --------------------------------------------------- the internal pointer */

test("the selected supplier response must belong to the same Buy Request", async () => {
  await withDatabase(async ({ db, schema, offers, supplier, reads }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const first = await insertBuyRequest(db, schema, contact.id);
    const second = await insertBuyRequest(db, schema, contact.id);

    const mine = await supplier.recordSupplierResponse(db, {
      buyRequestId: first.id, response: SUPPLIER, actor: ACTOR(admin),
    });
    const theirs = await supplier.recordSupplierResponse(db, {
      buyRequestId: second.id, response: SUPPLIER, actor: ACTOR(admin),
    });

    // A response from the other Buy Request is refused, and nothing is written.
    const refused = await offers.createBuyerOffer(db, {
      buyRequestId: first.id,
      offer: { ...OFFER, selectedSupplierResponseId: theirs.data.supplierResponseId },
      actor: ACTOR(admin),
    });
    assert.deepEqual(refused, { ok: false, reason: "supplier_response_unavailable" });
    assert.equal((await offersFor(db, schema, first.id)).length, 0);

    // An unknown id is refused the same way.
    assert.deepEqual(await offers.createBuyerOffer(db, {
      buyRequestId: first.id, offer: { ...OFFER, selectedSupplierResponseId: ulid("SR") }, actor: ACTOR(admin),
    }), { ok: false, reason: "supplier_response_unavailable" });

    // The right one works, and the pointer is stored but never projected.
    const ok = await offers.createBuyerOffer(db, {
      buyRequestId: first.id,
      offer: { ...OFFER, selectedSupplierResponseId: mine.data.supplierResponseId },
      actor: ACTOR(admin),
    });
    assert.equal(ok.ok, true);
    const [stored] = await offersFor(db, schema, first.id);
    assert.equal(stored.selectedSupplierResponseId, mine.data.supplierResponseId);

    const detail = await reads.getBuyRequestAdminDetail(db, first.id);
    const projected = detail.buyerOffers[0];
    assert.equal("selectedSupplierResponseId" in projected, false);
    const text = JSON.stringify(projected);
    for (const secret of [
      mine.data.supplierResponseId, "Acme Rotables Ltd", "sourcing@acme-rotables.example",
      "1800.00", "London hub", "Supplier can ship direct", "Supplier says a trace file exists", "GB",
    ]) {
      assert.equal(text.includes(secret), false, `the offer leaked ${secret}`);
    }
    // And the supplier response was not modified by drafting an offer.
    const [supplierRow] = await db.select().from(schema.supplierResponses)
      .where((await import("drizzle-orm")).eq(schema.supplierResponses.id, mine.data.supplierResponseId));
    assert.equal(supplierRow.status, "received");
  });
});

/* ------------------------------------------------------------------ status */

test("the legal path runs draft to sent to a buyer response, with honest timestamps", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const created = await offers.createBuyerOffer(db, { buyRequestId: buyRequest.id, offer: OFFER, actor: ACTOR(admin) });
    const offerId = created.data.buyerOfferId;

    // A draft is not sent until someone explicitly says so.
    assert.equal((await offersFor(db, schema, buyRequest.id))[0].sentAt, null);

    const sent = await offers.changeBuyerOfferStatus(db, {
      buyRequestId: buyRequest.id, buyerOfferId: offerId,
      expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    });
    assert.equal(sent.ok, true);
    const afterSend = (await offersFor(db, schema, buyRequest.id))[0];
    assert.equal(afterSend.status, "sent");
    assert.notEqual(afterSend.sentAt, null);
    assert.equal(afterSend.respondedAt, null, "sending is not a buyer response");

    const accepted = await offers.changeBuyerOfferStatus(db, {
      buyRequestId: buyRequest.id, buyerOfferId: offerId,
      expectedStatus: "sent", to: "accepted", actor: ACTOR(admin),
    });
    assert.equal(accepted.ok, true);
    const afterAccept = (await offersFor(db, schema, buyRequest.id))[0];
    assert.notEqual(afterAccept.respondedAt, null);
    assert.equal(afterAccept.supersededAt, null);

    // Nothing else moved.
    assert.equal((await db.select().from(schema.buyRequests))[0].status, "pending_verification");
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 0);
  });
});

test("expiry and withdrawal never fabricate a buyer response", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);

    for (const to of ["expired", "withdrawn"]) {
      const buyRequest = await insertBuyRequest(db, schema, contact.id);
      const created = await offers.createBuyerOffer(db, { buyRequestId: buyRequest.id, offer: OFFER, actor: ACTOR(admin) });
      await offers.changeBuyerOfferStatus(db, {
        buyRequestId: buyRequest.id, buyerOfferId: created.data.buyerOfferId,
        expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
      });
      const result = await offers.changeBuyerOfferStatus(db, {
        buyRequestId: buyRequest.id, buyerOfferId: created.data.buyerOfferId,
        expectedStatus: "sent", to, actor: ACTOR(admin),
      });
      assert.equal(result.ok, true, to);
      const [stored] = await offersFor(db, schema, buyRequest.id);
      assert.equal(stored.status, to);
      assert.equal(stored.respondedAt, null, `${to} must not invent a buyer response`);
      assert.equal(stored.supersededAt, null, to);
    }
  });
});

test("illegal, stale, terminal and cross-parent status changes are refused", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const first = await insertBuyRequest(db, schema, contact.id);
    const second = await insertBuyRequest(db, schema, contact.id);
    const created = await offers.createBuyerOffer(db, { buyRequestId: first.id, offer: OFFER, actor: ACTOR(admin) });
    const offerId = created.data.buyerOfferId;

    // A draft cannot jump straight to accepted, or be withdrawn: the schema
    // makes every non-draft status require a sent_at.
    for (const to of ["accepted", "declined", "withdrawn", "superseded", "expired"]) {
      assert.deepEqual(await offers.changeBuyerOfferStatus(db, {
        buyRequestId: first.id, buyerOfferId: offerId, expectedStatus: "draft", to, actor: ACTOR(admin),
      }), { ok: false, reason: "forbidden_transition" }, `draft -> ${to}`);
    }

    // Cross-parent and unknown ids.
    assert.deepEqual(await offers.changeBuyerOfferStatus(db, {
      buyRequestId: second.id, buyerOfferId: offerId, expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    }), { ok: false, reason: "not_found" });
    assert.deepEqual(await offers.changeBuyerOfferStatus(db, {
      buyRequestId: first.id, buyerOfferId: ulid("BO"), expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    }), { ok: false, reason: "not_found" });

    // Stale.
    await offers.changeBuyerOfferStatus(db, {
      buyRequestId: first.id, buyerOfferId: offerId, expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    });
    const stale = await offers.changeBuyerOfferStatus(db, {
      buyRequestId: first.id, buyerOfferId: offerId, expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "conflict");
    assert.equal(stale.currentStatus, "sent");

    // Terminal: no resurrection.
    await offers.changeBuyerOfferStatus(db, {
      buyRequestId: first.id, buyerOfferId: offerId, expectedStatus: "sent", to: "declined", actor: ACTOR(admin),
    });
    for (const to of ["draft", "sent", "accepted", "expired", "withdrawn", "superseded"]) {
      assert.deepEqual(await offers.changeBuyerOfferStatus(db, {
        buyRequestId: first.id, buyerOfferId: offerId, expectedStatus: "declined", to, actor: ACTOR(admin),
      }), { ok: false, reason: "forbidden_transition" }, `declined -> ${to}`);
    }
    assert.equal((await offersFor(db, schema, first.id))[0].status, "declined");
  });
});

test("an expiry already in the past is refused rather than throwing", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const created = await offers.createBuyerOffer(db, {
      buyRequestId: buyRequest.id,
      offer: { ...OFFER, expiresAt: new Date("2020-01-01T00:00:00Z") },
      actor: ACTOR(admin),
    });
    const refused = await offers.changeBuyerOfferStatus(db, {
      buyRequestId: buyRequest.id, buyerOfferId: created.data.buyerOfferId,
      expectedStatus: "draft", to: "sent", actor: ACTOR(admin),
    });
    assert.deepEqual(refused, { ok: false, reason: "expiry_in_past" });
    assert.equal((await offersFor(db, schema, buyRequest.id))[0].status, "draft");
  });
});

test("a failed audit rolls the offer write back", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const { sql } = await import("drizzle-orm");
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);

    await db.execute(sql`alter table audit_events add constraint tmp_block check (action <> 'BUYER_OFFER_DRAFTED')`);
    let threw = false;
    try {
      await offers.createBuyerOffer(db, { buyRequestId: buyRequest.id, offer: OFFER, actor: ACTOR(admin) });
    } catch {
      threw = true;
    }
    await db.execute(sql`alter table audit_events drop constraint tmp_block`);

    assert.equal(threw, true);
    assert.equal((await offersFor(db, schema, buyRequest.id)).length, 0, "the offer rolls back with its audit row");
    assert.equal((await auditFor(db, schema, buyRequest.id)).length, 0);
  });
});

/* -------------------------------------- delivery, secure view and response */

test("delivery requires verified buyer email and a future expiry", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const created = await offers.createBuyerOffer(db, {
      buyRequestId: buyRequest.id,
      offer: { ...OFFER, expiresAt: new Date("2026-09-01T00:00:00Z") },
      actor: ACTOR(admin),
    });
    const unverified = await offers.queueBuyerOfferDelivery(db, {
      buyRequestId: buyRequest.id,
      buyerOfferId: created.data.buyerOfferId,
      expectedStatus: "draft",
      actor: ACTOR(admin),
      now: new Date("2026-08-18T00:00:00Z"),
    });
    assert.deepEqual(unverified, { ok: false, reason: "buyer_unverified" });
    assert.equal((await offersFor(db, schema, buyRequest.id))[0].status, "draft");
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 0);

    await db.update(schema.marketplaceContacts).set({
      verificationState: "VERIFIED",
      verifiedAt: new Date("2026-08-17T12:05:00Z"),
    });
    await db.update(schema.buyRequests).set({
      status: "verified",
      verifiedAt: new Date("2026-08-17T12:05:00Z"),
    });
    const queued = await offers.queueBuyerOfferDelivery(db, {
      buyRequestId: buyRequest.id,
      buyerOfferId: created.data.buyerOfferId,
      expectedStatus: "draft",
      actor: ACTOR(admin),
      now: new Date("2026-08-18T00:00:00Z"),
    });
    assert.equal(queued.ok, true);
    const [stored] = await offersFor(db, schema, buyRequest.id);
    assert.equal(stored.status, "sent");
    assert.equal(stored.sentAt.toISOString(), "2026-08-18T00:00:00.000Z");
    const [message] = await db.select().from(schema.notificationOutbox);
    assert.equal(message.messageType, "BUYER_OFFER_TO_BUYER");
    assert.equal(message.aggregateType, "buyer_offer");
    assert.equal(message.aggregateId, stored.id);
    const audit = await auditFor(db, schema, buyRequest.id);
    assert.equal(audit.filter((row) => row.action === "BUYER_OFFER_DELIVERY_QUEUED").length, 1);
    assert.equal(JSON.stringify(audit).includes("2400.00"), false);
  });
});

test("one exact token-bound offer can be accepted once and only one internal notice is queued", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema, {
      verificationState: "VERIFIED",
      verifiedAt: new Date("2026-08-17T12:05:00Z"),
    });
    const buyRequest = await insertBuyRequest(db, schema, contact.id, {
      status: "verified",
      verifiedAt: new Date("2026-08-17T12:05:00Z"),
    });
    const created = await offers.createBuyerOffer(db, {
      buyRequestId: buyRequest.id,
      offer: { ...OFFER, expiresAt: new Date("2026-09-01T00:00:00Z") },
      actor: ACTOR(admin),
    });
    await offers.queueBuyerOfferDelivery(db, {
      buyRequestId: buyRequest.id,
      buyerOfferId: created.data.buyerOfferId,
      expectedStatus: "draft",
      actor: ACTOR(admin),
      now: new Date("2026-08-18T00:00:00Z"),
    });
    const record = await offers.loadBuyerOfferCustomerRecord(db, created.data.buyerOfferId, new Date("2026-08-18T01:00:00Z"));
    assert.ok(record);
    const { deriveBuyerOfferToken } = await import("../lib/marketplace/buyer-offer-token.ts");
    const { viewBuyerOffer, respondToBuyerOffer } = await import("../lib/marketplace/buyer-offer-service.ts");
    const key = "buyer-offer-test-signing-key-at-least-32-characters";
    const token = deriveBuyerOfferToken(key, {
      buyerOfferId: record.buyerOfferId,
      version: record.version,
      sentAt: record.sentAt,
      expiresAt: record.expiresAt,
    });
    const viewed = await viewBuyerOffer(db, { token, tokenKey: key, now: new Date("2026-08-18T01:00:00Z") });
    assert.equal(viewed.outcome, "available");
    assert.equal(viewed.status, "awaiting_response");
    assert.deepEqual(Object.keys(viewed.offer).sort(), [
      "currencyCode", "deliveryOption", "disclosure", "documentsSummary", "expiresAt",
      "leadTimeDays", "quantity", "reference", "saleUnitPrice", "shippingAndExportScope",
      "statedCondition", "version",
    ].sort());
    for (const secret of ["Acme Rotables", "1800.00", "selectedSupplierResponseId", "supplier"] ) {
      assert.equal(JSON.stringify(viewed.offer).includes(secret), false, secret);
    }

    const accepted = await respondToBuyerOffer(db, {
      token, tokenKey: key, decision: "accepted", now: new Date("2026-08-18T01:05:00Z"),
    });
    assert.deepEqual(accepted, { outcome: "recorded", decision: "accepted" });
    const replay = await respondToBuyerOffer(db, {
      token, tokenKey: key, decision: "accepted", now: new Date("2026-08-18T01:06:00Z"),
    });
    assert.deepEqual(replay, { outcome: "already_recorded", decision: "accepted" });
    const opposite = await respondToBuyerOffer(db, {
      token, tokenKey: key, decision: "declined", now: new Date("2026-08-18T01:07:00Z"),
    });
    assert.deepEqual(opposite, { outcome: "unavailable" });

    const [stored] = await offersFor(db, schema, buyRequest.id);
    assert.equal(stored.status, "accepted");
    assert.equal(stored.respondedAt.toISOString(), "2026-08-18T01:05:00.000Z");
    const messages = await db.select().from(schema.notificationOutbox);
    assert.equal(messages.filter((message) => message.messageType === "BUYER_OFFER_RESPONSE_INTERNAL").length, 1);
    const responseAudit = (await auditFor(db, schema, buyRequest.id))
      .filter((row) => row.action === "BUYER_OFFER_BUYER_RESPONDED");
    assert.equal(responseAudit.length, 1);
    assert.deepEqual(responseAudit[0].sanitizedMetadata, {
      buyerOfferId: stored.id, version: 1, decision: "accepted",
    });
    assert.equal(responseAudit[0].actorType, "SYSTEM");
  });
});

test("tampered, expired and superseded offer credentials cannot respond", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema, {
      verificationState: "VERIFIED", verifiedAt: SUBMITTED_AT,
    });
    const buyRequest = await insertBuyRequest(db, schema, contact.id, {
      status: "verified", verifiedAt: SUBMITTED_AT,
    });
    const first = await offers.createBuyerOffer(db, {
      buyRequestId: buyRequest.id,
      offer: { ...OFFER, expiresAt: new Date("2026-08-25T00:00:00Z") }, actor: ACTOR(admin),
    });
    await offers.queueBuyerOfferDelivery(db, {
      buyRequestId: buyRequest.id, buyerOfferId: first.data.buyerOfferId,
      expectedStatus: "draft", actor: ACTOR(admin), now: new Date("2026-08-18T00:00:00Z"),
    });
    const firstRecord = await offers.loadBuyerOfferCustomerRecord(db, first.data.buyerOfferId, new Date("2026-08-18T01:00:00Z"));
    const { deriveBuyerOfferToken } = await import("../lib/marketplace/buyer-offer-token.ts");
    const { respondToBuyerOffer } = await import("../lib/marketplace/buyer-offer-service.ts");
    const key = "buyer-offer-test-signing-key-at-least-32-characters";
    const token = deriveBuyerOfferToken(key, {
      buyerOfferId: firstRecord.buyerOfferId,
      version: firstRecord.version,
      sentAt: firstRecord.sentAt,
      expiresAt: firstRecord.expiresAt,
    });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    assert.deepEqual(await respondToBuyerOffer(db, {
      token: tampered, tokenKey: key, decision: "accepted", now: new Date("2026-08-18T02:00:00Z"),
    }), { outcome: "unavailable" });

    const second = await offers.createBuyerOffer(db, {
      buyRequestId: buyRequest.id,
      offer: { ...OFFER, expiresAt: new Date("2026-08-26T00:00:00Z"), civilonSaleUnitPrice: "2600.00" },
      actor: ACTOR(admin),
    });
    await offers.queueBuyerOfferDelivery(db, {
      buyRequestId: buyRequest.id, buyerOfferId: second.data.buyerOfferId,
      expectedStatus: "draft", actor: ACTOR(admin), now: new Date("2026-08-18T03:00:00Z"),
    });
    assert.deepEqual(await respondToBuyerOffer(db, {
      token, tokenKey: key, decision: "accepted", now: new Date("2026-08-18T04:00:00Z"),
    }), { outcome: "unavailable" });
    assert.deepEqual(await respondToBuyerOffer(db, {
      token, tokenKey: key, decision: "accepted", now: new Date("2026-08-26T00:00:00Z"),
    }), { outcome: "unavailable" });
  });
});

test("registered preview handlers deliver the buyer offer and the internal response notice", async () => {
  await withDatabase(async ({ db, schema, offers }) => {
    const priorKey = process.env.MARKETPLACE_VERIFY_TOKEN_KEY;
    const priorOrigin = process.env.MARKETPLACE_PREVIEW_ORIGIN;
    process.env.MARKETPLACE_VERIFY_TOKEN_KEY = "preview-buyer-offer-signing-key-at-least-32-characters";
    process.env.MARKETPLACE_PREVIEW_ORIGIN = "https://deploy-preview-21--cvlon.netlify.app";
    try {
      const admin = await insertAdmin(db, schema);
      const contact = await insertContact(db, schema, {
        verificationState: "VERIFIED", verifiedAt: SUBMITTED_AT,
      });
      const buyRequest = await insertBuyRequest(db, schema, contact.id, {
        status: "verified", verifiedAt: SUBMITTED_AT,
      });
      const created = await offers.createBuyerOffer(db, {
        buyRequestId: buyRequest.id,
        offer: { ...OFFER, expiresAt: new Date("2026-09-01T00:00:00Z") }, actor: ACTOR(admin),
      });
      await offers.queueBuyerOfferDelivery(db, {
        buyRequestId: buyRequest.id, buyerOfferId: created.data.buyerOfferId,
        expectedStatus: "draft", actor: ACTOR(admin), now: new Date("2026-08-18T00:00:00Z"),
      });
      const delivered = [];
      const provider = {
        async send(email) {
          delivered.push(email);
          return { providerMessageId: `test-message-${delivered.length}` };
        },
      };
      const { processNextNotification } = await import("../lib/notifications/outbox-worker.ts");
      const { marketplaceNotificationHandlers, registeredNotificationTypes } = await import("../lib/notifications/registry.ts");
      const first = await processNextNotification(db, {
        handlers: marketplaceNotificationHandlers,
        reservedMessageTypes: registeredNotificationTypes(),
        provider,
        now: new Date("2026-08-18T00:01:00Z"),
        leaseOwner: "buyer-offer-test-worker-1",
      });
      assert.equal(first.status, "succeeded");
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].to, contact.businessEmail);
      for (const secret of ["Acme Rotables", "1800.00", "sourcing@acme", "selectedSupplierResponseId"]) {
        assert.equal(JSON.stringify(delivered[0]).includes(secret), false, secret);
      }
      const link = delivered[0].textBody.match(/Review and respond: (https:\/\/\S+)/)?.[1];
      assert.ok(link);
      const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
      assert.ok(token);
      const { respondToBuyerOffer } = await import("../lib/marketplace/buyer-offer-service.ts");
      const response = await respondToBuyerOffer(db, {
        token,
        tokenKey: process.env.MARKETPLACE_VERIFY_TOKEN_KEY,
        decision: "declined",
        now: new Date("2026-08-18T00:02:00Z"),
      });
      assert.deepEqual(response, { outcome: "recorded", decision: "declined" });
      const second = await processNextNotification(db, {
        handlers: marketplaceNotificationHandlers,
        reservedMessageTypes: registeredNotificationTypes(),
        provider,
        now: new Date("2026-08-18T00:03:00Z"),
        leaseOwner: "buyer-offer-test-worker-2",
      });
      assert.equal(second.status, "succeeded");
      assert.equal(delivered.length, 2);
      assert.match(delivered[1].to, /sales@cvlon\.com/);
      assert.match(delivered[1].to, /hakan@shipnex\.com/);
      assert.match(delivered[1].to, /david@cvlon\.com/);
      assert.match(delivered[1].textBody, /Buyer response: declined/);
      const outbox = await db.select().from(schema.notificationOutbox);
      assert.equal(outbox.every((row) => row.state === "succeeded"), true);
    } finally {
      if (priorKey === undefined) delete process.env.MARKETPLACE_VERIFY_TOKEN_KEY;
      else process.env.MARKETPLACE_VERIFY_TOKEN_KEY = priorKey;
      if (priorOrigin === undefined) delete process.env.MARKETPLACE_PREVIEW_ORIGIN;
      else process.env.MARKETPLACE_PREVIEW_ORIGIN = priorOrigin;
    }
  });
});
