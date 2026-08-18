import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

import { migrationsDirectory } from "./helpers/migration-archive.mjs";

/**
 * Mirrors the `withDatabase` shape used by the other integration suites: a real
 * disposable Postgres from `@netlify/database-dev`, migrated from empty.
 * Nothing here touches a preview or production database.
 */
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

/** Monotonic Crockford-base32 ids, so lexical order equals insertion order. */
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
const PRICE_CHECK_AT = AT("2026-08-17T10:00:00Z");
const BUY_AT = AT("2026-08-17T11:00:00Z");
const SELL_AT = AT("2026-08-17T12:00:00Z");

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

async function insertRequester(db, schema, overrides = {}) {
  const row = {
    id: ulid("RQ"),
    firstName: "Priya",
    lastName: "Nandan",
    companyName: "Northline MRO",
    businessEmail: "Priya.Nandan@example.com",
    normalizedEmail: "priya.nandan@example.com",
    serviceProcessingAcknowledgedAt: PRICE_CHECK_AT,
    ...overrides,
  };
  await db.insert(schema.requesters).values(row);
  return row;
}

async function insertPriceCheck(db, schema, requesterId, overrides = {}) {
  const row = {
    id: ulid("PC"),
    publicReference: reference("PC"),
    requesterId,
    originalPartNumber: "PC-PART-9000",
    normalizedPartNumber: "PCPART9000",
    quantity: "1",
    quoteOrPurchased: "purchased",
    transactionType: "outright",
    conditionCode: "NE",
    unitPrice: "1250.00",
    currencyCode: "USD",
    sourcePage: "/price-check",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: PRICE_CHECK_AT,
    ...overrides,
  };
  await db.insert(schema.priceChecks).values(row);
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

/**
 * `*_pending_verification_chk` requires `verified_at` for any status past
 * `pending_verification` other than the terminal ones, and `*_verified_order_chk`
 * requires it to be at or after `submitted_at`. Seeds honour that rather than
 * working around it, so the fixtures stay reachable through the real intake path.
 */
const VERIFICATION_EXEMPT_STATUSES = new Set(["pending_verification", "spam", "withdrawn", "closed"]);

function verificationColumns(overrides, submittedAt) {
  const status = overrides.status;
  if (!status || VERIFICATION_EXEMPT_STATUSES.has(status)) return {};
  if (overrides.verifiedAt) return {};
  return {
    verificationRequestedAt: submittedAt,
    verifiedAt: new Date(submittedAt.valueOf() + 60_000),
  };
}

async function insertBuyRequest(db, schema, contactId, overrides = {}) {
  const submittedAt = overrides.submittedAt ?? BUY_AT;
  const row = {
    id: ulid("BR"),
    publicReference: reference("BR"),
    contactId,
    originalPartNumber: "BR-PART-4100",
    normalizedPartNumber: "BRPART4100",
    description: "Hydraulic actuator for a regional fleet",
    quantity: "2",
    sourcePage: "/buy-sell-aircraft-parts/buy",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt,
    ...verificationColumns(overrides, submittedAt),
    ...overrides,
  };
  await db.insert(schema.buyRequests).values(row);
  return row;
}

async function insertSellSubmission(db, schema, contactId, overrides = {}) {
  const submittedAt = overrides.submittedAt ?? SELL_AT;
  const row = {
    id: ulid("SS"),
    publicReference: reference("SS"),
    contactId,
    submissionKind: "single_part",
    originalPartNumber: "SS-PART-7700",
    normalizedPartNumber: "SSPART7700",
    description: "Surplus avionics tray, warehouse held",
    sourcePage: "/buy-sell-aircraft-parts/sell",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt,
    ...verificationColumns(overrides, submittedAt),
    ...overrides,
  };
  await db.insert(schema.sellSubmissions).values(row);
  return row;
}

/** One Price Check, one pending Buy Request, one pending Sell Submission. */
async function seedBaseline(db, schema) {
  const requester = await insertRequester(db, schema);
  const priceCheck = await insertPriceCheck(db, schema, requester.id);
  const contact = await insertContact(db, schema);
  const buyRequest = await insertBuyRequest(db, schema, contact.id);
  const sellSubmission = await insertSellSubmission(db, schema, contact.id);
  return { requester, priceCheck, contact, buyRequest, sellSubmission };
}

const keyOf = (record) => `${record.type}:${record.publicReference}`;

/* ------------------------------------------------------------------------ */

test("all three workflows appear unfiltered, including unverified marketplace records", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const seed = await seedBaseline(db, schema);

    const records = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true });
    assert.equal(records.length, 3);

    const byType = Object.fromEntries(records.map((record) => [record.type, record]));
    assert.equal(byType.price_check.publicReference, seed.priceCheck.publicReference);
    assert.equal(byType.buy_request.publicReference, seed.buyRequest.publicReference);
    assert.equal(byType.sell_submission.publicReference, seed.sellSubmission.publicReference);

    // Both marketplace records were seeded at their schema default status.
    assert.equal(byType.buy_request.status, "pending_verification");
    assert.equal(byType.sell_submission.status, "pending_verification");
    assert.equal(byType.buy_request.verificationState, "pending");
    assert.equal(byType.sell_submission.verificationState, "pending");
    assert.equal(byType.buy_request.businessReviewState, "not_reviewed");
    assert.equal(byType.sell_submission.businessReviewState, "not_reviewed");

    // Price Check has no email-verification concept; the page renders this as an em dash.
    assert.equal(byType.price_check.verificationState, null);
    assert.equal(byType.price_check.businessReviewState, null);

    // Company / contact summary is joined per record, never deduplicated by email.
    assert.equal(byType.price_check.companyName, "Northline MRO");
    assert.equal(byType.price_check.contactName, "Priya Nandan");
    assert.equal(byType.buy_request.companyName, "Example Aviation Group");
    assert.equal(byType.buy_request.contactName, "Dana Ruiz");

    for (const record of records) {
      assert.equal(record.assigneeId, null);
      assert.equal(record.assigneeEmail, null);
      assert.ok(record.submittedAt instanceof Date);
      // Nothing sensitive escapes the projection.
      assert.deepEqual(Object.keys(record).sort(), [
        "assigneeEmail", "assigneeId", "businessReviewState", "companyName", "contactName", "id",
        "partNumber", "publicReference", "status", "submittedAt", "type",
        "urgency", "verificationState",
      ]);
    }
  });
});

test("disabling the Price Check flag removes only the Price Check row", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const seed = await seedBaseline(db, schema);

    const withFlag = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true });
    assert.deepEqual(withFlag.map((record) => record.type).sort(), ["buy_request", "price_check", "sell_submission"]);

    // `includePriceChecks: false` is exactly what the page passes when
    // NEXT_PUBLIC_PRICE_CHECK_ENABLED is off.
    const withoutFlag = await repository.listUnifiedAdminQueue(db, { includePriceChecks: false });
    assert.deepEqual(withoutFlag.map((record) => record.type).sort(), ["buy_request", "sell_submission"]);
    assert.deepEqual(
      withoutFlag.map(keyOf).sort(),
      [`buy_request:${seed.buyRequest.publicReference}`, `sell_submission:${seed.sellSubmission.publicReference}`].sort(),
    );

    // The default (omitted) is also closed: Price Check is opt-in.
    const omitted = await repository.listUnifiedAdminQueue(db);
    assert.deepEqual(omitted.map((record) => record.type).sort(), ["buy_request", "sell_submission"]);
  });
});

test("workflow filter selects a single workflow", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    await seedBaseline(db, schema);
    for (const type of ["price_check", "buy_request", "sell_submission"]) {
      const records = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, type });
      assert.equal(records.length, 1, `${type} should return exactly one row`);
      assert.equal(records[0].type, type);
    }
  });
});

test("status filter applies per workflow and skips workflows that lack the value", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const contact = await insertContact(db, schema);
    const requester = await insertRequester(db, schema);
    await insertPriceCheck(db, schema, requester.id, { status: "closed" });
    await insertBuyRequest(db, schema, contact.id, { status: "sourcing" });
    await insertSellSubmission(db, schema, contact.id, { status: "under_review" });

    // `sourcing` exists only in the Buy Request enum.
    const sourcing = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, status: "sourcing" });
    assert.deepEqual(sourcing.map((record) => record.type), ["buy_request"]);

    // `under_review` exists only in the Sell Submission enum.
    const underReview = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, status: "under_review" });
    assert.deepEqual(underReview.map((record) => record.type), ["sell_submission"]);

    // `closed` is shared by all three, so it spans workflows.
    const closed = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, status: "closed" });
    assert.deepEqual(closed.map((record) => record.type), ["price_check"]);

    // A status that belongs to no workflow returns nothing rather than everything.
    const bogus = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, status: "not_a_status" });
    assert.equal(bogus.length, 0);
  });
});

test("verification filter is opt-in and excludes Price Check", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const contact = await insertContact(db, schema);
    const requester = await insertRequester(db, schema);
    await insertPriceCheck(db, schema, requester.id);
    const pendingBuy = await insertBuyRequest(db, schema, contact.id);
    // The queue reads contact verification, so a verified case needs a verified
    // contact; the aggregate timestamp alone must not read as verified.
    const verifiedContact = await insertContact(db, schema, {
      verificationState: "VERIFIED", verifiedAt: AT("2026-08-17T12:20:00Z"),
    });
    const verifiedSell = await insertSellSubmission(db, schema, verifiedContact.id, {
      status: "verified",
      verificationRequestedAt: SELL_AT,
      verifiedAt: AT("2026-08-17T12:30:00Z"),
    });

    const pending = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, verification: "pending" });
    assert.deepEqual(pending.map(keyOf), [`buy_request:${pendingBuy.publicReference}`]);

    const verified = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, verification: "verified" });
    assert.deepEqual(verified.map(keyOf), [`sell_submission:${verifiedSell.publicReference}`]);
    assert.equal(verified[0].verificationState, "verified");

    // Unfiltered, both are still present alongside the Price Check.
    const all = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true });
    assert.equal(all.length, 3);
  });
});

test("internal review filter excludes Price Check and counters retain the other filters", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const requester = await insertRequester(db, schema);
    await insertPriceCheck(db, schema, requester.id);

    const notReviewed = await insertContact(db, schema, {
      companyName: "Review Filter Aviation",
      normalizedEmail: "not-reviewed@example.com",
      businessEmail: "not-reviewed@example.com",
    });
    const reviewed = await insertContact(db, schema, {
      companyName: "Review Filter Aviation",
      normalizedEmail: "reviewed@example.com",
      businessEmail: "reviewed@example.com",
      businessReviewState: "reviewed",
    });
    const concern = await insertContact(db, schema, {
      companyName: "Review Filter Aviation",
      normalizedEmail: "concern@example.com",
      businessEmail: "concern@example.com",
      businessReviewState: "concern",
    });

    const pendingBuy = await insertBuyRequest(db, schema, notReviewed.id, { status: "sourcing" });
    const reviewedBuy = await insertBuyRequest(db, schema, reviewed.id, { status: "sourcing" });
    await insertBuyRequest(db, schema, concern.id, { status: "quoted" });
    const reviewedSell = await insertSellSubmission(db, schema, reviewed.id, { status: "under_review" });
    const concernSell = await insertSellSubmission(db, schema, concern.id, { status: "under_review" });

    const reviewedRecords = await repository.listUnifiedAdminQueue(db, {
      includePriceChecks: true,
      review: "reviewed",
    });
    assert.deepEqual(
      reviewedRecords.map(keyOf).sort(),
      [`buy_request:${reviewedBuy.publicReference}`, `sell_submission:${reviewedSell.publicReference}`].sort(),
    );
    assert.ok(reviewedRecords.every((record) => record.businessReviewState === "reviewed"));

    const buyCounts = await repository.countMarketplaceReviewStates(db, {
      type: "buy_request",
      status: "sourcing",
      search: "Review Filter",
      review: "reviewed",
    });
    assert.deepEqual(buyCounts, { all: 2, not_reviewed: 1, reviewed: 1, concern: 0 });

    const sellCounts = await repository.countMarketplaceReviewStates(db, {
      type: "sell_submission",
      status: "under_review",
      review: "concern",
    });
    assert.deepEqual(sellCounts, { all: 2, not_reviewed: 0, reviewed: 1, concern: 1 });

    const notReviewedRecords = await repository.listUnifiedAdminQueue(db, {
      type: "buy_request",
      status: "sourcing",
      review: "not_reviewed",
    });
    assert.deepEqual(notReviewedRecords.map(keyOf), [`buy_request:${pendingBuy.publicReference}`]);

    const malformed = await repository.listUnifiedAdminQueue(db, { review: "not-a-review-state" });
    assert.deepEqual(malformed, []);
    assert.deepEqual(
      await repository.countMarketplaceReviewStates(db, { review: "not-a-review-state" }),
      { all: 0, not_reviewed: 0, reviewed: 0, concern: 0 },
    );
    assert.equal(concernSell.status, "under_review");
  });
});

test("assignee filter supports unassigned, a specific staff member, and rejects malformed ids", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const analyst = await insertAdmin(db, schema, { displayEmail: "david@cvlon.com", role: "ANALYST" });
    const contact = await insertContact(db, schema);
    const requester = await insertRequester(db, schema);

    const assignedPriceCheck = await insertPriceCheck(db, schema, requester.id, { assignedAdminUserId: analyst.id });
    const assignedBuy = await insertBuyRequest(db, schema, contact.id, { assignedAdminUserId: analyst.id });
    const unassignedSell = await insertSellSubmission(db, schema, contact.id);

    const mine = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, assignee: analyst.id });
    assert.deepEqual(
      mine.map(keyOf).sort(),
      [`price_check:${assignedPriceCheck.publicReference}`, `buy_request:${assignedBuy.publicReference}`].sort(),
    );
    for (const record of mine) {
      assert.equal(record.assigneeId, analyst.id);
      assert.equal(record.assigneeEmail, "david@cvlon.com");
    }

    const unassigned = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, assignee: "unassigned" });
    assert.deepEqual(unassigned.map(keyOf), [`sell_submission:${unassignedSell.publicReference}`]);
  });
});

test("a malformed assignee filter fails closed instead of widening to all assignees", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const analyst = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const requester = await insertRequester(db, schema);
    await insertPriceCheck(db, schema, requester.id, { assignedAdminUserId: analyst.id });
    await insertBuyRequest(db, schema, contact.id, { assignedAdminUserId: analyst.id });
    await insertSellSubmission(db, schema, contact.id);

    // The unfiltered view has three records, so "widened to everything" and
    // "failed closed" are distinguishable outcomes.
    const unfiltered = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true });
    assert.equal(unfiltered.length, 3);

    for (const malformed of [
      "'; drop table buy_requests; --",
      "% or 1=1 --",
      "all",
      "UNASSIGNED",
      "unassigned ",
      "0123456789ABCDEFGHJKMNP0T",
      "0123456789abcdefghjkmnp0tv",
      analyst.id.toLowerCase(),
      `${analyst.id}X`,
    ]) {
      const records = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, assignee: malformed });
      assert.equal(records.length, 0, `assignee=${JSON.stringify(malformed)} must return nothing`);
    }

    // The tables are intact: the malformed values never reached the database
    // as anything but a rejected filter.
    const after = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true });
    assert.equal(after.length, 3);

    // A well-formed id that simply matches nobody is also empty, not widened.
    const unknownButValid = await repository.listUnifiedAdminQueue(db, {
      includePriceChecks: true,
      assignee: "0123456789ABCDEFGHJKMNP0TV",
    });
    assert.equal(unknownButValid.length, 0);
  });
});

test("urgency filter honours AOG and critical, and excludes Sell Submissions", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const contact = await insertContact(db, schema);
    const requester = await insertRequester(db, schema);

    const aogPriceCheck = await insertPriceCheck(db, schema, requester.id, { aog: true });
    await insertPriceCheck(db, schema, requester.id, { aog: false });
    const aogBuy = await insertBuyRequest(db, schema, contact.id, { urgency: "aog" });
    const criticalBuy = await insertBuyRequest(db, schema, contact.id, { urgency: "critical" });
    await insertBuyRequest(db, schema, contact.id, { urgency: "planned" });
    await insertSellSubmission(db, schema, contact.id);

    const aog = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, urgency: "aog" });
    assert.deepEqual(
      aog.map(keyOf).sort(),
      [`price_check:${aogPriceCheck.publicReference}`, `buy_request:${aogBuy.publicReference}`].sort(),
    );

    const critical = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, urgency: "critical" });
    assert.deepEqual(
      critical.map(keyOf).sort(),
      [
        `price_check:${aogPriceCheck.publicReference}`,
        `buy_request:${aogBuy.publicReference}`,
        `buy_request:${criticalBuy.publicReference}`,
      ].sort(),
    );
    assert.ok(critical.every((record) => record.type !== "sell_submission"));
  });
});

test("search matches reference, part number and company across workflows", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const contact = await insertContact(db, schema, { companyName: "Halcyon Rotables" });
    const requester = await insertRequester(db, schema);
    const priceCheck = await insertPriceCheck(db, schema, requester.id);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const sellSubmission = await insertSellSubmission(db, schema, contact.id);

    const byCompany = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, search: "halcyon" });
    assert.deepEqual(
      byCompany.map(keyOf).sort(),
      [`buy_request:${buyRequest.publicReference}`, `sell_submission:${sellSubmission.publicReference}`].sort(),
    );

    const byReference = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, search: priceCheck.publicReference });
    assert.deepEqual(byReference.map(keyOf), [`price_check:${priceCheck.publicReference}`]);

    // The Price Check queue strips dashes before matching the normalized column.
    const byDashedPart = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, search: "BR-PART-4100" });
    assert.deepEqual(byDashedPart.map(keyOf), [`buy_request:${buyRequest.publicReference}`]);

    const byContact = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, search: "Priya Nandan" });
    assert.deepEqual(byContact.map(keyOf), [`price_check:${priceCheck.publicReference}`]);

    const byDescription = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, search: "avionics tray" });
    assert.deepEqual(byDescription.map(keyOf), [`sell_submission:${sellSubmission.publicReference}`]);

    const noMatch = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, search: "nothing-matches-this" });
    assert.equal(noMatch.length, 0);
  });
});

test("ordering is deterministic: urgency, then recency, then id", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const contact = await insertContact(db, schema);
    const requester = await insertRequester(db, schema);

    const routineSell = await insertSellSubmission(db, schema, contact.id, { submittedAt: AT("2026-08-17T09:00:00Z") });
    const routineBuy = await insertBuyRequest(db, schema, contact.id, { urgency: "standard", submittedAt: AT("2026-08-17T10:00:00Z") });
    const criticalBuy = await insertBuyRequest(db, schema, contact.id, { urgency: "critical", submittedAt: AT("2026-08-17T08:00:00Z") });
    const aogPriceCheck = await insertPriceCheck(db, schema, requester.id, { aog: true, submittedAt: AT("2026-08-17T07:00:00Z") });

    const records = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true });
    assert.deepEqual(records.map(keyOf), [
      `price_check:${aogPriceCheck.publicReference}`,   // AOG outranks everything
      `buy_request:${criticalBuy.publicReference}`,     // then critical
      `buy_request:${routineBuy.publicReference}`,      // then most recent routine
      `sell_submission:${routineSell.publicReference}`,
    ]);

    // Two routine rows at the same instant fall back to descending id.
    const sameInstant = AT("2026-08-18T00:00:00Z");
    const first = await insertSellSubmission(db, schema, contact.id, { submittedAt: sameInstant });
    const second = await insertSellSubmission(db, schema, contact.id, { submittedAt: sameInstant });
    assert.ok(second.id > first.id, "seed ids must be monotonic for this assertion to mean anything");

    const tied = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, type: "sell_submission" });
    assert.deepEqual(tied.slice(0, 2).map((record) => record.id), [second.id, first.id]);
    // Repeated reads return the same order.
    const again = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, type: "sell_submission" });
    assert.deepEqual(again.map((record) => record.id), tied.map((record) => record.id));
  });
});

test("the queue caps at 200 records and keeps the highest-ranked page", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const contact = await insertContact(db, schema);
    const base = AT("2026-08-01T00:00:00Z").valueOf();

    // 205 Buy Requests plus 205 Sell Submissions: more than the cap in a single
    // workflow and more than the cap overall, so the merge is exercised.
    for (let index = 0; index < 205; index += 1) {
      const submittedAt = new Date(base + index * 60_000);
      await insertBuyRequest(db, schema, contact.id, { submittedAt });
      await insertSellSubmission(db, schema, contact.id, { submittedAt });
    }

    const records = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true });
    assert.equal(records.length, repository.UNIFIED_QUEUE_LIMIT);
    assert.equal(records.length, 200);

    // The newest record overall must be on the page, and the page must be sorted.
    const newest = records[0].submittedAt.valueOf();
    assert.equal(newest, base + 204 * 60_000);
    for (let index = 1; index < records.length; index += 1) {
      assert.ok(
        records[index - 1].submittedAt.valueOf() >= records[index].submittedAt.valueOf(),
        "records must be in descending recency order",
      );
    }

    // A single-workflow view is capped the same way.
    const buyOnly = await repository.listUnifiedAdminQueue(db, { includePriceChecks: true, type: "buy_request" });
    assert.equal(buyOnly.length, 200);
    assert.deepEqual(
      await repository.countMarketplaceReviewStates(db, { type: "buy_request" }),
      { all: 205, not_reviewed: 205, reviewed: 0, concern: 0 },
    );
  });
});

test("combined filters intersect rather than widen", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const analyst = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema, {
      companyName: "Meridian Spares",
      verificationState: "VERIFIED", verifiedAt: AT("2026-08-17T11:20:00Z"),
    });

    const target = await insertBuyRequest(db, schema, contact.id, {
      status: "sourcing",
      urgency: "aog",
      assignedAdminUserId: analyst.id,
      verifiedAt: AT("2026-08-17T11:30:00Z"),
    });
    // Same company, but unassigned and not AOG.
    await insertBuyRequest(db, schema, contact.id, { status: "sourcing", urgency: "planned" });
    // Same assignee, but the wrong status.
    await insertBuyRequest(db, schema, contact.id, { status: "quoted", urgency: "aog", assignedAdminUserId: analyst.id });

    const records = await repository.listUnifiedAdminQueue(db, {
      includePriceChecks: true,
      type: "buy_request",
      status: "sourcing",
      urgency: "aog",
      assignee: analyst.id,
      verification: "verified",
      search: "meridian",
    });
    assert.deepEqual(records.map(keyOf), [`buy_request:${target.publicReference}`]);
  });
});
