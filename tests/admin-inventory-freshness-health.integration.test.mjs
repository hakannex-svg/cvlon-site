import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";

import { NetlifyDB } from "@netlify/database-dev";

import { migrationsDirectory } from "./helpers/migration-archive.mjs";

/**
 * The staff-facing bulk-inventory freshness counters, against real Postgres.
 *
 * Every number asserted here is read back out of the same rows the workflow
 * itself writes: the archive is applied from empty, the fixtures are states a
 * write path could actually leave behind, and nothing about what a counter
 * reports is inferred from source text — that is what
 * `admin-inventory-freshness-health.unit.test.mjs` is for.
 *
 * The load-bearing assertion is the last one: the same matrix the cadence's own
 * integration test uses is counted here and held against
 * `sellInventoryFreshnessCadenceDecision`, so "due now" cannot drift from the
 * rule the producer actually applies without this file failing.
 */

const NOW = new Date("2026-08-18T12:00:00Z");
const SUBMITTED_AT = new Date("2026-08-17T12:00:00Z");
const VERIFIED_AT = new Date("2026-08-17T12:30:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * DAY_MS;

const ZERO = Object.freeze({
  dueNow: 0,
  liveLinks: 0,
  backoff: 0,
  sellerChanges: 0,
  deliveryConcerns: 0,
});

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  try {
    await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const repository = await import(
      "../db/price-check/repositories/marketplace-admin-repository.ts"
    );
    const cadence = await import(
      "../db/price-check/repositories/sell-inventory-freshness-cadence-repository.ts"
    );
    const domain = await import("../db/price-check/domain/sell-inventory-freshness.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    try {
      await run({ db, schema, repository, cadence, domain });
    } finally {
      // Closed even when an assertion throws, so a failing test reports the
      // assertion rather than a torn-down connection.
      await db.$client.end();
    }
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

/* ---------------------------------------------------------------- fixtures */

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
    businessEmail: `Dana.${ulid("R")}@example.com`,
    normalizedEmail: `dana.${ulid("r").toLowerCase()}@example.com`,
    verificationState: "VERIFIED",
    verifiedAt: VERIFIED_AT,
    ...overrides,
  };
  await db.insert(schema.marketplaceContacts).values(row);
  return row;
}

async function insertSellSubmission(db, schema, contactId, overrides = {}) {
  const row = {
    id: ulid("SS"),
    publicReference: reference("SS"),
    contactId,
    submissionKind: "bulk_inventory",
    description: "Warehouse clearance, mixed rotables",
    estimatedLineItemCount: 240,
    status: "verified",
    sourcePage: "/buy-sell-aircraft-parts/sell",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: SUBMITTED_AT,
    verificationRequestedAt: SUBMITTED_AT,
    verifiedAt: VERIFIED_AT,
    ...overrides,
  };
  await db.insert(schema.sellSubmissions).values(row);
  return row;
}

const SINGLE_PART = Object.freeze({
  submissionKind: "single_part",
  originalPartNumber: "SS-PART-7700",
  normalizedPartNumber: "SSPART7700",
  quantity: "1",
  estimatedLineItemCount: null,
});

/** One eligible bulk-inventory record with its own verified contact. */
async function seedRecord(db, schema, { contact = {}, submission = {} } = {}) {
  const contactRow = await insertContact(db, schema, contact);
  const submissionRow = await insertSellSubmission(db, schema, contactRow.id, submission);
  return { contact: contactRow, submission: submissionRow };
}

/** One stored check, written directly, for states the write paths cannot reach. */
async function insertCheck(db, schema, submission, contact, overrides = {}) {
  const row = {
    id: ulid("IF"),
    sellSubmissionId: submission.id,
    contactId: contact.id,
    keyedTokenHash: randomBytes(32).toString("hex"),
    tokenDerivationNonce: randomBytes(32).toString("hex"),
    requestedByAdminUserId: null,
    issuedAt: NOW,
    expiresAt: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
    ...overrides,
  };
  await db.insert(schema.sellInventoryFreshnessChecks).values(row);
  return row;
}

/** One outbox row for one freshness check, in whichever state is under test. */
async function insertFreshnessMessage(db, schema, domain, checkId, state) {
  const row = {
    id: ulid("NO"),
    messageType: domain.SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
    aggregateType: domain.SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE,
    aggregateId: checkId,
    recipientReference: ulid("CT"),
    templateVersion: "sell-inventory-freshness-v1",
    idempotencyKey: `sell-inventory-freshness:${checkId}:v1`,
    state,
    nextAttemptAt: NOW,
  };
  await db.insert(schema.notificationOutbox).values(row);
  return row;
}

/** Every stored check for one record, in the shape the pure rule reads. */
async function storedChecks(db, schema, submissionId) {
  const { eq } = await import("drizzle-orm");
  return db
    .select({
      id: schema.sellInventoryFreshnessChecks.id,
      requestedByAdminUserId: schema.sellInventoryFreshnessChecks.requestedByAdminUserId,
      issuedAt: schema.sellInventoryFreshnessChecks.issuedAt,
      expiresAt: schema.sellInventoryFreshnessChecks.expiresAt,
      respondedAt: schema.sellInventoryFreshnessChecks.respondedAt,
      revokedAt: schema.sellInventoryFreshnessChecks.revokedAt,
      response: schema.sellInventoryFreshnessChecks.response,
    })
    .from(schema.sellInventoryFreshnessChecks)
    .where(eq(schema.sellInventoryFreshnessChecks.sellSubmissionId, submissionId));
}

/* ================================================================== empty */

test("an empty database reports five zeros rather than failing", async () => {
  await withDatabase(async ({ db, repository }) => {
    assert.deepEqual(
      await repository.countSellInventoryFreshnessHealth(db, { now: NOW }),
      { ...ZERO },
    );
  });
});

/* ============================================================ the four states */

test("each stopped and unstopped state lands in exactly one record counter", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const at = (days) => new Date(NOW.valueOf() + days * DAY_MS);

    // 1. No history at all. Due immediately, exactly as the producer decides.
    await seedRecord(db, schema);

    // 2. A live credential: standing, unrevoked, expiry in the future.
    const live = await seedRecord(db, schema);
    await insertCheck(db, schema, live.submission, live.contact, {
      issuedAt: at(-1),
      expiresAt: at(13),
    });

    // 3. Two automatic asks in a row that lapsed unanswered. The first was
    //    retired by the second, which is how the producer leaves this state.
    const stopped = await seedRecord(db, schema);
    await insertCheck(db, schema, stopped.submission, stopped.contact, {
      issuedAt: at(-120), expiresAt: at(-106), revokedAt: at(-75),
    });
    await insertCheck(db, schema, stopped.submission, stopped.contact, {
      issuedAt: at(-75), expiresAt: at(-61),
    });

    // 4 and 5. Both seller stop answers.
    for (const response of ["some_changed", "none_available"]) {
      const changed = await seedRecord(db, schema);
      await insertCheck(db, schema, changed.submission, changed.contact, {
        issuedAt: at(-90), respondedAt: at(-80), response,
      });
    }

    // 6. Answered `all_available` past the cadence: due again, and not a
    //    "seller change".
    const asked = await seedRecord(db, schema);
    await insertCheck(db, schema, asked.submission, asked.contact, {
      issuedAt: at(-90), respondedAt: at(-80), response: "all_available",
    });

    // 7. Answered `all_available` inside the cadence: in no counter at all.
    const current = await seedRecord(db, schema);
    await insertCheck(db, schema, current.submission, current.contact, {
      issuedAt: at(-10), respondedAt: at(-9), response: "all_available",
    });

    assert.deepEqual(
      await repository.countSellInventoryFreshnessHealth(db, { now: NOW }),
      { dueNow: 2, liveLinks: 1, backoff: 1, sellerChanges: 2, deliveryConcerns: 0 },
    );
  });
});

/* ============================================================== eligibility */

test("only bulk-inventory records with a live status and a confirmed contact are counted", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    // The two statuses Civilon asks on. Both are counted.
    for (const status of ["verified", "under_review"]) {
      await seedRecord(db, schema, { submission: { status } });
    }
    // Every other status: concluded one way or another, or not yet confirmed by
    // the seller, so never asked. `pending_verification` carries no verified
    // stamp — the schema refuses that pairing outright.
    await seedRecord(db, schema, {
      submission: { status: "pending_verification", verifiedAt: null },
    });
    for (const status of ["accepted", "declined", "closed", "spam", "withdrawn"]) {
      await seedRecord(db, schema, { submission: { status } });
    }
    // A single-part record. "Is your inventory still available" is not a
    // question about one part.
    await seedRecord(db, schema, { submission: SINGLE_PART });
    // A contact that never confirmed its own address, and one that was deleted.
    await seedRecord(db, schema, {
      contact: { verificationState: "PENDING", verifiedAt: null },
    });
    await seedRecord(db, schema, { contact: { deletedAt: NOW } });

    assert.deepEqual(
      await repository.countSellInventoryFreshnessHealth(db, { now: NOW }),
      { ...ZERO, dueNow: 2 },
    );
  });
});

/* ============================================================ the batch cap */

test("due now reports the whole backlog, not the producer's batch of 25", async () => {
  await withDatabase(async ({ db, schema, repository, cadence, domain }) => {
    const overCap = domain.SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX + 1;
    for (let index = 0; index < overCap; index += 1) await seedRecord(db, schema);

    const counts = await repository.countSellInventoryFreshnessHealth(db, { now: NOW });
    assert.equal(counts.dueNow, overCap);
    // The producer itself still asks at most a batch at a time. The counter is
    // deliberately the larger of the two numbers.
    const batch = await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: NOW });
    assert.equal(batch.length, domain.SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX);
    assert.ok(counts.dueNow > batch.length);
  });
});

/* =========================================================== delivery states */

test("delivery concerns counts exactly the freshness messages Civilon did not send", async () => {
  await withDatabase(async ({ db, schema, repository, domain }) => {
    const admin = await insertAdmin(db, schema);
    const record = await seedRecord(db, schema);
    const at = (days) => new Date(NOW.valueOf() + days * DAY_MS);

    // One message per outbox state, each against its own check so the
    // idempotency key and the partial live index are both satisfiable. The
    // checks are staff-issued and superseded, which keeps the record's own
    // state out of the backoff run and leaves it plainly due.
    const states = ["pending", "running", "succeeded", "failed", "dead_letter"];
    for (const [index, state] of states.entries()) {
      const check = await insertCheck(db, schema, record.submission, record.contact, {
        requestedByAdminUserId: admin.id,
        issuedAt: at(-200 + index),
        expiresAt: at(-186 + index),
        revokedAt: at(-180 + index),
      });
      await insertFreshnessMessage(db, schema, domain, check.id, state);
    }

    // A message of another type, on another aggregate, in the same failed
    // state. It is another workflow's problem and must not be counted here.
    await db.insert(schema.notificationOutbox).values({
      id: ulid("NO"),
      messageType: "SELL_SUBMISSION_EVIDENCE_REQUEST",
      aggregateType: "marketplace_evidence_request",
      aggregateId: ulid("EV"),
      recipientReference: record.contact.id,
      templateVersion: "sell-evidence-request-v1",
      idempotencyKey: `sell-evidence:${ulid("EV")}:v1`,
      state: "dead_letter",
      nextAttemptAt: NOW,
    });

    const counts = await repository.countSellInventoryFreshnessHealth(db, { now: NOW });
    assert.equal(counts.deliveryConcerns, 2, "failed and dead_letter, and nothing else");
    // Delivery is counted over messages; the record counters are unmoved by it.
    // Every check above is revoked, so the record's newest check leaves it due.
    assert.equal(counts.dueNow, 1);
    assert.equal(counts.liveLinks, 0);
    assert.equal(counts.backoff, 0);
    assert.equal(counts.sellerChanges, 0);
  });
});

/* ============================================================== read-only */

test("counting writes nothing at all", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const at = (days) => new Date(NOW.valueOf() + days * DAY_MS);
    const record = await seedRecord(db, schema);
    // An expired standing credential is the one row the producer would ever
    // write to. Counting must leave it exactly as it was found.
    await insertCheck(db, schema, record.submission, record.contact, {
      issuedAt: at(-60), expiresAt: at(-46),
    });

    const snapshot = async () => ({
      checks: await db.select().from(schema.sellInventoryFreshnessChecks),
      outbox: await db.select().from(schema.notificationOutbox),
      audit: await db.select().from(schema.auditEvents),
      submissions: await db.select().from(schema.sellSubmissions),
    });

    const before = await snapshot();
    await repository.countSellInventoryFreshnessHealth(db, { now: NOW });
    await repository.countSellInventoryFreshnessHealth(db, { now: NOW });
    assert.deepEqual(await snapshot(), before);
    // The one check is still standing, still unrevoked and still unanswered.
    assert.equal(before.checks.length, 1);
    assert.equal(before.checks[0].revokedAt, null);
    assert.equal(before.audit.length, 0);
  });
});

/* ========================================================== rule agreement */

test("due now agrees with the cadence rule on every stored state", async () => {
  await withDatabase(async ({ db, schema, repository, domain }) => {
    const admin = await insertAdmin(db, schema);
    const at = (days) => new Date(NOW.valueOf() + days * DAY_MS);

    // The cadence integration test's own matrix, unchanged: one record per
    // state, each built from rows a write path could leave behind.
    const cases = [
      ["no history", []],
      ["standing and live", [{ issuedAt: at(-1) }]],
      ["standing, expired, inside the cadence", [{ issuedAt: at(-20), expiresAt: at(-6) }]],
      ["standing, expired, past the cadence", [{ issuedAt: at(-60), expiresAt: at(-46) }]],
      ["standing, expired, exactly on the cadence boundary", [{ issuedAt: at(-45), expiresAt: at(-31) }]],
      ["two lapsed automatic asks: the first retired by the second", [
        { issuedAt: at(-120), expiresAt: at(-106), revokedAt: at(-75) },
        { issuedAt: at(-75), expiresAt: at(-61) },
      ]],
      ["one lapsed automatic ask retired by a staff check the seller answered", [
        { issuedAt: at(-120), expiresAt: at(-106), revokedAt: at(-75) },
        { issuedAt: at(-75), requestedByAdminUserId: admin.id, respondedAt: at(-74), response: "all_available" },
      ]],
      ["answered inside the cadence", [{ issuedAt: at(-10), respondedAt: at(-9), response: "all_available" }]],
      ["answered on the boundary", [{ issuedAt: at(-46), respondedAt: at(-45), response: "all_available" }]],
      ["answered past the boundary", [{ issuedAt: at(-90), respondedAt: at(-80), response: "all_available" }]],
      ["stopped: some_changed", [{ issuedAt: at(-90), respondedAt: at(-80), response: "some_changed" }]],
      ["stopped: none_available", [{ issuedAt: at(-90), respondedAt: at(-80), response: "none_available" }]],
      ["revoked and stale", [{ issuedAt: at(-90), revokedAt: at(-80) }]],
      ["revoked and recent", [{ issuedAt: at(-10), revokedAt: at(-9) }]],
      ["staff check answered long ago", [
        { issuedAt: at(-90), requestedByAdminUserId: admin.id, respondedAt: at(-80), response: "all_available" },
      ]],
      ["a stop answer then a newer staff answer", [
        { issuedAt: at(-120), respondedAt: at(-119), response: "none_available" },
        { issuedAt: at(-90), requestedByAdminUserId: admin.id, respondedAt: at(-80), response: "all_available" },
      ]],
      ["a lapse superseded by an answered staff check", [
        { issuedAt: at(-120), expiresAt: at(-106), revokedAt: at(-90) },
        { issuedAt: at(-90), requestedByAdminUserId: admin.id, respondedAt: at(-80), response: "all_available" },
      ]],
    ];

    const expected = [];
    for (const [label, rows] of cases) {
      const record = await seedRecord(db, schema);
      for (const row of rows) await insertCheck(db, schema, record.submission, record.contact, row);
      const checks = await storedChecks(db, schema, record.submission.id);
      expected.push({
        label,
        decision: domain.sellInventoryFreshnessCadenceDecision(checks, NOW),
      });
    }

    const counts = await repository.countSellInventoryFreshnessHealth(db, { now: NOW });
    const byReason = (reason) => expected.filter((row) => row.decision.reason === reason).length;

    assert.equal(
      counts.dueNow,
      expected.filter((row) => row.decision.due).length,
      `due now must equal the rule's own verdict (${expected.filter((row) => row.decision.due).map((row) => row.label).join(", ")})`,
    );
    // The three refusals the section names each match the rule's own reason, so
    // a counter cannot claim a record stopped for something it did not.
    assert.equal(counts.liveLinks, byReason("live_check"));
    assert.equal(counts.backoff, byReason("lapsed_backoff"));
    assert.equal(counts.sellerChanges, byReason("stop_response"));
    // The matrix is worth having only if it exercises every counter.
    for (const [label, value] of Object.entries(counts)) {
      if (label === "deliveryConcerns") continue;
      assert.ok(value > 0, `${label} must be exercised by the matrix`);
    }
    // Nothing is counted twice, and `not_due` is deliberately in no counter.
    assert.equal(
      counts.dueNow + counts.liveLinks + counts.backoff + counts.sellerChanges,
      expected.length - byReason("not_due"),
    );
  });
});

/* =========================================================== list drill-down */

test("each freshness drill-down returns exactly its records and malformed input fails closed", async () => {
  await withDatabase(async ({ db, schema, repository }) => {
    const now = new Date();
    const at = (days) => new Date(now.valueOf() + days * DAY_MS);

    const due = await seedRecord(db, schema);

    const live = await seedRecord(db, schema);
    await insertCheck(db, schema, live.submission, live.contact, {
      issuedAt: at(-1),
      expiresAt: at(13),
    });

    const backoff = await seedRecord(db, schema);
    await insertCheck(db, schema, backoff.submission, backoff.contact, {
      issuedAt: at(-120),
      expiresAt: at(-106),
      revokedAt: at(-75),
    });
    await insertCheck(db, schema, backoff.submission, backoff.contact, {
      issuedAt: at(-75),
      expiresAt: at(-61),
    });

    const sellerChanges = await seedRecord(db, schema);
    await insertCheck(db, schema, sellerChanges.submission, sellerChanges.contact, {
      issuedAt: at(-90),
      expiresAt: at(-76),
      respondedAt: at(-80),
      response: "some_changed",
    });

    const insideCadence = await seedRecord(db, schema);
    await insertCheck(db, schema, insideCadence.submission, insideCadence.contact, {
      issuedAt: at(-10),
      expiresAt: at(4),
      respondedAt: at(-9),
      response: "all_available",
    });

    const expected = new Map([
      ["due", [due.submission.id]],
      ["live", [live.submission.id]],
      ["backoff", [backoff.submission.id]],
      ["seller_changes", [sellerChanges.submission.id]],
    ]);

    for (const [freshness, ids] of expected) {
      const rows = await repository.listUnifiedAdminQueue(db, {
        type: "sell_submission",
        freshness,
      });
      assert.deepEqual(rows.map((row) => row.id), ids, freshness);
    }

    assert.deepEqual(
      await repository.listUnifiedAdminQueue(db, {
        type: "sell_submission",
        freshness: "due'--",
      }),
      [],
      "a malformed filter must not widen to every Sell Submission",
    );

    const allRows = await repository.listUnifiedAdminQueue(db, {
      type: "sell_submission",
    });
    assert.equal(allRows.length, 5, "the fail-closed assertion must run over a non-empty list");
  });
});
