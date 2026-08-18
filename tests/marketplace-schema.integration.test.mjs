import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

import {
  archivedMigrationDirectories,
  expectedMigrationCount,
  migrationsDirectory,
} from "./helpers/migration-archive.mjs";

/**
 * Mirrors the `withDatabase` shape used by the Price Check integration suites:
 * a real disposable Postgres from `@netlify/database-dev`, migrated from empty.
 * Nothing here touches a preview or production database.
 */
async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  try {
    const applied = await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const { sql } = await import("drizzle-orm");
    const db = drizzle({ schema });
    /** Raw catalog/DDL probe. Statements are literal test text, never user input. */
    const raw = async (statement) => (await db.execute(sql.raw(statement))).rows;
    await run({ server, db, schema, applied, raw });
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
    originalPartNumber: "TEST-BR-001",
    normalizedPartNumber: "TESTBR001",
    quantity: "2",
    sourcePage: "/buy-sell-aircraft-parts/buy",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: SUBMITTED_AT,
    ...overrides,
  };
  await db.insert(schema.buyRequests).values(row);
  return row;
}

async function insertSellSubmission(db, schema, contactId, overrides = {}) {
  const row = {
    id: ulid("SS"),
    publicReference: reference("SS"),
    contactId,
    submissionKind: "single_part",
    originalPartNumber: "TEST-SS-001",
    normalizedPartNumber: "TESTSS001",
    sourcePage: "/buy-sell-aircraft-parts/sell",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: SUBMITTED_AT,
    ...overrides,
  };
  await db.insert(schema.sellSubmissions).values(row);
  return row;
}

/** Asserts an insert is refused, and that the named constraint is the reason. */
async function rejects(promiseFactory, constraintFragment) {
  let error;
  try {
    await promiseFactory();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `expected a rejection mentioning ${constraintFragment}`);
  const text = `${error.message} ${error.constraint ?? ""} ${error.cause?.message ?? ""}`;
  assert.match(text, new RegExp(constraintFragment));
}

/* ------------------------------------------------------------------------ */

test("all archived migrations apply from an empty database", async () => {
  await withDatabase(async ({ applied, raw }) => {
    const directories = archivedMigrationDirectories();
    assert.equal(directories.length, 9);
    assert.equal(applied.length, expectedMigrationCount());
    assert.equal(applied.length, 9);

    const rows = await raw(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const tables = new Set(rows.map((row) => row.table_name));
    for (const name of [
      "marketplace_contacts",
      "buy_requests",
      "sell_submissions",
      "sell_submission_items",
      "email_verification_tokens",
      "marketplace_upload_sessions",
      "marketplace_pending_uploads",
      "marketplace_attachments",
      "marketplace_notes",
      "supplier_responses",
      "buyer_offers",
    ]) {
      assert.ok(tables.has(name), `migration did not create ${name}`);
    }

    // Price Check baseline tables survive alongside the marketplace package.
    for (const name of [
      "price_checks",
      "requesters",
      "attachments",
      "price_check_pending_uploads",
      "audit_events",
      "notification_outbox",
      "admin_users",
    ]) {
      assert.ok(tables.has(name), `baseline table ${name} is missing`);
    }
  });
});

test("representative buy, sell, supplier-response and buyer-offer rows persist", async () => {
  await withDatabase(async ({ db, schema, raw }) => {
    const { eq } = await import("drizzle-orm");

    const buyer = await insertContact(db, schema, { actsAsBuyer: true });
    const request = await insertBuyRequest(db, schema, buyer.id, {
      acceptableCondition: "ANY",
      urgency: "aog",
      deliveryCountry: "DE",
      fulfillmentPreference: "door_delivery",
    });

    const [storedRequest] = await db
      .select()
      .from(schema.buyRequests)
      .where(eq(schema.buyRequests.id, request.id));
    assert.match(storedRequest.publicReference, /^BR-[0-9A-HJKMNP-TV-Z]{10}$/);
    assert.equal(storedRequest.status, "pending_verification");
    assert.equal(storedRequest.verifiedAt, null);
    assert.equal(storedRequest.quantity, "2.000");

    // A registered supplier response carrying a private cost.
    const supplier = await insertContact(db, schema, {
      companyName: "Registered Supplier LLC",
      businessEmail: "ops@supplier.example",
      normalizedEmail: "ops@supplier.example",
      actsAsSeller: true,
    });
    const registeredResponse = {
      id: ulid("SR"),
      buyRequestId: request.id,
      supplierKind: "registered_contact",
      supplierContactId: supplier.id,
      supplierUnitCost: "1200.00",
      currencyCode: "USD",
      quoteOnRequest: false,
      receivedAt: SUBMITTED_AT,
    };
    await db.insert(schema.supplierResponses).values(registeredResponse);

    // Civilon's separate offer to the buyer, at its own resale price.
    const offer = {
      id: ulid("BO"),
      buyRequestId: request.id,
      selectedSupplierResponseId: registeredResponse.id,
      version: 1,
      civilonSaleUnitPrice: "1750.00",
      currencyCode: "USD",
      quantity: "2",
      deliveryOption: "door_delivery",
    };
    await db.insert(schema.buyerOffers).values(offer);

    const [storedOffer] = await db
      .select()
      .from(schema.buyerOffers)
      .where(eq(schema.buyerOffers.id, offer.id));
    assert.equal(storedOffer.civilonSaleUnitPrice, "1750.00");
    assert.equal(storedOffer.status, "draft");

    // Sell side persists independently of the buy side.
    const seller = await insertContact(db, schema, {
      businessEmail: "sales@seller.example",
      normalizedEmail: "sales@seller.example",
      actsAsSeller: true,
    });
    const submission = await insertSellSubmission(db, schema, seller.id);
    const [storedSubmission] = await db
      .select()
      .from(schema.sellSubmissions)
      .where(eq(schema.sellSubmissions.id, submission.id));
    assert.match(storedSubmission.publicReference, /^SS-[0-9A-HJKMNP-TV-Z]{10}$/);
    assert.equal(storedSubmission.status, "pending_verification");

    // Supplier cost is reachable only through supplier_responses: no column on
    // buyer_offers can carry it.
    const offerColumns = await raw(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'buyer_offers'`,
    );
    const names = offerColumns.map((row) => row.column_name);
    assert.ok(!names.some((name) => /cost/.test(name)));
    assert.deepEqual(
      names.filter((name) => /supplier/.test(name)),
      ["selected_supplier_response_id"],
    );
  });
});

test("optional seller price, quote-on-request and nonregistered suppliers are supported", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");

    const seller = await insertContact(db, schema, { actsAsSeller: true });

    // Price omitted entirely: quote-on-request is the normal path.
    const quoted = await insertSellSubmission(db, schema, seller.id);
    const [storedQuoted] = await db
      .select()
      .from(schema.sellSubmissions)
      .where(eq(schema.sellSubmissions.id, quoted.id));
    assert.equal(storedQuoted.askingUnitPrice, null);
    assert.equal(storedQuoted.currencyCode, null);
    assert.equal(storedQuoted.quoteOnRequest, true);
    assert.equal(storedQuoted.canShipToNewJersey, null);

    // Price supplied: allowed, but then quote-on-request must be false.
    const priced = await insertSellSubmission(db, schema, seller.id, {
      askingUnitPrice: "990.50",
      currencyCode: "USD",
      quoteOnRequest: false,
      canShipToNewJersey: true,
    });
    const [storedPriced] = await db
      .select()
      .from(schema.sellSubmissions)
      .where(eq(schema.sellSubmissions.id, priced.id));
    assert.equal(storedPriced.askingUnitPrice, "990.50");
    assert.equal(storedPriced.canShipToNewJersey, true);

    // A bulk inventory submission carries no single part, quantity or price.
    const bulk = await insertSellSubmission(db, schema, seller.id, {
      submissionKind: "bulk_inventory",
      originalPartNumber: null,
      normalizedPartNumber: null,
      description: "Mixed rotable inventory spreadsheet, 400 line items",
      estimatedLineItemCount: 400,
    });
    const [storedBulk] = await db
      .select()
      .from(schema.sellSubmissions)
      .where(eq(schema.sellSubmissions.id, bulk.id));
    assert.equal(storedBulk.originalPartNumber, null);
    assert.equal(storedBulk.estimatedLineItemCount, 400);

    // A nonregistered supplier is captured as a snapshot with no contact row.
    const buyer = await insertContact(db, schema, { actsAsBuyer: true });
    const request = await insertBuyRequest(db, schema, buyer.id);
    const nonregistered = {
      id: ulid("SR"),
      buyRequestId: request.id,
      supplierKind: "nonregistered_supplier",
      supplierNameSnapshot: "Unregistered Broker Co",
      supplierContactSnapshot: "broker@example.test",
      supplierCountry: "AE",
      receivedAt: SUBMITTED_AT,
    };
    await db.insert(schema.supplierResponses).values(nonregistered);
    const [storedResponse] = await db
      .select()
      .from(schema.supplierResponses)
      .where(eq(schema.supplierResponses.id, nonregistered.id));
    assert.equal(storedResponse.supplierContactId, null);
    assert.equal(storedResponse.supplierNameSnapshot, "Unregistered Broker Co");
    assert.equal(storedResponse.supplierUnitCost, null);
    assert.equal(storedResponse.quoteOnRequest, true);
    // Availability is never a Civilon confirmation.
    assert.equal(storedResponse.availabilityState, "subject_to_confirmation");
  });
});

test("invalid marketplace rows are rejected by database constraints", async () => {
  await withDatabase(async ({ db, schema }) => {
    const contact = await insertContact(db, schema);

    // Reference format.
    await rejects(
      () => insertBuyRequest(db, schema, contact.id, { publicReference: "PC-ABCDEFGHJK" }),
      "buy_requests_public_reference_chk",
    );
    await rejects(
      () => insertSellSubmission(db, schema, contact.id, { publicReference: "BR-ABCDEFGHJK" }),
      "sell_submissions_public_reference_chk",
    );

    // Part number OR description is required.
    await rejects(
      () =>
        insertBuyRequest(db, schema, contact.id, {
          originalPartNumber: null,
          normalizedPartNumber: null,
          description: "   ",
        }),
      "buy_requests_part_or_description_chk",
    );

    // Quantity must be positive.
    await rejects(
      () => insertBuyRequest(db, schema, contact.id, { quantity: "0" }),
      "buy_requests_quantity_positive_chk",
    );

    // Unknown contact reference.
    await rejects(
      () => insertBuyRequest(db, schema, ulid("MISSING"), {}),
      "buy_requests_contact_id",
    );

    // Idempotency uniqueness.
    const first = await insertBuyRequest(db, schema, contact.id);
    await rejects(
      () => insertBuyRequest(db, schema, contact.id, { idempotencyHash: first.idempotencyHash }),
      "buy_requests_idempotency_hash_uidx",
    );

    // Bulk mode may not carry a single part number.
    await rejects(
      () =>
        insertSellSubmission(db, schema, contact.id, {
          submissionKind: "bulk_inventory",
          originalPartNumber: "SHOULD-NOT-EXIST",
          normalizedPartNumber: "SHOULDNOTEXIST",
        }),
      "sell_submissions_mode_chk",
    );

    // Omitting a price while declaring it is not quote-on-request.
    await rejects(
      () =>
        insertSellSubmission(db, schema, contact.id, {
          quoteOnRequest: false,
          askingUnitPrice: null,
        }),
      "sell_submissions_quote_on_request_chk",
    );

    // Negative seller price.
    await rejects(
      () =>
        insertSellSubmission(db, schema, contact.id, {
          askingUnitPrice: "-1",
          currencyCode: "USD",
          quoteOnRequest: false,
        }),
      "sell_submissions_price_nonnegative_chk",
    );
  });
});

test("buyer offers stay structurally separated from supplier cost and identity", async () => {
  await withDatabase(async ({ db, schema, raw }) => {
    const buyer = await insertContact(db, schema, { actsAsBuyer: true });
    const request = await insertBuyRequest(db, schema, buyer.id);

    const baseOffer = {
      buyRequestId: request.id,
      civilonSaleUnitPrice: "500.00",
      currencyCode: "USD",
      quantity: "1",
    };

    await db.insert(schema.buyerOffers).values({ ...baseOffer, id: ulid("BO"), version: 1 });

    // One offer version per buy request.
    await rejects(
      () => db.insert(schema.buyerOffers).values({ ...baseOffer, id: ulid("BO"), version: 1 }),
      "buyer_offers_version_uidx",
    );

    // Negative Civilon sale price.
    await rejects(
      () =>
        db
          .insert(schema.buyerOffers)
          .values({ ...baseOffer, id: ulid("BO"), version: 2, civilonSaleUnitPrice: "-5" }),
      "buyer_offers_sale_price_nonnegative_chk",
    );

    // A non-draft offer must record when it was sent.
    await rejects(
      () =>
        db
          .insert(schema.buyerOffers)
          .values({ ...baseOffer, id: ulid("BO"), version: 3, status: "sent", sentAt: null }),
      "buyer_offers_sent_state_chk",
    );

    // The delivery option enum offers no supplier-direct label.
    const deliveryValues = await raw(
      `select enumlabel from pg_enum
         join pg_type on pg_type.oid = pg_enum.enumtypid
        where pg_type.typname = 'buyer_offer_delivery_option'
        order by enumsortorder`,
    );
    assert.deepEqual(
      deliveryValues.map((row) => row.enumlabel),
      ["door_delivery", "port_of_entry", "nj_pickup", "not_determined"],
    );
    await rejects(
      () =>
        raw(
          `insert into buyer_offers (id, buy_request_id, version, civilon_sale_unit_price,
             currency_code, quantity, delivery_option)
           values ('${ulid("BO")}', '${request.id}', 9, 100, 'USD', 1, 'supplier_direct')`,
        ),
      "supplier_direct",
    );

    // No foreign key path from buyer_offers to a contact (buyer or supplier).
    const fks = await raw(
      `select ccu.table_name as referenced
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
        where tc.table_name = 'buyer_offers' and tc.constraint_type = 'FOREIGN KEY'`,
    );
    const referenced = new Set(fks.map((row) => row.referenced));
    assert.ok(!referenced.has("marketplace_contacts"));
    assert.deepEqual(
      [...referenced].sort(),
      ["admin_users", "buy_requests", "supplier_responses"],
    );
  });
});

test("pending-verification records remain queryable and verification is a normal transition", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { and, eq } = await import("drizzle-orm");

    const contact = await insertContact(db, schema);
    const pending = await insertBuyRequest(db, schema, contact.id);
    const pendingSell = await insertSellSubmission(db, schema, contact.id);

    // Staff can list unverified work without any special visibility flag.
    const pendingRequests = await db
      .select()
      .from(schema.buyRequests)
      .where(eq(schema.buyRequests.status, "pending_verification"));
    assert.equal(pendingRequests.length, 1);
    assert.equal(pendingRequests[0].id, pending.id);

    const pendingSubmissions = await db
      .select()
      .from(schema.sellSubmissions)
      .where(eq(schema.sellSubmissions.status, "pending_verification"));
    assert.equal(pendingSubmissions.length, 1);
    assert.equal(pendingSubmissions[0].id, pendingSell.id);

    // Verifying flips both the timestamp and the status together.
    const verifiedAt = new Date("2026-08-17T13:00:00Z");
    await db
      .update(schema.buyRequests)
      .set({ status: "verified", verifiedAt })
      .where(eq(schema.buyRequests.id, pending.id));

    const [verified] = await db
      .select()
      .from(schema.buyRequests)
      .where(eq(schema.buyRequests.id, pending.id));
    assert.equal(verified.status, "verified");
    assert.deepEqual(verified.verifiedAt, verifiedAt);

    // A verified row may not claim to still be pending.
    await rejects(
      () =>
        db
          .update(schema.buyRequests)
          .set({ status: "pending_verification" })
          .where(eq(schema.buyRequests.id, pending.id)),
      "buy_requests_verified_status_chk",
    );

    // One live verification token per aggregate, keyed by type AND id.
    const tokenBase = {
      contactId: contact.id,
      tokenDerivationNonce: "nonce",
      issuedAt: SUBMITTED_AT,
      expiresAt: new Date("2027-08-18T12:00:00Z"),
    };
    await db.insert(schema.emailVerificationTokens).values({
      ...tokenBase,
      id: ulid("TK"),
      aggregateType: "buy_request",
      aggregateId: pendingSell.id === pending.id ? pending.id : pending.id,
      buyRequestId: pending.id,
      purpose: "BUY_REQUEST_CONTACT",
      keyedTokenHash: "hash-a",
    });
    await rejects(
      () =>
        db.insert(schema.emailVerificationTokens).values({
          ...tokenBase,
          id: ulid("TK"),
          aggregateType: "buy_request",
          aggregateId: pending.id,
          buyRequestId: pending.id,
          purpose: "BUY_REQUEST_CONTACT",
          keyedTokenHash: "hash-b",
        }),
      "email_verification_tokens_active_uidx",
    );

    // A Sell Submission token coexists: the index is keyed on the type too.
    await db.insert(schema.emailVerificationTokens).values({
      ...tokenBase,
      id: ulid("TK"),
      aggregateType: "sell_submission",
      aggregateId: pendingSell.id,
      sellSubmissionId: pendingSell.id,
      purpose: "SELL_SUBMISSION_CONTACT",
      keyedTokenHash: "hash-c",
    });
    const live = await db
      .select()
      .from(schema.emailVerificationTokens)
      .where(
        and(
          eq(schema.emailVerificationTokens.aggregateType, "sell_submission"),
          eq(schema.emailVerificationTokens.aggregateId, pendingSell.id),
        ),
      );
    assert.equal(live.length, 1);

    // A token may not claim a mismatched aggregate type.
    await rejects(
      () =>
        db.insert(schema.emailVerificationTokens).values({
          ...tokenBase,
          id: ulid("TK"),
          aggregateType: "buy_request",
          aggregateId: pendingSell.id,
          sellSubmissionId: pendingSell.id,
          purpose: "BUY_REQUEST_CONTACT",
          keyedTokenHash: "hash-d",
        }),
      "email_verification_tokens_aggregate_chk",
    );
  });
});

test("marketplace upload tables expose no cross-workflow claim path", async () => {
  await withDatabase(async ({ db, schema, raw }) => {
    // No marketplace upload table has a foreign key into a Price Check table.
    const fks = await raw(
      `select tc.table_name as child, ccu.table_name as parent
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_name in ('marketplace_upload_sessions','marketplace_pending_uploads','marketplace_attachments')`,
    );
    const priceCheckTables = new Set([
      "price_checks",
      "price_check_results",
      "price_check_upload_sessions",
      "price_check_pending_uploads",
      "attachments",
    ]);
    for (const row of fks) {
      assert.ok(
        !priceCheckTables.has(row.parent),
        `${row.child} must not reference ${row.parent}`,
      );
    }

    // ...and no Price Check upload table gained a marketplace claim column.
    const columns = await raw(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('price_check_pending_uploads','attachments','marketplace_pending_uploads','marketplace_attachments')`,
    );
    for (const row of columns) {
      if (row.table_name.startsWith("marketplace_")) {
        assert.ok(
          !/price_check/.test(row.column_name),
          `${row.table_name}.${row.column_name} couples to Price Check`,
        );
      } else {
        assert.ok(
          !/(marketplace|buy_request|sell_submission)/.test(row.column_name),
          `${row.table_name}.${row.column_name} couples to the marketplace`,
        );
      }
    }

    // A marketplace pending upload cannot name a Price Check id as its claim.
    const session = {
      id: ulid("US"),
      tokenHash: "session-hash",
      intendedAggregateType: "sell_submission",
      expiresAt: new Date("2027-08-18T12:00:00Z"),
    };
    await db.insert(schema.marketplaceUploadSessions).values(session);

    const pendingUpload = {
      id: ulid("PU"),
      uploadSessionId: session.id,
      objectKey: "marketplace/quarantine/inventory.xlsx",
      displayFilename: "inventory.xlsx",
      declaredMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      expectedByteSize: "2048",
      purpose: "INVENTORY_SPREADSHEET",
      expiresAt: new Date("2026-08-18T12:00:00Z"),
    };
    await db.insert(schema.marketplacePendingUploads).values(pendingUpload);

    // Claiming a nonexistent sell submission is refused by the foreign key.
    await rejects(
      () =>
        db.insert(schema.marketplacePendingUploads).values({
          ...pendingUpload,
          id: ulid("PU"),
          objectKey: "marketplace/quarantine/other.xlsx",
          claimedSellSubmissionId: ulid("NOPE"),
        }),
      "claimed_sell_submission_id",
    );

    // A marketplace object key may not escape the marketplace namespace.
    await rejects(
      () =>
        db.insert(schema.marketplacePendingUploads).values({
          ...pendingUpload,
          id: ulid("PU"),
          objectKey: "price-check/quarantine/steal.pdf",
        }),
      "marketplace_pending_uploads_object_key_chk",
    );

    // A single pending upload cannot be claimed by both workflows at once.
    const contact = await insertContact(db, schema);
    const request = await insertBuyRequest(db, schema, contact.id);
    const submission = await insertSellSubmission(db, schema, contact.id);
    await rejects(
      () =>
        db.insert(schema.marketplacePendingUploads).values({
          ...pendingUpload,
          id: ulid("PU"),
          objectKey: "marketplace/quarantine/both.xlsx",
          claimedBuyRequestId: request.id,
          claimedSellSubmissionId: submission.id,
        }),
      "marketplace_pending_uploads_single_claim_chk",
    );

    // An attachment must agree with its own aggregate type.
    await rejects(
      () =>
        db.insert(schema.marketplaceAttachments).values({
          id: ulid("AT"),
          aggregateType: "buy_request",
          aggregateId: submission.id,
          sellSubmissionId: submission.id,
          purpose: "INVENTORY_SPREADSHEET",
          uploadedByType: "CONTACT",
          displayFilename: "inventory.xlsx",
          objectKey: "marketplace/bound/inventory.xlsx",
          storageProvider: "s3",
          byteSize: "2048",
          retentionClass: "MARKETPLACE_INTAKE_EVIDENCE",
        }),
      "marketplace_attachments_aggregate_chk",
    );
  });
});

test("Price Check baseline data remains usable after the marketplace migration", async () => {
  await withDatabase(async ({ db, schema, raw }) => {
    const { eq } = await import("drizzle-orm");
    const { validatePriceCheckSubmission } = await import("../lib/price-check/validation.ts");
    const { submitPriceCheck } = await import("../lib/price-check/submission-service.ts");

    const validation = validatePriceCheckSubmission({
      idempotencyKey: "6f1a2c33-9d41-4a0e-9d55-6f0a1b2c3d4e",
      partNumber: "TEST-MARKETPLACE-COEXIST-001",
      quantity: "1",
      quoteOrPurchased: "quote",
      transactionType: "outright",
      conditionCode: "OH",
      unitPrice: "3100",
      currencyCode: "USD",
      aog: false,
      documentationCodes: ["FAA_8130_3"],
      documentationOther: "",
      firstName: "Baseline",
      lastName: "Buyer",
      companyName: "Example Aviation Test",
      businessEmail: "baseline@example.com",
      role: "Buyer",
      country: "US",
      serviceAcknowledged: true,
      legalAcknowledged: true,
      sourcePage: "/price-check",
      website: "",
    });
    assert.equal(validation.success, true);

    const submitted = await submitPriceCheck(db, validation.data);
    assert.equal(submitted.created, true);
    assert.match(submitted.reference, /^PC-[0-9A-HJKMNP-TV-Z]{10}$/);

    const [stored] = await db
      .select()
      .from(schema.priceChecks)
      .where(eq(schema.priceChecks.publicReference, submitted.reference));
    assert.equal(stored.originalPartNumber, "TEST-MARKETPLACE-COEXIST-001");
    assert.equal(stored.status, "submitted");

    // The generic audit log still accepts Price Check rows, and now also
    // accepts marketplace rows with no schema change.
    const contact = await insertContact(db, schema);
    const request = await insertBuyRequest(db, schema, contact.id);
    const { appendAuditEvent } = await import(
      "../db/price-check/repositories/audit-repository.ts"
    );
    await appendAuditEvent(db, {
      aggregateType: "buy_request",
      aggregateId: request.id,
      actorType: "SYSTEM",
      action: "buy_request.submitted",
      correlationId: "correlation-marketplace-1",
      sanitizedMetadata: { reference: request.publicReference },
    });

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, request.id));
    assert.equal(events.length, 1);
    assert.equal(events[0].aggregateType, "buy_request");

    // Price Check provenance links are RESTRICT, not SET NULL: the citation
    // cannot be silently blanked, and the cited Price Check cannot be removed.
    const linked = await insertBuyRequest(db, schema, contact.id, {
      sourcePriceCheckId: stored.id,
      sourceResultId: null,
    });
    const [storedLink] = await db
      .select()
      .from(schema.buyRequests)
      .where(eq(schema.buyRequests.id, linked.id));
    assert.equal(storedLink.sourcePriceCheckId, stored.id);

    const rules = await raw(
      `select tc.constraint_name, rc.delete_rule
         from information_schema.table_constraints tc
         join information_schema.referential_constraints rc
           on rc.constraint_name = tc.constraint_name
        where tc.table_name = 'buy_requests' and tc.constraint_type = 'FOREIGN KEY'
          and tc.constraint_name like '%source%'`,
    );
    assert.equal(rules.length, 2);
    for (const rule of rules) {
      assert.equal(
        rule.delete_rule,
        "RESTRICT",
        `${rule.constraint_name} must be RESTRICT, found ${rule.delete_rule}`,
      );
    }

    // Deleting the cited Price Check is refused. Note the Price Check aggregate
    // already restricts its own children (price_check_revisions fires first),
    // so this asserts the delete is blocked, not which constraint blocks it.
    await rejects(
      () => db.delete(schema.priceChecks).where(eq(schema.priceChecks.id, stored.id)),
      "violates foreign key constraint",
    );

    // The Buy Request, and its citation, are untouched by the refused delete.
    const [afterAttempt] = await db
      .select()
      .from(schema.buyRequests)
      .where(eq(schema.buyRequests.id, linked.id));
    assert.equal(afterAttempt.sourcePriceCheckId, stored.id);
  });
});
