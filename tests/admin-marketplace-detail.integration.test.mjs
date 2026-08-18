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
    const repository = await import("../db/price-check/repositories/marketplace-admin-repository.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, repository });
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

const AT = (iso) => new Date(iso);
const SUBMITTED_AT = AT("2026-08-17T12:00:00Z");

async function insertAdmin(db, schema, overrides = {}) {
  const row = {
    id: ulid("AD"),
    identityProviderIssuer: "https://accounts.google.com",
    identityProviderSubject: ulid("SB"),
    displayEmail: `staff-${ulid("E")}@cvlon.com`,
    role: "ANALYST",
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
    phone: "+1 555 0100",
    country: "US",
    actsAsBuyer: true,
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
    urgency: "aog",
    aircraftModel: "A320",
    deliveryCountry: "US",
    deliveryCity: "Newark",
    fulfillmentPreference: "nj_pickup",
    notes: "Customer supplied note",
    sourcePage: "/buy-sell-aircraft-parts/buy",
    landingPage: "https://cvlon.com/buy-sell-aircraft-parts",
    utmSource: "newsletter",
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
    submissionKind: "bulk_inventory",
    description: "Surplus avionics stock",
    estimatedLineItemCount: 2,
    locationCountry: "US",
    locationCity: "Miami",
    canShipToNewJersey: true,
    documentsSummary: "Trace paperwork available on request",
    notes: "Seller supplied note",
    sourcePage: "/buy-sell-aircraft-parts/sell",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: SUBMITTED_AT,
    ...overrides,
  };
  await db.insert(schema.sellSubmissions).values(row);
  return row;
}

async function insertSellItem(db, schema, sellSubmissionId, lineNumber, overrides = {}) {
  const row = {
    id: ulid("SI"),
    sellSubmissionId,
    lineNumber,
    originalPartNumber: `SS-ITEM-${lineNumber}`,
    normalizedPartNumber: `SSITEM${lineNumber}`,
    quantity: "3",
    conditionCode: "SV",
    quoteOnRequest: true,
    locationText: "Miami warehouse",
    sourceRowReference: `row-${lineNumber}`,
    ...overrides,
  };
  await db.insert(schema.sellSubmissionItems).values(row);
  return row;
}

async function insertAttachment(db, schema, sellSubmissionId, overrides = {}) {
  const row = {
    id: ulid("AT"),
    aggregateType: "sell_submission",
    aggregateId: sellSubmissionId,
    sellSubmissionId,
    purpose: "WAREHOUSE_BUSINESS_EVIDENCE",
    uploadedByType: "CONTACT",
    displayFilename: "warehouse.pdf",
    objectKey: `marketplace/quarantine/sell_submission/${ulid("K")}`,
    storageProvider: "AWS_S3",
    declaredMime: "application/pdf",
    detectedMime: "application/pdf",
    byteSize: "20480",
    contentDigest: "a".repeat(64),
    scanState: "CLEAN",
    retentionClass: "MARKETPLACE_INTAKE_EVIDENCE",
    ...overrides,
  };
  await db.insert(schema.marketplaceAttachments).values(row);
  return row;
}

async function insertNote(db, schema, aggregateType, aggregateId, adminUserId, body, overrides = {}) {
  const row = {
    id: ulid("NT"),
    aggregateType,
    aggregateId,
    buyRequestId: aggregateType === "buy_request" ? aggregateId : null,
    sellSubmissionId: aggregateType === "sell_submission" ? aggregateId : null,
    adminUserId,
    body,
    ...overrides,
  };
  await db.insert(schema.marketplaceNotes).values(row);
  return row;
}

async function insertAudit(db, schema, aggregateType, aggregateId, action) {
  const row = {
    id: ulid("AU"),
    aggregateType,
    aggregateId,
    actorType: "REQUESTER",
    actorId: null,
    action,
    correlationId: `${action}:${ulid("C")}`,
    sanitizedMetadata: { secretDoNotLeak: "must-not-surface" },
  };
  await db.insert(schema.auditEvents).values(row);
  return row;
}

async function insertSupplierResponse(db, schema, buyRequestId, adminUserId, overrides = {}) {
  const row = {
    id: ulid("SR"),
    buyRequestId,
    supplierKind: "nonregistered_supplier",
    supplierNameSnapshot: "Acme Rotables Ltd",
    supplierContactSnapshot: "sourcing@acme-rotables.example",
    supplierCountry: "GB",
    offeredPartNumber: "BR-PART-4100",
    quantityAvailable: "2",
    supplierUnitCost: "1800.00",
    currencyCode: "USD",
    quoteOnRequest: false,
    locationText: "London hub",
    documentsSummary: "Supplier holds an internal trace file",
    shippingNotes: "Supplier can ship direct",
    recordedByAdminUserId: adminUserId,
    receivedAt: AT("2026-08-17T13:00:00Z"),
    ...overrides,
  };
  await db.insert(schema.supplierResponses).values(row);
  return row;
}

async function insertBuyerOffer(db, schema, buyRequestId, selectedSupplierResponseId, adminUserId, overrides = {}) {
  const row = {
    id: ulid("BO"),
    buyRequestId,
    selectedSupplierResponseId,
    version: 1,
    civilonSaleUnitPrice: "2400.00",
    currencyCode: "USD",
    quantity: "2",
    deliveryOption: "nj_pickup",
    createdByAdminUserId: adminUserId,
    ...overrides,
  };
  await db.insert(schema.buyerOffers).values(row);
  return row;
}

/** Every string reachable in a returned object graph, for leak assertions. */
function flattenStrings(input, out = []) {
  if (input === null || input === undefined) return out;
  if (typeof input === "string") { out.push(input); return out; }
  if (input instanceof Date) return out;
  if (Array.isArray(input)) { for (const item of input) flattenStrings(item, out); return out; }
  if (typeof input === "object") { for (const value of Object.values(input)) flattenStrings(value, out); return out; }
  return out;
}

function allKeys(input, out = new Set()) {
  if (!input || typeof input !== "object" || input instanceof Date) return out;
  if (Array.isArray(input)) { for (const item of input) allKeys(item, out); return out; }
  for (const [key, value] of Object.entries(input)) { out.add(key); allKeys(value, out); }
  return out;
}

const FORBIDDEN_KEYS = [
  "objectKey", "storageProvider", "contentDigest", "sourcePendingUploadId",
  "idempotencyHash", "tokenHash", "keyedTokenHash", "tokenDerivationNonce",
  "sanitizedMetadata", "correlationId", "selectedSupplierResponseId",
];

/* ------------------------------------------------------------------------ */

test("a pending-verification Buy Request detail loads with every related section", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const admin = await insertAdmin(db, schema, { displayEmail: "david@cvlon.com" });
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id, { assignedAdminUserId: admin.id });
    const supplier = await insertSupplierResponse(db, schema, buyRequest.id, admin.id);
    await insertBuyerOffer(db, schema, buyRequest.id, supplier.id, admin.id);
    await insertNote(db, schema, "buy_request", buyRequest.id, admin.id, "Sourcing started");
    await insertAudit(db, schema, "buy_request", buyRequest.id, "BUY_REQUEST_SUBMITTED");

    const detail = await repository.getBuyRequestAdminDetail(db, buyRequest.id);
    assert.ok(detail, "a pending-verification Buy Request must load");

    // Still at its intake default, and loaded anyway.
    assert.equal(detail.buyRequest.status, "pending_verification");
    assert.equal(detail.buyRequest.verifiedAt, null);
    assert.equal(detail.buyRequest.verificationState, "pending");

    assert.equal(detail.buyRequest.publicReference, buyRequest.publicReference);
    assert.equal(detail.buyRequest.customerNotes, "Customer supplied note");
    assert.equal(detail.buyRequest.aircraftModel, "A320");
    assert.equal(detail.buyRequest.fulfillmentPreference, "nj_pickup");
    assert.equal(detail.buyRequest.utmSource, "newsletter");
    assert.equal(detail.contact.companyName, "Example Aviation Group");
    assert.equal(detail.contact.businessEmail, "Dana.Ruiz@example.com");
    assert.equal(detail.assignee.email, "david@cvlon.com");
    assert.equal(detail.notes.length, 1);
    assert.equal(detail.notes[0].body, "Sourcing started");
    assert.equal(detail.notes[0].authorEmail, "david@cvlon.com");
    assert.equal(detail.audit.length, 1);
    assert.equal(detail.audit[0].action, "BUY_REQUEST_SUBMITTED");
    assert.equal(detail.supplierResponses.length, 1);
    assert.equal(detail.buyerOffers.length, 1);
  });
});

test("supplier responses and buyer offers stay separate structures", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const supplier = await insertSupplierResponse(db, schema, buyRequest.id, admin.id);
    await insertBuyerOffer(db, schema, buyRequest.id, supplier.id, admin.id);

    const detail = await repository.getBuyRequestAdminDetail(db, buyRequest.id);

    // The internal side carries the supplier's identity and cost.
    const response = detail.supplierResponses[0];
    assert.equal(response.supplierNameSnapshot, "Acme Rotables Ltd");
    assert.equal(response.supplierContactSnapshot, "sourcing@acme-rotables.example");
    assert.equal(response.supplierUnitCost, "1800.00");
    assert.equal(response.documentsSummary, "Supplier holds an internal trace file");
    assert.equal(response.availabilityState, "subject_to_confirmation");

    // The buyer side carries Civilon's own price and nothing that reaches back.
    const offer = detail.buyerOffers[0];
    assert.deepEqual(Object.keys(offer).sort(), [
      "civilonSaleUnitPrice", "createdAt", "createdByEmail", "currencyCode",
      "deliveryOption", "documentsSummary", "expiresAt", "id", "leadTimeDays",
      "quantity", "respondedAt", "sentAt", "shippingAndExportScope", "statedCondition",
      "status", "supersededAt", "version",
    ]);
    assert.equal(offer.civilonSaleUnitPrice, "2400.00");
    assert.equal(offer.deliveryOption, "nj_pickup");

    // Even though the row IS linked in the database, the pointer never leaves
    // the repository, so a buyer-facing renderer has no route to the supplier.
    const [stored] = await db.select().from(schema.buyerOffers);
    assert.equal(stored.selectedSupplierResponseId, supplier.id);
    assert.equal("selectedSupplierResponseId" in offer, false);

    const offerStrings = flattenStrings(offer);
    for (const secret of ["Acme Rotables Ltd", "sourcing@acme-rotables.example", "1800.00", "GB", "London hub", "Supplier can ship direct", supplier.id]) {
      assert.equal(offerStrings.includes(secret), false, `buyer offer leaked ${secret}`);
    }

    // The two sides are separate arrays; there is no combined object.
    assert.ok(Array.isArray(detail.supplierResponses));
    assert.ok(Array.isArray(detail.buyerOffers));
    assert.equal(detail.economics, undefined);
    assert.equal(detail.margin, undefined);
  });
});

test("a pending-verification Sell Submission detail loads with items, evidence, notes and audit", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const admin = await insertAdmin(db, schema, { displayEmail: "david@cvlon.com" });
    const contact = await insertContact(db, schema, { actsAsSeller: true });
    const submission = await insertSellSubmission(db, schema, contact.id, { assignedAdminUserId: admin.id });
    await insertSellItem(db, schema, submission.id, 2);
    await insertSellItem(db, schema, submission.id, 1);
    await insertAttachment(db, schema, submission.id);
    await insertAttachment(db, schema, submission.id, {
      displayFilename: "inventory.csv",
      purpose: "INVENTORY_SPREADSHEET",
      declaredMime: "text/csv",
      detectedMime: "text/csv",
      scanState: "PENDING",
    });
    await insertNote(db, schema, "sell_submission", submission.id, admin.id, "Awaiting evidence review");
    await insertAudit(db, schema, "sell_submission", submission.id, "SELL_SUBMISSION_SUBMITTED");

    const detail = await repository.getSellSubmissionAdminDetail(db, submission.id);
    assert.ok(detail, "a pending-verification Sell Submission must load");
    assert.equal(detail.sellSubmission.status, "pending_verification");
    assert.equal(detail.sellSubmission.verificationState, "pending");
    assert.equal(detail.sellSubmission.submissionKind, "bulk_inventory");
    assert.equal(detail.sellSubmission.canShipToNewJersey, true);
    assert.equal(detail.sellSubmission.locationCity, "Miami");
    assert.equal(detail.sellSubmission.documentsSummary, "Trace paperwork available on request");
    assert.equal(detail.sellSubmission.customerNotes, "Seller supplied note");

    // Items come back in line order regardless of insertion order.
    assert.deepEqual(detail.items.map(item => item.lineNumber), [1, 2]);
    assert.equal(detail.items[0].locationText, "Miami warehouse");

    // Evidence is metadata, with its scan state reported honestly.
    assert.equal(detail.attachments.length, 2);
    assert.deepEqual(detail.attachments.map(a => a.scanState).sort(), ["CLEAN", "PENDING"]);
    assert.deepEqual(Object.keys(detail.attachments[0]).sort(), [
      "byteSize", "createdAt", "declaredMime", "deletedAt", "deletionDueAt",
      "detectedMime", "displayFilename", "id", "purpose", "quarantineReleasedAt",
      "retentionClass", "reviewState", "reviewedAt", "reviewedByEmail",
      "scanState", "uploadedByType",
    ]);
    assert.ok(detail.attachments.every(attachment => attachment.reviewState === "not_reviewed"));
    assert.ok(detail.attachments.every(attachment => attachment.reviewedAt === null));
    assert.ok(detail.attachments.every(attachment => attachment.reviewedByEmail === null));

    assert.equal(detail.notes.length, 1);
    assert.equal(detail.audit.length, 1);
    assert.equal(detail.assignee.email, "david@cvlon.com");
  });
});

test("a wrong or unknown id returns null and never another record", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const submission = await insertSellSubmission(db, schema, contact.id);
    await insertSupplierResponse(db, schema, buyRequest.id, admin.id);
    await insertSellItem(db, schema, submission.id, 1);

    // An id from the other aggregate must not resolve.
    assert.equal(await repository.getBuyRequestAdminDetail(db, submission.id), null);
    assert.equal(await repository.getSellSubmissionAdminDetail(db, buyRequest.id), null);

    // Unknown, empty and malformed ids all return null rather than a record.
    for (const id of ["", " ", "BR00000000000000000000ZZZZ", "0123456789ABCDEFGHJKMNP0TV", "'; select 1; --"]) {
      assert.equal(await repository.getBuyRequestAdminDetail(db, id), null, `buy detail must not resolve ${JSON.stringify(id)}`);
      assert.equal(await repository.getSellSubmissionAdminDetail(db, id), null, `sell detail must not resolve ${JSON.stringify(id)}`);
    }

    // The real records still load, so nothing above corrupted the tables.
    assert.ok(await repository.getBuyRequestAdminDetail(db, buyRequest.id));
    assert.ok(await repository.getSellSubmissionAdminDetail(db, submission.id));
  });
});

test("child rows are bound to their own parent and never bleed across records", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);

    const firstBuy = await insertBuyRequest(db, schema, contact.id);
    const secondBuy = await insertBuyRequest(db, schema, contact.id);
    await insertSupplierResponse(db, schema, firstBuy.id, admin.id, { supplierNameSnapshot: "First supplier" });
    await insertSupplierResponse(db, schema, secondBuy.id, admin.id, { supplierNameSnapshot: "Second supplier" });
    await insertBuyerOffer(db, schema, firstBuy.id, null, admin.id, { supplierKind: undefined });
    await insertNote(db, schema, "buy_request", firstBuy.id, admin.id, "First note");
    await insertNote(db, schema, "buy_request", secondBuy.id, admin.id, "Second note");
    await insertAudit(db, schema, "buy_request", firstBuy.id, "FIRST_ACTION");
    await insertAudit(db, schema, "buy_request", secondBuy.id, "SECOND_ACTION");

    const firstSell = await insertSellSubmission(db, schema, contact.id);
    const secondSell = await insertSellSubmission(db, schema, contact.id);
    await insertSellItem(db, schema, firstSell.id, 1, { originalPartNumber: "FIRST-ITEM" });
    await insertSellItem(db, schema, secondSell.id, 1, { originalPartNumber: "SECOND-ITEM" });
    await insertAttachment(db, schema, firstSell.id, { displayFilename: "first.pdf" });
    await insertAttachment(db, schema, secondSell.id, { displayFilename: "second.pdf" });
    await insertNote(db, schema, "sell_submission", firstSell.id, admin.id, "First sell note");
    await insertNote(db, schema, "sell_submission", secondSell.id, admin.id, "Second sell note");
    await insertAudit(db, schema, "sell_submission", firstSell.id, "FIRST_SELL_ACTION");
    await insertAudit(db, schema, "sell_submission", secondSell.id, "SECOND_SELL_ACTION");

    const buy = await repository.getBuyRequestAdminDetail(db, firstBuy.id);
    assert.deepEqual(buy.supplierResponses.map(r => r.supplierNameSnapshot), ["First supplier"]);
    assert.deepEqual(buy.notes.map(n => n.body), ["First note"]);
    assert.deepEqual(buy.audit.map(a => a.action), ["FIRST_ACTION"]);
    assert.equal(buy.buyerOffers.length, 1);

    const secondBuyDetail = await repository.getBuyRequestAdminDetail(db, secondBuy.id);
    assert.equal(secondBuyDetail.buyerOffers.length, 0);
    assert.deepEqual(secondBuyDetail.supplierResponses.map(r => r.supplierNameSnapshot), ["Second supplier"]);

    const sell = await repository.getSellSubmissionAdminDetail(db, firstSell.id);
    assert.deepEqual(sell.items.map(i => i.originalPartNumber), ["FIRST-ITEM"]);
    assert.deepEqual(sell.attachments.map(a => a.displayFilename), ["first.pdf"]);
    assert.deepEqual(sell.notes.map(n => n.body), ["First sell note"]);
    assert.deepEqual(sell.audit.map(a => a.action), ["FIRST_SELL_ACTION"]);

    // A Buy Request's notes and audit never surface on a Sell Submission.
    const sellStrings = flattenStrings(sell);
    for (const foreign of ["First note", "FIRST_ACTION", "First supplier", "SECOND-ITEM", "second.pdf"]) {
      assert.equal(sellStrings.includes(foreign), false, `sell detail leaked ${foreign}`);
    }
  });
});

test("no returned detail object contains a storage key, a hash, a token or audit metadata", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const supplier = await insertSupplierResponse(db, schema, buyRequest.id, admin.id);
    await insertBuyerOffer(db, schema, buyRequest.id, supplier.id, admin.id);
    await insertAudit(db, schema, "buy_request", buyRequest.id, "BUY_REQUEST_SUBMITTED");
    const submission = await insertSellSubmission(db, schema, contact.id);
    const attachment = await insertAttachment(db, schema, submission.id);
    await insertAudit(db, schema, "sell_submission", submission.id, "SELL_SUBMISSION_SUBMITTED");

    const details = [
      await repository.getBuyRequestAdminDetail(db, buyRequest.id),
      await repository.getSellSubmissionAdminDetail(db, submission.id),
    ];

    for (const detail of details) {
      const keys = allKeys(detail);
      for (const forbidden of FORBIDDEN_KEYS) {
        assert.equal(keys.has(forbidden), false, `detail exposed the ${forbidden} key`);
      }
      const strings = flattenStrings(detail);
      for (const secret of [
        attachment.objectKey,
        "marketplace/quarantine",
        "AWS_S3",
        buyRequest.idempotencyHash,
        submission.idempotencyHash,
        "a".repeat(64),
        "must-not-surface",
      ]) {
        assert.equal(strings.some(value => value.includes(secret)), false, `detail leaked ${secret}`);
      }
    }
  });
});

test("evidence scan state is reported as stored, including a non-clean file", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const contact = await insertContact(db, schema);
    const submission = await insertSellSubmission(db, schema, contact.id);
    await insertAttachment(db, schema, submission.id, { displayFilename: "clean.pdf", scanState: "CLEAN", createdAt: AT("2026-08-17T12:00:00Z") });
    await insertAttachment(db, schema, submission.id, { displayFilename: "held.pdf", scanState: "QUARANTINED", createdAt: AT("2026-08-17T12:01:00Z") });
    await insertAttachment(db, schema, submission.id, { displayFilename: "gone.pdf", scanState: "CLEAN", deletedAt: AT("2026-08-17T13:00:00Z"), createdAt: AT("2026-08-17T12:02:00Z") });

    const detail = await repository.getSellSubmissionAdminDetail(db, submission.id);
    assert.deepEqual(detail.attachments.map(a => [a.displayFilename, a.scanState]), [
      ["clean.pdf", "CLEAN"],
      ["held.pdf", "QUARANTINED"],
      ["gone.pdf", "CLEAN"],
    ]);
    // A deleted row is still listed, with its deletion visible rather than hidden.
    assert.notEqual(detail.attachments[2].deletedAt, null);
    assert.equal(detail.attachments[0].deletedAt, null);
    // Nothing was silently filtered out of the staff view.
    assert.equal(detail.attachments.length, 3);
  });
});
