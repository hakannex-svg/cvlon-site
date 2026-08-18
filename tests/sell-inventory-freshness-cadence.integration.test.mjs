import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";

import { NetlifyDB } from "@netlify/database-dev";

import { migrationsDirectory } from "./helpers/migration-archive.mjs";

/**
 * The autonomous bulk-inventory freshness cadence, against real Postgres.
 *
 * Everything here is a stored fact: the archive is applied from empty, every
 * assertion reads the rows back, and nothing about which records are selected,
 * what the producing transaction writes, or what two producers do to each other
 * is inferred from source text — that is what
 * `sell-inventory-freshness-cadence.unit.test.mjs` is for.
 *
 * One driver limitation is worth stating where it is relied on. The local
 * emulator is PGlite behind a socket: every pooled connection reaches one
 * backend, so two "concurrent" transactions are executed one after the other and
 * no row lock can ever be observed to block. Both writers' `FOR UPDATE` on the
 * `sell_submissions` row — the producer's with SKIP LOCKED, the staff path's
 * without — is therefore proved here only to be accepted and executed; that the
 * two serialise against each other is a property of a real multi-backend server
 * and is verified independently, not claimed from these tests.
 *
 * What these tests do prove is everything that survives serialisation: which
 * records are selected, what one transaction writes and rolls back, that a
 * losing writer takes the `ON CONFLICT DO NOTHING` branch without raising, and
 * that exactly one standing check exists after every ordering exercised here.
 */

const TOKEN_KEY = "civilon-marketplace-verify-token-key-for-tests";
const APPROVED_ORIGIN = "https://deploy-preview-1--cvlon.netlify.app";

const NOW = new Date("2026-08-18T12:00:00Z");
const SUBMITTED_AT = new Date("2026-08-17T12:00:00Z");
const VERIFIED_AT = new Date("2026-08-17T12:30:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * DAY_MS;
const FORTY_FIVE_DAYS_MS = 45 * DAY_MS;

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  process.env.MARKETPLACE_VERIFY_TOKEN_KEY = TOKEN_KEY;
  process.env.URL = APPROVED_ORIGIN;
  delete process.env.DEPLOY_PRIME_URL;
  delete process.env.MARKETPLACE_EMAIL_FROM;
  try {
    await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const cadence = await import(
      "../db/price-check/repositories/sell-inventory-freshness-cadence-repository.ts"
    );
    const cadenceService = await import("../lib/marketplace/sell-inventory-freshness-cadence-service.ts");
    const requestService = await import("../lib/marketplace/sell-inventory-freshness-request-service.ts");
    const service = await import("../lib/marketplace/sell-inventory-freshness-service.ts");
    const domain = await import("../db/price-check/domain/sell-inventory-freshness.ts");
    const token = await import("../lib/marketplace/sell-inventory-freshness-token.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    try {
      await run({ db, schema, cadence, cadenceService, requestService, service, domain, token });
    } finally {
      // Closed even when an assertion throws, so a failing test reports the
      // assertion rather than a torn-down connection.
      await db.$client.end();
    }
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    delete process.env.MARKETPLACE_VERIFY_TOKEN_KEY;
    delete process.env.URL;
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

async function seed(db, schema, { contact = {}, submission = {} } = {}) {
  const admin = await insertAdmin(db, schema);
  const contactRow = await insertContact(db, schema, contact);
  const submissionRow = await insertSellSubmission(db, schema, contactRow.id, submission);
  return { admin, contact: contactRow, submission: submissionRow };
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

async function credentialFor(db, schema, token, checkId) {
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ nonce: schema.sellInventoryFreshnessChecks.tokenDerivationNonce })
    .from(schema.sellInventoryFreshnessChecks)
    .where(eq(schema.sellInventoryFreshnessChecks.id, checkId))
    .limit(1);
  return token.deriveSellInventoryFreshnessToken(TOKEN_KEY, row.nonce);
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

/* =========================================================== scheduled entry */

/**
 * First in the file on purpose: the scheduled function imports the process-wide
 * `priceCheckDb`, which binds to whichever database exists the first time it is
 * imported. Running it first means it binds to this block's database rather than
 * to one a later block has already stopped.
 */
test("the scheduled function refuses a non-production context and writes nothing", async () => {
  await withDatabase(async ({ db, schema }) => {
    const previous = {
      context: process.env.CONTEXT,
      marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED,
      sell: process.env.NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED,
    };
    const { default: run } = await import(
      "../netlify/functions/process-sell-inventory-freshness-cadence.ts"
    );
    const priceCheck = await import("../db/price-check/index.ts");
    try {
      await seed(db, schema);
      const nothingWritten = async (label) => {
        assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 0, label);
        assert.equal((await db.select().from(schema.notificationOutbox)).length, 0, label);
        assert.equal((await db.select().from(schema.auditEvents)).length, 0, label);
      };

      process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED = "true";

      // Every explicit non-production context, refused with no body at all.
      for (const context of ["deploy-preview", "branch-deploy", "dev", "production-ish", ""]) {
        process.env.CONTEXT = context;
        const response = await run();
        if (context === "") {
          // An empty CONTEXT is absent, not non-production: the schedule only
          // runs from the published deploy, where Netlify may omit it.
          assert.equal(response.status, 200, "an absent context may run");
          continue;
        }
        assert.equal(response.status, 204, context);
        assert.equal(await response.text(), "", context);
        await nothingWritten(`context ${context}`);
      }

      // Either switch off refuses too, even in production.
      process.env.CONTEXT = "production";
      for (const [marketplace, sell] of [["false", "true"], ["true", "false"], ["false", "false"]]) {
        // The first case above already issued a check under the absent context;
        // start each gate case from a clean slate so "wrote nothing" is exact.
        await db.delete(schema.notificationOutbox);
        await db.delete(schema.auditEvents);
        await db.delete(schema.sellInventoryFreshnessChecks);
        process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED = marketplace;
        process.env.NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED = sell;
        const response = await run();
        assert.equal(response.status, 204, `${marketplace}/${sell}`);
        assert.equal(await response.text(), "");
        await nothingWritten(`gates ${marketplace}/${sell}`);
      }

      // Both switches on, in production: it runs, and says only counts.
      process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED = "true";
      process.env.NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED = "true";
      const response = await run();
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ["issued", "ok", "outcomes", "retired", "scanned"]);
      assert.equal(body.ok, true);
      assert.equal(body.scanned, 1);
      assert.equal(body.issued, 1);
      assert.equal(body.retired, 0);
      assert.equal(body.outcomes.issued, 1);
      // The body a deploy log carries is digits and reason codes.
      assert.match(JSON.stringify(body), /^[{}",:\d a-z_]+$/);
      assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 1);
      assert.equal((await db.select().from(schema.notificationOutbox)).length, 1);
    } finally {
      for (const [key, value] of [
        ["CONTEXT", previous.context],
        ["NEXT_PUBLIC_MARKETPLACE_ENABLED", previous.marketplace],
        ["NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED", previous.sell],
      ]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      // The process-wide client belongs to this block's database; close it so
      // the pool does not outlive the server it points at.
      await priceCheck.priceCheckDb.$client.end();
    }
  });
});

/* ================================================================ selection */

test("a record nobody has asked about is due at once, then on the 45-day anchor", async () => {
  await withDatabase(async ({ db, schema, cadence, cadenceService, service, token }) => {
    const { submission } = await seed(db, schema);

    // No history: due immediately, and asked on the first run.
    assert.deepEqual(await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: NOW }), [submission.id]);
    const first = await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
    assert.equal(first.issued, 1);
    const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(check.requestedByAdminUserId, null, "an automatic check names no staff member");
    assert.equal(check.expiresAt.valueOf() - check.issuedAt.valueOf(), FOURTEEN_DAYS_MS);

    // While the credential is live, and while the 45 days have not elapsed,
    // nothing is due. (What happens once both are past is the two-strike
    // sequence, proved on its own below.)
    for (const offset of [0, DAY_MS, FOURTEEN_DAYS_MS - 1, FOURTEEN_DAYS_MS, FORTY_FIVE_DAYS_MS - 1]) {
      assert.deepEqual(
        await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: new Date(NOW.valueOf() + offset) }),
        [],
        `offset ${offset}`,
      );
    }

    // The seller answers. The clock now runs from the answer.
    const answeredAt = new Date(NOW.valueOf() + DAY_MS);
    const credential = await credentialFor(db, schema, token, check.id);
    assert.deepEqual(
      await service.respondToSellInventoryFreshnessCheck(db, {
        token: credential, tokenKey: TOKEN_KEY, response: "all_available", now: answeredAt,
      }),
      { outcome: "recorded" },
    );

    const due = new Date(answeredAt.valueOf() + FORTY_FIVE_DAYS_MS);
    assert.deepEqual(
      await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: new Date(due.valueOf() - 1) }),
      [],
      "one millisecond before the anchor the record is not due",
    );
    assert.deepEqual(
      await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: due }),
      [submission.id],
      "exactly at the anchor the record is due",
    );

    // …and the second ask is 45 days after the first answer, not 45 days after
    // the first ask: at most one check per submission per cadence.
    const second = await cadenceService.runSellInventoryFreshnessCadence(db, { now: due });
    assert.equal(second.issued, 1);
    const checks = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(checks.length, 2);
    assert.equal(checks.filter((row) => !row.respondedAt && !row.revokedAt).length, 1);
    assert.equal(
      checks.filter((row) => row.requestedByAdminUserId === null).length,
      2,
      "both were the schedule's",
    );
  });
});

test("an unanswered ask that lapsed starts its clock from the ask, once it is settled", async () => {
  await withDatabase(async ({ db, schema, cadence }) => {
    const { contact, submission } = await seed(db, schema);
    // A revoked lapse is the only unanswered row that can be measured: an
    // unrevoked one is standing, and standing stops the cadence outright.
    const issuedAt = new Date(NOW.valueOf() - FORTY_FIVE_DAYS_MS);
    await insertCheck(db, schema, submission, contact, {
      issuedAt,
      expiresAt: new Date(issuedAt.valueOf() + FOURTEEN_DAYS_MS),
      revokedAt: new Date(issuedAt.valueOf() + DAY_MS),
    });

    const due = new Date(issuedAt.valueOf() + FORTY_FIVE_DAYS_MS);
    assert.deepEqual(
      await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: new Date(due.valueOf() - 1) }),
      [],
    );
    assert.deepEqual(
      await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: due }),
      [submission.id],
    );
  });
});

test("only a bulk record, in a live status, with a confirmed contact is ever asked", async () => {
  await withDatabase(async ({ db, schema, cadence, cadenceService }) => {
    // A single-part record.
    const single = await seed(db, schema, { submission: SINGLE_PART });
    // Every status outside the allowlist.
    const ineligible = [];
    for (const status of ["pending_verification", "accepted", "declined", "closed", "spam", "withdrawn"]) {
      ineligible.push(await seed(db, schema, {
        submission: status === "pending_verification"
          ? { status, verifiedAt: null, verificationRequestedAt: SUBMITTED_AT }
          : { status },
      }));
    }
    // A seller who never confirmed their address, and one that was deleted.
    const unverified = await seed(db, schema, { contact: { verificationState: "UNVERIFIED" } });
    const deleted = await seed(db, schema, { contact: { deletedAt: NOW } });
    // …and the two statuses that do qualify.
    const eligible = [
      await seed(db, schema, { submission: { status: "verified" } }),
      await seed(db, schema, { submission: { status: "under_review" } }),
    ];

    const due = await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: NOW });
    assert.deepEqual([...due].sort(), eligible.map((row) => row.submission.id).sort());
    for (const excluded of [single, unverified, deleted, ...ineligible]) {
      assert.equal(due.includes(excluded.submission.id), false, excluded.submission.status);
    }

    // Asked directly — as a producer would if the record changed underneath the
    // scan — each refuses without writing anything.
    for (const excluded of [single, unverified, deleted, ...ineligible]) {
      assert.deepEqual(
        await cadence.issueAutomaticSellInventoryFreshnessCheck(db, {
          sellSubmissionId: excluded.submission.id,
          keyedTokenHash: randomBytes(32).toString("hex"),
          tokenDerivationNonce: randomBytes(32).toString("hex"),
          expiresAt: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
          now: NOW,
        }),
        { ok: false, reason: "ineligible" },
        excluded.submission.id,
      );
    }
    // A record that is not there at all is left alone just as quietly.
    assert.deepEqual(
      await cadence.issueAutomaticSellInventoryFreshnessCheck(db, {
        sellSubmissionId: ulid("XX"),
        keyedTokenHash: randomBytes(32).toString("hex"),
        tokenDerivationNonce: randomBytes(32).toString("hex"),
        expiresAt: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
        now: NOW,
      }),
      { ok: false, reason: "locked" },
    );

    const summary = await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
    assert.equal(summary.scanned, 2);
    assert.equal(summary.issued, 2);
    // Exactly the two eligible records were written to, and nothing else moved.
    const checks = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(checks.length, 2);
    assert.deepEqual(
      checks.map((row) => row.sellSubmissionId).sort(),
      eligible.map((row) => row.submission.id).sort(),
    );
    for (const untouched of [single, unverified, deleted, ...ineligible]) {
      const { eq } = await import("drizzle-orm");
      const [after] = await db.select().from(schema.sellSubmissions)
        .where(eq(schema.sellSubmissions.id, untouched.submission.id));
      assert.equal(after.status, untouched.submission.status, "a refusal never edits the record");
    }
  });
});

/* ============================================================ standing check */

test("a live credential is never retired, replaced or asked past", async () => {
  await withDatabase(async ({ db, schema, cadence, requestService, service, token }) => {
    const { admin, submission } = await seed(db, schema);
    const manual = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });
    assert.equal(manual.ok, true);
    const before = await db.select().from(schema.sellInventoryFreshnessChecks);
    const beforeAudits = await db.select().from(schema.auditEvents);
    const beforeOutbox = await db.select().from(schema.notificationOutbox);

    // Not selected at any moment of the credential's life, including its last
    // millisecond — and the cadence boundary is long past its expiry, so this is
    // the case where a careless producer would have taken it away.
    for (const offset of [0, DAY_MS, FOURTEEN_DAYS_MS - 1]) {
      assert.deepEqual(
        await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: new Date(NOW.valueOf() + offset) }),
        [],
        `offset ${offset}`,
      );
    }

    // …and asked directly, it refuses and touches nothing.
    for (const offset of [0, DAY_MS, FOURTEEN_DAYS_MS - 1]) {
      const now = new Date(NOW.valueOf() + offset);
      assert.deepEqual(
        await cadence.issueAutomaticSellInventoryFreshnessCheck(db, {
          sellSubmissionId: submission.id,
          keyedTokenHash: randomBytes(32).toString("hex"),
          tokenDerivationNonce: randomBytes(32).toString("hex"),
          expiresAt: new Date(now.valueOf() + FOURTEEN_DAYS_MS),
          now,
        }),
        { ok: false, reason: "live_check" },
        `offset ${offset}`,
      );
    }

    // Nothing changed: not the check, not its expiry, not its revocation, not
    // the audit trail, not the queued e-mail.
    assert.deepEqual(await db.select().from(schema.sellInventoryFreshnessChecks), before);
    assert.deepEqual(await db.select().from(schema.auditEvents), beforeAudits);
    assert.deepEqual(await db.select().from(schema.notificationOutbox), beforeOutbox);
    assert.equal(before.length, 1);
    assert.equal(before[0].revokedAt, null);

    // The credential still works for the seller, which is the point of all of
    // the above: a link somebody was holding was never quietly killed.
    const credential = await credentialFor(db, schema, token, manual.data.checkId);
    const justInTime = new Date(NOW.valueOf() + FOURTEEN_DAYS_MS - 1);
    assert.ok(await service.viewSellInventoryFreshnessCheck(db, {
      token: credential, tokenKey: TOKEN_KEY, now: justInTime,
    }));
    assert.deepEqual(
      await service.respondToSellInventoryFreshnessCheck(db, {
        token: credential, tokenKey: TOKEN_KEY, response: "all_available", now: justInTime,
      }),
      { outcome: "recorded" },
    );
  });
});

test("two unanswered scheduled asks stop the cadence, and staff restart it", async () => {
  await withDatabase(async ({ db, schema, cadence, cadenceService, requestService, service, domain, token }) => {
    const { admin, submission } = await seed(db, schema);
    const day = (offset) => new Date(NOW.valueOf() + offset * DAY_MS);
    const runAt = (now) => cadenceService.runSellInventoryFreshnessCadence(db, { now });
    const checksNow = () => storedChecks(db, schema, submission.id);

    /* T0 — the first automatic ask. */
    const first = await runAt(NOW);
    assert.deepEqual(
      { scanned: first.scanned, issued: first.issued, retired: first.retired },
      { scanned: 1, issued: 1, retired: 0 },
      "the first ask has nothing to retire",
    );
    const [check1] = await checksNow();
    assert.equal(check1.requestedByAdminUserId, null);
    assert.equal(check1.revokedAt, null);

    /* T0+14d — the credential lapses unanswered. Nothing happens: not due. */
    assert.deepEqual(await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: day(14) }), []);
    assert.equal((await runAt(day(14))).issued, 0);
    assert.equal((await runAt(day(44))).issued, 0);
    assert.equal((await checksNow()).length, 1);

    /* T0+45d — due. The dead credential is retired and the second ask written. */
    assert.deepEqual(await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: day(45) }), [submission.id]);
    const second = await runAt(day(45));
    assert.deepEqual(
      { scanned: second.scanned, issued: second.issued, retired: second.retired },
      { scanned: 1, issued: 1, retired: 1 },
      "the second ask retires the expired first one",
    );

    const afterSecond = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(afterSecond.length, 2);
    const retired = afterSecond.find((row) => row.id === check1.id);
    const check2 = afterSecond.find((row) => row.id !== check1.id);
    // The retirement is a revocation stamped on an already-dead credential, and
    // nothing about the first check's own history was rewritten.
    assert.equal(retired.revokedAt.valueOf(), day(45).valueOf());
    assert.equal(retired.updatedAt.valueOf(), day(45).valueOf());
    assert.equal(retired.respondedAt, null);
    assert.equal(retired.response, null);
    assert.equal(retired.issuedAt.valueOf(), NOW.valueOf());
    assert.equal(retired.expiresAt.valueOf(), NOW.valueOf() + FOURTEEN_DAYS_MS);
    assert.ok(retired.expiresAt.valueOf() <= day(45).valueOf(), "only an expired credential was retired");
    assert.equal(check2.requestedByAdminUserId, null);
    assert.equal(check2.revokedAt, null);
    assert.equal(check2.issuedAt.valueOf(), day(45).valueOf());

    // The retirement is audited as the worker's, in the manual path's revoke
    // vocabulary, carrying two ids and nothing else.
    const revocations = (await db.select().from(schema.auditEvents))
      .filter((row) => row.action === "SELL_SUBMISSION_INVENTORY_FRESHNESS_REVOKED");
    assert.equal(revocations.length, 1);
    assert.equal(revocations[0].aggregateType, "sell_submission");
    assert.equal(revocations[0].aggregateId, submission.id);
    assert.equal(revocations[0].actorType, "WORKER");
    assert.equal(revocations[0].actorId, null);
    assert.equal(revocations[0].correlationId, `sell-inventory-freshness:${check2.id}`);
    assert.deepEqual(
      Object.keys(revocations[0].sanitizedMetadata).sort(),
      ["inventoryFreshnessCheckId", "supersededByCheckId"],
    );
    assert.equal(revocations[0].sanitizedMetadata.inventoryFreshnessCheckId, check1.id);
    assert.equal(revocations[0].sanitizedMetadata.supersededByCheckId, check2.id);
    // Two asks, two queued e-mails, and the retired check's message untouched.
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 2);

    // The retired credential is dead for the seller — which it already was,
    // because it had expired three weeks earlier.
    const retiredCredential = await credentialFor(db, schema, token, check1.id);
    assert.equal(
      await service.viewSellInventoryFreshnessCheck(db, {
        token: retiredCredential, tokenKey: TOKEN_KEY, now: day(45),
      }),
      null,
    );

    /* T0+90d — the second ask has lapsed too. Two strikes: the cadence stops. */
    const history = await checksNow();
    assert.equal(domain.sellInventoryFreshnessLapsedAutomaticRun(history, day(90)), 2);
    assert.deepEqual(
      domain.sellInventoryFreshnessCadenceDecision(history, day(90)),
      { due: false, reason: "lapsed_backoff" },
    );
    assert.deepEqual(await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: day(90) }), []);
    const third = await runAt(day(90));
    assert.equal(third.scanned, 0);
    assert.equal(third.issued, 0);
    assert.deepEqual(
      await cadence.issueAutomaticSellInventoryFreshnessCheck(db, {
        sellSubmissionId: submission.id,
        keyedTokenHash: randomBytes(32).toString("hex"),
        tokenDerivationNonce: randomBytes(32).toString("hex"),
        expiresAt: new Date(day(90).valueOf() + FOURTEEN_DAYS_MS),
        now: day(90),
      }),
      { ok: false, reason: "lapsed_backoff" },
      "asked directly, the producer names the backoff",
    );
    // …and it stays stopped, however long nobody looks at it.
    for (const offset of [135, 180, 400]) {
      assert.equal((await runAt(day(offset))).issued, 0, `day ${offset}`);
    }
    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 2);

    /* A staff member asks by hand. That resets the trailing automatic run. */
    const manual = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: day(400),
    });
    assert.equal(manual.ok, true);
    assert.equal(
      domain.sellInventoryFreshnessLapsedAutomaticRun(await checksNow(), day(400)),
      0,
      "a staff check ends the run by existing",
    );
    // While that staff link is live the producer leaves it alone.
    assert.equal((await runAt(day(401))).issued, 0);

    /* The seller answers it, and the ordinary cadence resumes. */
    await service.respondToSellInventoryFreshnessCheck(db, {
      token: await credentialFor(db, schema, token, manual.data.checkId),
      tokenKey: TOKEN_KEY,
      response: "all_available",
      now: day(401),
    });
    assert.equal((await runAt(day(445))).issued, 0, "still inside the 45 days");
    const resumed = await runAt(day(446));
    assert.equal(resumed.issued, 1, "the cadence resumes after a staff reissue is answered");
    assert.equal(resumed.retired, 0, "an answered check is not a slot to free");
    const finalChecks = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(finalChecks.length, 4);
    assert.equal(
      finalChecks.filter((row) => !row.respondedAt && !row.revokedAt).length,
      1,
      "exactly one standing check throughout",
    );
  });
});

test("the partial unique index still allows exactly one standing check", async () => {
  await withDatabase(async ({ db, schema, cadenceService }) => {
    const { contact, submission } = await seed(db, schema);
    await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });

    // A second standing row is refused by the database, whatever wrote it.
    await assert.rejects(
      insertCheck(db, schema, submission, contact, { issuedAt: NOW }),
      "two standing checks for one submission are refused",
    );
    // …including one whose credential has already expired, which is why the
    // producer has to retire before it can ask again.
    await assert.rejects(
      insertCheck(db, schema, submission, contact, {
        issuedAt: new Date(NOW.valueOf() - FORTY_FIVE_DAYS_MS),
        expiresAt: new Date(NOW.valueOf() - FORTY_FIVE_DAYS_MS + FOURTEEN_DAYS_MS),
      }),
      "an expired standing row still occupies the slot",
    );
    // Once the standing row is retired, the slot is free again.
    const { eq } = await import("drizzle-orm");
    await db.update(schema.sellInventoryFreshnessChecks)
      .set({ revokedAt: NOW })
      .where(eq(schema.sellInventoryFreshnessChecks.sellSubmissionId, submission.id));
    await insertCheck(db, schema, submission, contact, { issuedAt: NOW });
    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 2);
  });
});

/* ============================================================ stop responses */

test("a stop answer stops the schedule, and a staff reissue is what restarts it", async () => {
  for (const response of ["some_changed", "none_available"]) {
    await withDatabase(async ({ db, schema, cadence, cadenceService, requestService, service, token }) => {
      const { admin, submission } = await seed(db, schema);
      await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
      const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);
      const answeredAt = new Date(NOW.valueOf() + DAY_MS);
      await service.respondToSellInventoryFreshnessCheck(db, {
        token: await credentialFor(db, schema, token, check.id),
        tokenKey: TOKEN_KEY,
        response,
        now: answeredAt,
      });

      // Sticky: never due again, however many cadences pass.
      for (const multiplier of [1, 2, 10]) {
        const later = new Date(answeredAt.valueOf() + FORTY_FIVE_DAYS_MS * multiplier);
        assert.deepEqual(
          await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: later }),
          [],
          `${response} after ${multiplier} cadences`,
        );
        const summary = await cadenceService.runSellInventoryFreshnessCadence(db, { now: later });
        assert.equal(summary.issued, 0);
      }
      assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 1);

      // A staff member asks again by hand. The schedule picks the record back up
      // once that check is answered and the next 45 days have passed.
      const reissuedAt = new Date(answeredAt.valueOf() + FORTY_FIVE_DAYS_MS * 10);
      const reissued = await requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: submission.id, actor: { id: admin.id }, now: reissuedAt,
      });
      assert.equal(reissued.ok, true);
      await service.respondToSellInventoryFreshnessCheck(db, {
        token: await credentialFor(db, schema, token, reissued.data.checkId),
        tokenKey: TOKEN_KEY,
        response: "all_available",
        now: reissuedAt,
      });
      assert.deepEqual(
        await cadence.selectDueSellInventoryFreshnessSubmissions(db, {
          now: new Date(reissuedAt.valueOf() + FORTY_FIVE_DAYS_MS - 1),
        }),
        [],
      );
      assert.deepEqual(
        await cadence.selectDueSellInventoryFreshnessSubmissions(db, {
          now: new Date(reissuedAt.valueOf() + FORTY_FIVE_DAYS_MS),
        }),
        [submission.id],
        "a staff reissue answered all_available puts the record back on the cadence",
      );
    });
  }
});

/* ================================================================== batching */

test("a run asks at most twenty-five records, oldest first, in a stable order", async () => {
  await withDatabase(async ({ db, schema, cadence, cadenceService }) => {
    const contact = await insertContact(db, schema);
    const submissions = [];
    for (let index = 0; index < 30; index += 1) {
      submissions.push(await insertSellSubmission(db, schema, contact.id, {
        submittedAt: new Date(SUBMITTED_AT.valueOf() + index * 1000),
      }));
    }

    const first = await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: NOW });
    assert.equal(first.length, 25, "the batch ceiling is twenty-five");
    // Oldest submitted first, and the same order every time it is asked.
    assert.deepEqual(first, submissions.slice(0, 25).map((row) => row.id));
    assert.deepEqual(await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: NOW }), first);
    // A caller cannot ask for more than the ceiling, and may ask for less.
    assert.equal((await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: NOW, limit: 500 })).length, 25);
    assert.deepEqual(
      await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: NOW, limit: 3 }),
      first.slice(0, 3),
    );

    const summary = await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
    assert.equal(summary.scanned, 25);
    assert.equal(summary.issued, 25);
    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 25);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 25);
    // The five that did not fit are the five newest, and they are next.
    const next = await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: NOW });
    assert.deepEqual(next, submissions.slice(25).map((row) => row.id));
  });
});

test("running twice over the same records asks once", async () => {
  await withDatabase(async ({ db, schema, cadenceService }) => {
    for (let index = 0; index < 3; index += 1) await seed(db, schema);

    const first = await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
    assert.equal(first.issued, 3);
    const afterFirst = await db.select().from(schema.sellInventoryFreshnessChecks);

    const second = await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
    assert.equal(second.scanned, 0, "nothing is even selected the second time");
    assert.equal(second.issued, 0);

    assert.deepEqual(await db.select().from(schema.sellInventoryFreshnessChecks), afterFirst);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 3);
    const keys = (await db.select().from(schema.notificationOutbox)).map((row) => row.idempotencyKey);
    assert.equal(new Set(keys).size, 3, "no message is enqueued twice");
  });
});

/* =============================================================== concurrency */

test("two producers over one record leave one check and raise nothing", async () => {
  await withDatabase(async ({ db, schema, cadenceService }) => {
    const { submission } = await seed(db, schema);

    const runs = await Promise.allSettled([
      cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW }),
      cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW }),
      cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW }),
    ]);
    for (const run of runs) {
      assert.equal(run.status, "fulfilled", `a producer must never reject: ${run.reason}`);
    }
    const issued = runs.reduce((total, run) => total + run.value.issued, 0);
    assert.equal(issued, 1, "exactly one of three concurrent producers writes the check");
    // Every other run reported a fixed category rather than failing.
    const refusals = runs.flatMap((run) => Object.entries(run.value.outcomes)
      .filter(([outcome, count]) => outcome !== "issued" && count > 0)
      .map(([outcome]) => outcome));
    for (const refusal of refusals) {
      assert.ok(["live_check", "locked", "not_due"].includes(refusal), refusal);
    }

    const checks = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].sellSubmissionId, submission.id);
    assert.equal(checks.filter((row) => !row.respondedAt && !row.revokedAt).length, 1);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 1);
    assert.equal(
      (await db.select().from(schema.auditEvents)).filter((row) => row.actorType === "WORKER").length,
      1,
      "one ask, one audit row",
    );
  });
});

test("a producer racing a staff member leaves one standing check and no error", async () => {
  await withDatabase(async ({ db, schema, cadenceService, requestService }) => {
    const { admin, submission } = await seed(db, schema);

    const [producer, manual] = await Promise.allSettled([
      cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW }),
      requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
      }),
    ]);
    assert.equal(producer.status, "fulfilled", `the producer must never reject: ${producer.reason}`);
    assert.equal(manual.status, "fulfilled", `the staff path must never reject: ${manual.reason}`);
    // The staff member's request always succeeds: the producer refuses safely,
    // and the manual path supersedes whatever it finds. Neither raises.
    assert.equal(manual.value.ok, true);

    const checks = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.ok(checks.length >= 1 && checks.length <= 2, `unexpected ${checks.length} checks`);
    assert.equal(
      checks.filter((row) => !row.respondedAt && !row.revokedAt).length,
      1,
      "exactly one standing check survives",
    );
    // The surviving standing check is the staff member's, because only the
    // manual path supersedes.
    const [standing] = checks.filter((row) => !row.respondedAt && !row.revokedAt);
    assert.equal(standing.id, manual.value.data.checkId);
    assert.equal(standing.requestedByAdminUserId, admin.id);
    // Every check that was superseded was superseded by the staff path, and the
    // producer revoked nothing.
    const revoked = checks.filter((row) => row.revokedAt);
    assert.equal(revoked.length, checks.length - 1);
  });
});

test("producer and staff member, either order, leave one standing check", async () => {
  // Run in both orders rather than as an overlap, because the emulator executes
  // every connection on one backend: two transactions cannot genuinely
  // interleave here, and no row lock can be observed to make one wait.
  //
  // What the two paths rely on against a real server is a shared lock
  // discipline — both take `FOR UPDATE` on the same `sell_submissions` row
  // before reading or writing any check, the producer with SKIP LOCKED and the
  // staff path without — so they are serialised on the record and can never
  // meet at the partial unique index. That the code takes those locks is
  // asserted in the unit suite; that they *block* each other is a property of a
  // real multi-backend Postgres and is not claimed to be proved here.
  //
  // What this test proves is what the emulator can honestly show: whichever
  // writer arrives second reads the other's committed work and does the right
  // thing with it, and exactly one standing check exists at the end either way.
  await withDatabase(async ({ db, schema, cadence, cadenceService, requestService }) => {
    const due = new Date(NOW.valueOf() + FORTY_FIVE_DAYS_MS);

    /* Staff first: the producer finds a live credential and leaves it alone. */
    {
      const { admin, submission } = await seed(db, schema);
      await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
      const [expired] = await db.select().from(schema.sellInventoryFreshnessChecks);

      const manual = await requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: submission.id, actor: { id: admin.id }, now: due,
      });
      assert.equal(manual.ok, true);
      // The staff path superseded the expired ask, as it always has.
      assert.equal(manual.data.supersededCheckId, expired.id);

      const outcome = await cadence.issueAutomaticSellInventoryFreshnessCheck(db, {
        sellSubmissionId: submission.id,
        keyedTokenHash: randomBytes(32).toString("hex"),
        tokenDerivationNonce: randomBytes(32).toString("hex"),
        expiresAt: new Date(due.valueOf() + FOURTEEN_DAYS_MS),
        now: due,
      });
      assert.deepEqual(outcome, { ok: false, reason: "live_check" });

      const checks = await db.select().from(schema.sellInventoryFreshnessChecks);
      assert.equal(checks.length, 2, "the producer wrote nothing");
      const standing = checks.filter((row) => !row.respondedAt && !row.revokedAt);
      assert.equal(standing.length, 1);
      assert.equal(standing[0].id, manual.data.checkId);
      // No worker revocation: the producer refused before retiring anything.
      const workerRevocations = (await db.select().from(schema.auditEvents)).filter(
        (row) => row.action === "SELL_SUBMISSION_INVENTORY_FRESHNESS_REVOKED" && row.actorType === "WORKER",
      );
      assert.equal(workerRevocations.length, 0);
    }

    /* Producer first: it retires the expired ask, and staff supersede its own. */
    {
      const { admin, submission } = await seed(db, schema);
      await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
      const { eq } = await import("drizzle-orm");
      const [expired] = await db.select().from(schema.sellInventoryFreshnessChecks)
        .where(eq(schema.sellInventoryFreshnessChecks.sellSubmissionId, submission.id));

      const produced = await cadence.issueAutomaticSellInventoryFreshnessCheck(db, {
        sellSubmissionId: submission.id,
        keyedTokenHash: randomBytes(32).toString("hex"),
        tokenDerivationNonce: randomBytes(32).toString("hex"),
        expiresAt: new Date(due.valueOf() + FOURTEEN_DAYS_MS),
        now: due,
      });
      assert.equal(produced.ok, true);
      assert.equal(produced.retiredCheckId, expired.id);

      const manual = await requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: submission.id, actor: { id: admin.id }, now: new Date(due.valueOf() + 1000),
      });
      assert.equal(manual.ok, true);
      assert.equal(manual.data.supersededCheckId, produced.checkId);

      const checks = await db.select().from(schema.sellInventoryFreshnessChecks)
        .where(eq(schema.sellInventoryFreshnessChecks.sellSubmissionId, submission.id));
      assert.equal(checks.length, 3);
      assert.equal(checks.filter((row) => !row.respondedAt && !row.revokedAt).length, 1);
      // Two revocations, distinguishable by who made them: the worker retiring a
      // dead credential, and the staff member replacing a live one.
      const revocations = (await db.select().from(schema.auditEvents))
        .filter((row) => row.action === "SELL_SUBMISSION_INVENTORY_FRESHNESS_REVOKED"
          && row.aggregateId === submission.id);
      assert.deepEqual(revocations.map((row) => row.actorType).sort(), ["ADMIN", "WORKER"]);
      const worker = revocations.find((row) => row.actorType === "WORKER");
      assert.equal(worker.actorId, null);
      assert.equal(worker.sanitizedMetadata.inventoryFreshnessCheckId, expired.id);
    }
  });
});

/* ================================================================ atomicity */

test("the check, the WORKER audit row and the queued email are written together", async () => {
  await withDatabase(async ({ db, schema, cadenceService, token }) => {
    const { contact, submission } = await seed(db, schema);
    const summary = await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
    assert.equal(summary.issued, 1);

    const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(check.sellSubmissionId, submission.id);
    assert.equal(check.contactId, contact.id);
    assert.equal(check.requestedByAdminUserId, null);
    assert.equal(check.respondedAt, null);
    assert.equal(check.revokedAt, null);
    assert.equal(check.attemptCount, 0);
    assert.equal(check.issuedAt.valueOf(), NOW.valueOf());

    // One audit row: WORKER, no actor, the manual path's action and correlation.
    const audits = await db.select().from(schema.auditEvents);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "SELL_SUBMISSION_INVENTORY_FRESHNESS_REQUESTED");
    assert.equal(audits[0].aggregateType, "sell_submission");
    assert.equal(audits[0].aggregateId, submission.id);
    assert.equal(audits[0].actorType, "WORKER");
    assert.equal(audits[0].actorId, null);
    assert.equal(audits[0].correlationId, `sell-inventory-freshness:${check.id}`);
    assert.deepEqual(
      Object.keys(audits[0].sanitizedMetadata).sort(),
      ["expiresAt", "inventoryFreshnessCheckId"],
    );

    // One queued message, keyed to the check, on the existing template.
    const outbox = await db.select().from(schema.notificationOutbox);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].messageType, "SELL_SUBMISSION_INVENTORY_FRESHNESS_CHECK");
    assert.equal(outbox[0].aggregateType, "sell_inventory_freshness_check");
    assert.equal(outbox[0].aggregateId, check.id);
    assert.equal(outbox[0].recipientReference, contact.id);
    assert.equal(outbox[0].state, "pending");
    assert.equal(outbox[0].idempotencyKey, `sell-inventory-freshness:${check.id}:v1`);
    assert.equal(outbox[0].templateVersion, "sell-inventory-freshness-v1");

    // Nothing sensitive is stored anywhere the producer wrote.
    const plaintext = token.deriveSellInventoryFreshnessToken(TOKEN_KEY, check.tokenDerivationNonce);
    const stored = JSON.stringify([check, audits, outbox]);
    assert.equal(stored.includes(plaintext), false, "no plaintext credential is stored");
    assert.equal(stored.includes("/sell/availability"), false, "no secure URL is stored");
    assert.equal(stored.includes(contact.businessEmail), false, "no recipient address is stored");
    assert.equal(stored.includes(submission.publicReference), false, "no reference is stored");
    assert.equal(stored.includes(submission.description), false, "nothing about the inventory is stored");
    assert.equal(check.keyedTokenHash, token.hashSellInventoryFreshnessToken(TOKEN_KEY, plaintext));

    // The submission itself is untouched.
    const [after] = await db.select().from(schema.sellSubmissions);
    assert.equal(after.status, "verified");
    assert.equal(after.verifiedAt.valueOf(), VERIFIED_AT.valueOf());
  });
});

test("a failure enqueuing the email leaves no check and no audit row behind", async () => {
  await withDatabase(async ({ db, schema, cadence }) => {
    const { submission } = await seed(db, schema);
    const { sql } = await import("drizzle-orm");
    // Fault injection at the last write of the transaction: the outbox insert is
    // made to fail, so what is proved is the rollback rather than the ordering.
    await db.execute(sql.raw(
      `alter table "notification_outbox" add constraint "tmp_freshness_boom"
         check ("message_type" <> 'SELL_SUBMISSION_INVENTORY_FRESHNESS_CHECK')`,
    ));
    try {
      await assert.rejects(cadence.issueAutomaticSellInventoryFreshnessCheck(db, {
        sellSubmissionId: submission.id,
        keyedTokenHash: randomBytes(32).toString("hex"),
        tokenDerivationNonce: randomBytes(32).toString("hex"),
        expiresAt: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
        now: NOW,
      }));
    } finally {
      await db.execute(sql.raw('alter table "notification_outbox" drop constraint "tmp_freshness_boom"'));
    }

    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 0);
    assert.equal((await db.select().from(schema.auditEvents)).length, 0);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 0);

    // …and with the constraint gone the same ask succeeds, so the rollback left
    // nothing that would block a later run.
    const outcome = await cadence.issueAutomaticSellInventoryFreshnessCheck(db, {
      sellSubmissionId: submission.id,
      keyedTokenHash: randomBytes(32).toString("hex"),
      tokenDerivationNonce: randomBytes(32).toString("hex"),
      expiresAt: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
      now: NOW,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.retiredCheckId, null);
    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 1);
    assert.equal((await db.select().from(schema.auditEvents)).length, 1);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 1);
  });
});

test("a failure after a retirement puts the retired credential back", async () => {
  await withDatabase(async ({ db, schema, cadence, cadenceService }) => {
    const { submission } = await seed(db, schema);
    await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
    const [before] = await db.select().from(schema.sellInventoryFreshnessChecks);
    const auditsBefore = await db.select().from(schema.auditEvents);
    const due = new Date(NOW.valueOf() + FORTY_FIVE_DAYS_MS);

    const { sql } = await import("drizzle-orm");
    // The same fault injection, now against a run that must retire first: the
    // outbox insert fails after the retirement and the new check are written.
    await db.execute(sql.raw(
      `alter table "notification_outbox" add constraint "tmp_freshness_boom"
         check ("message_type" <> 'SELL_SUBMISSION_INVENTORY_FRESHNESS_CHECK') not valid`,
    ));
    try {
      await assert.rejects(cadence.issueAutomaticSellInventoryFreshnessCheck(db, {
        sellSubmissionId: submission.id,
        keyedTokenHash: randomBytes(32).toString("hex"),
        tokenDerivationNonce: randomBytes(32).toString("hex"),
        expiresAt: new Date(due.valueOf() + FOURTEEN_DAYS_MS),
        now: due,
      }));
    } finally {
      await db.execute(sql.raw('alter table "notification_outbox" drop constraint "tmp_freshness_boom"'));
    }

    // The retirement went back with everything else: the credential is standing
    // again, exactly as it was, and no second check or audit row exists.
    const [after] = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.deepEqual(after, before, "the retired credential is restored untouched");
    assert.equal(after.revokedAt, null);
    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 1);
    assert.deepEqual(await db.select().from(schema.auditEvents), auditsBefore);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 1);

    // The next run, with nothing broken, does the whole thing atomically.
    const summary = await cadenceService.runSellInventoryFreshnessCadence(db, { now: due });
    assert.equal(summary.issued, 1);
    assert.equal(summary.retired, 1);
    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 2);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 2);
  });
});

test("an expiry that is not in the future is refused before anything is written", async () => {
  await withDatabase(async ({ db, schema, cadence }) => {
    const { submission } = await seed(db, schema);
    for (const expiresAt of [NOW, new Date(NOW.valueOf() - 1)]) {
      await assert.rejects(
        cadence.issueAutomaticSellInventoryFreshnessCheck(db, {
          sellSubmissionId: submission.id,
          keyedTokenHash: randomBytes(32).toString("hex"),
          tokenDerivationNonce: randomBytes(32).toString("hex"),
          expiresAt,
          now: NOW,
        }),
        /SELL_INVENTORY_FRESHNESS_EXPIRY_INVALID/,
      );
    }
    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 0);
    assert.equal((await db.select().from(schema.auditEvents)).length, 0);
  });
});

/* ================================================================== delivery */

test("the existing worker delivers a produced check with no change of its own", async () => {
  await withDatabase(async ({ db, schema, cadenceService, token }) => {
    const { contact, submission } = await seed(db, schema);
    await cadenceService.runSellInventoryFreshnessCadence(db, { now: NOW });
    const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);

    const sent = [];
    const provider = {
      async send(email) { sent.push(email); return { providerMessageId: "provider-1" }; },
    };
    // The unmodified Stage 1 drain: it leases, dispatches to the registered
    // handler for this message type, and completes under its own lease.
    const { processOneResultNotification } = await import("../lib/price-check/email/worker.ts");
    const result = await processOneResultNotification(db, { provider, now: NOW });
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.equal(result.providerMessageId, "provider-1");
    assert.equal(sent.length, 1);

    const email = sent[0];
    assert.equal(email.to, contact.businessEmail);
    assert.deepEqual(email.metadata, { reference: submission.publicReference });
    // The link carries the credential re-derived from the stored nonce.
    const expected = token.deriveSellInventoryFreshnessToken(TOKEN_KEY, check.tokenDerivationNonce);
    assert.ok(email.textBody.includes(expected), "the link carries the re-derived credential");
    assert.match(email.textBody, /\/buy-sell-aircraft-parts\/sell\/availability#token=/);
    // Nothing about the inventory, the record or the schedule reached the seller.
    const body = `${email.subject}\n${email.textBody}\n${email.htmlBody}`;
    for (const forbidden of [
      submission.description, contact.companyName, String(submission.estimatedLineItemCount),
      submission.id, contact.id, check.id, "scheduled", "automatic", "automated",
    ]) {
      assert.equal(body.includes(forbidden), false, `the email must not carry ${forbidden}`);
    }

    // The outbox row completed, and the send was audited as the worker's.
    const [completed] = await db.select().from(schema.notificationOutbox);
    assert.equal(completed.state, "succeeded");
    assert.equal(completed.providerMessageId, "provider-1");
    assert.equal(completed.leaseOwner, null);
    const audits = await db.select().from(schema.auditEvents);
    const requested = audits.find((row) => row.action === "SELL_SUBMISSION_INVENTORY_FRESHNESS_REQUESTED");
    const delivered = audits.find((row) => row.action === "SELL_SUBMISSION_NOTIFICATION_SENT");
    assert.ok(requested && delivered);
    assert.equal(requested.actorType, "WORKER");
    assert.equal(delivered.actorType, "WORKER");
    assert.equal(delivered.sanitizedMetadata.inventoryFreshnessCheckId, check.id);

    // A second drain has nothing to do: one ask, one message, one send.
    assert.equal((await processOneResultNotification(db, { provider, now: NOW })).status, "idle");
    assert.equal(sent.length, 1);
  });
});

/* ============================================================ rule agreement */

test("the batch predicate and the pure rule agree on every stored state", async () => {
  await withDatabase(async ({ db, schema, cadence, domain }) => {
    const admin = await insertAdmin(db, schema);
    const at = (days) => new Date(NOW.valueOf() + days * DAY_MS);

    // One record per state, each built from rows a write path could leave
    // behind: only one unanswered, unrevoked check per record.
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
      const contact = await insertContact(db, schema);
      const submission = await insertSellSubmission(db, schema, contact.id);
      for (const row of rows) await insertCheck(db, schema, submission, contact, row);
      const decision = domain.sellInventoryFreshnessCadenceDecision(
        await storedChecks(db, schema, submission.id),
        NOW,
      );
      expected.push({ label, id: submission.id, due: decision.due, reason: decision.reason });
    }

    const selected = new Set(await cadence.selectDueSellInventoryFreshnessSubmissions(db, { now: NOW, limit: 25 }));
    for (const { label, id, due, reason } of expected) {
      assert.equal(
        selected.has(id),
        due,
        `${label}: the batch predicate and the pure rule disagree (rule said ${reason})`,
      );
    }
    // The matrix is worth having only if it exercises both answers.
    assert.ok(expected.some((row) => row.due), "some state must be due");
    assert.ok(expected.some((row) => !row.due), "some state must not be due");
  });
});
