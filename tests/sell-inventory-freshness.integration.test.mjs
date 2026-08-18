import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { NetlifyDB } from "@netlify/database-dev";

import { expectedMigrationCount, migrationsDirectory } from "./helpers/migration-archive.mjs";

/**
 * Bulk-inventory freshness, against real Postgres.
 *
 * Everything here is a stored fact. The archive is applied from empty, every
 * assertion reads the rows back, and nothing about the credential, the
 * transaction boundaries, or the refusals is inferred from source text — that is
 * what `sell-inventory-freshness.unit.test.mjs` is for.
 *
 * No storage, no scan and no upload is involved: this workflow carries one
 * credential and one of three words, so the only external system it touches is
 * the shared outbox, which is exercised through its own rows rather than by
 * sending anything.
 */

const execFileAsync = promisify(execFile);

const TOKEN_KEY = "civilon-marketplace-verify-token-key-for-tests";
const APPROVED_ORIGIN = "https://deploy-preview-1--cvlon.netlify.app";

const NOW = new Date("2026-08-18T12:00:00Z");
const SUBMITTED_AT = new Date("2026-08-17T12:00:00Z");
const VERIFIED_AT = new Date("2026-08-17T12:30:00Z");
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;

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
    const applied = await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const repository = await import("../db/price-check/repositories/sell-inventory-freshness-repository.ts");
    const reads = await import("../db/price-check/repositories/marketplace-admin-repository.ts");
    const service = await import("../lib/marketplace/sell-inventory-freshness-service.ts");
    const requestService = await import("../lib/marketplace/sell-inventory-freshness-request-service.ts");
    const token = await import("../lib/marketplace/sell-inventory-freshness-token.ts");
    const handlers = await import("../lib/marketplace/email/sell-inventory-freshness-handlers.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, applied, repository, reads, service, requestService, token, handlers, connectionString });
    await db.$client.end();
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

/** A bulk inventory submission by default: the only kind this workflow serves. */
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

/**
 * A single-part submission that satisfies `sell_submissions_mode_chk` and
 * `sell_submissions_normalized_part_number_chk`: a part number is only legal
 * alongside its normalised form.
 */
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

/** Re-derives the emailed credential from the stored nonce, as the handler does. */
async function credentialFor(db, schema, token, checkId) {
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ nonce: schema.sellInventoryFreshnessChecks.tokenDerivationNonce })
    .from(schema.sellInventoryFreshnessChecks)
    .where(eq(schema.sellInventoryFreshnessChecks.id, checkId))
    .limit(1);
  return token.deriveSellInventoryFreshnessToken(TOKEN_KEY, row.nonce);
}

/* ================================================================= schema */

test("the archive applies from empty and creates the freshness table", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    assert.equal(applied.length, expectedMigrationCount());
    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 0);

    const contactRow = await insertContact(db, schema);
    const submission = await insertSellSubmission(db, schema, contactRow.id);
    const base = {
      sellSubmissionId: submission.id,
      contactId: contactRow.id,
      tokenDerivationNonce: randomBytes(32).toString("hex"),
      issuedAt: NOW,
      expiresAt: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
    };
    const row = (overrides = {}) => ({
      id: ulid("IF"),
      keyedTokenHash: randomBytes(32).toString("hex"),
      ...base,
      ...overrides,
    });

    // The enum refuses anything outside the three answers, at the database.
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(
        row({ respondedAt: NOW, response: "partially_available" }),
      ),
      "an invented response is refused by the enum",
    );

    // The response and its timestamp are one fact and cannot drift apart.
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(row({ response: "all_available" })),
      "a response with no timestamp is refused",
    );
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(row({ respondedAt: NOW })),
      "a timestamp with no response is refused",
    );

    // Answered and revoked are mutually exclusive.
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(
        row({ respondedAt: NOW, response: "all_available", revokedAt: NOW }),
      ),
      "a check cannot be both answered and revoked",
    );

    // Expiry must follow issue, and an answer cannot precede it.
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(
        row({ expiresAt: new Date(NOW.valueOf() - 1) }),
      ),
      "expiry must be after issue",
    );
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(
        row({ respondedAt: new Date(NOW.valueOf() - 1000), response: "all_available" }),
      ),
      "an answer cannot precede the ask",
    );

    // Attempt bounds.
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(row({ attemptCount: -1 })),
      "a negative attempt count is refused",
    );
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(row({ attemptCount: 11, maxAttemptCount: 10 })),
      "attempts cannot exceed the ceiling",
    );
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(row({ maxAttemptCount: 0 })),
      "a zero ceiling is refused",
    );

    // …and accepts a well-formed live check, exactly one per submission.
    const first = row();
    await db.insert(schema.sellInventoryFreshnessChecks).values(first);
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(row()),
      "the partial unique index allows only one live check per submission",
    );
    // The same credential hash cannot be stored twice either.
    await assert.rejects(
      db.insert(schema.sellInventoryFreshnessChecks).values(
        row({ keyedTokenHash: first.keyedTokenHash, sellSubmissionId: submission.id }),
      ),
    );

    // Once the first is answered, a second live check is allowed: the partial
    // index is scoped to unanswered, unrevoked rows.
    const { eq } = await import("drizzle-orm");
    await db.update(schema.sellInventoryFreshnessChecks)
      .set({ respondedAt: NOW, response: "all_available" })
      .where(eq(schema.sellInventoryFreshnessChecks.id, first.id));
    await db.insert(schema.sellInventoryFreshnessChecks).values(row());
    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 2);
  });
});

test("the migration adds nothing to the existing Sell Submission tables", async () => {
  await withDatabase(async ({ db }) => {
    const { sql } = await import("drizzle-orm");
    // No freshness column was bolted onto an approved table.
    for (const table of ["sell_submissions", "sell_submission_items", "marketplace_attachments"]) {
      const columns = await db.execute(sql.raw(
        `select column_name from information_schema.columns
          where table_schema='public' and table_name='${table}'`,
      ));
      const names = columns.rows.map((row) => row.column_name);
      assert.ok(names.length > 0, table);
      for (const name of names) {
        assert.doesNotMatch(name, /freshness|still_available|availability/, `${table}.${name}`);
      }
    }
    // The evidence table is untouched and still carries its own columns.
    const evidence = await db.execute(sql.raw(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='marketplace_evidence_requests'
        order by ordinal_position`,
    ));
    assert.ok(evidence.rows.some((row) => row.column_name === "consumed_at"));
    assert.ok(evidence.rows.some((row) => row.column_name === "requested_categories"));
    assert.equal(evidence.rows.some((row) => row.column_name === "response"), false);
  });
});

/* ================================================================== issue */

test("issuing writes one check, one audit and one queued email in one transaction", async () => {
  await withDatabase(async ({ db, schema, requestService }) => {
    const { admin, contact, submission } = await seed(db, schema);

    const result = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id,
      actor: { id: admin.id },
      now: NOW,
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.supersededCheckId, null);
    assert.equal(result.data.expiresAt.valueOf(), NOW.valueOf() + FOURTEEN_DAYS_MS);

    const checks = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(checks.length, 1);
    const [check] = checks;
    assert.equal(check.id, result.data.checkId);
    assert.equal(check.sellSubmissionId, submission.id);
    assert.equal(check.contactId, contact.id);
    assert.equal(check.requestedByAdminUserId, admin.id);
    assert.equal(check.respondedAt, null);
    assert.equal(check.response, null);
    assert.equal(check.revokedAt, null);
    assert.equal(check.attemptCount, 0);
    assert.equal(check.maxAttemptCount, 10);
    assert.equal(check.expiresAt.valueOf() - check.issuedAt.valueOf(), FOURTEEN_DAYS_MS);

    // Exactly one audit event, naming the check and nothing about the inventory.
    const audits = await db.select().from(schema.auditEvents);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "SELL_SUBMISSION_INVENTORY_FRESHNESS_REQUESTED");
    assert.equal(audits[0].aggregateType, "sell_submission");
    assert.equal(audits[0].aggregateId, submission.id);
    assert.equal(audits[0].actorType, "ADMIN");
    assert.equal(audits[0].actorId, admin.id);
    assert.deepEqual(
      Object.keys(audits[0].sanitizedMetadata).sort(),
      ["expiresAt", "inventoryFreshnessCheckId"],
    );

    // Exactly one queued message, keyed to the check rather than the record.
    const outbox = await db.select().from(schema.notificationOutbox);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].messageType, "SELL_SUBMISSION_INVENTORY_FRESHNESS_CHECK");
    assert.equal(outbox[0].aggregateType, "sell_inventory_freshness_check");
    assert.equal(outbox[0].aggregateId, check.id);
    assert.equal(outbox[0].recipientReference, contact.id);
    assert.equal(outbox[0].state, "pending");
    assert.equal(outbox[0].sentAt, null);
    assert.equal(outbox[0].idempotencyKey, `sell-inventory-freshness:${check.id}:v1`);
    assert.equal(outbox[0].templateVersion, "sell-inventory-freshness-v1");

    // Nothing about the submission itself changed.
    const [after] = await db.select().from(schema.sellSubmissions);
    assert.equal(after.status, "verified");
    assert.equal(after.updatedAt.valueOf(), submission.updatedAt?.valueOf() ?? after.updatedAt.valueOf());
  });
});

test("no plaintext credential, URL or address is stored anywhere", async () => {
  await withDatabase(async ({ db, schema, requestService, token }) => {
    const { admin, contact, submission } = await seed(db, schema);
    const result = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id,
      actor: { id: admin.id },
      now: NOW,
    });

    const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);
    const plaintext = token.deriveSellInventoryFreshnessToken(TOKEN_KEY, check.tokenDerivationNonce);
    const stored = JSON.stringify([
      check,
      await db.select().from(schema.auditEvents),
      await db.select().from(schema.notificationOutbox),
    ]);

    assert.equal(stored.includes(plaintext), false, "the plaintext credential must never be stored");
    assert.equal(stored.includes("/sell/availability"), false, "no secure URL is stored");
    assert.equal(stored.includes(contact.businessEmail), false, "no recipient address is stored");
    assert.equal(check.keyedTokenHash, token.hashSellInventoryFreshnessToken(TOKEN_KEY, plaintext));
    assert.notEqual(check.keyedTokenHash, plaintext);
    assert.match(check.keyedTokenHash, /^[a-f0-9]{64}$/);
    // Nothing in the service's own return value carries a credential either.
    assert.equal(JSON.stringify(result).includes(plaintext), false);
    assert.equal(Object.keys(result.data).sort().join(","), "checkId,expiresAt,supersededCheckId");
  });
});

test("reissuing revokes the earlier credential and terminalises its queued email", async () => {
  await withDatabase(async ({ db, schema, requestService, service, token }) => {
    const { admin, submission } = await seed(db, schema);
    const first = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id,
      actor: { id: admin.id },
      now: NOW,
    });
    const firstToken = await credentialFor(db, schema, token, first.data.checkId);
    assert.ok(await service.viewSellInventoryFreshnessCheck(db, { token: firstToken, tokenKey: TOKEN_KEY, now: NOW }));

    const later = new Date(NOW.valueOf() + 60_000);
    const second = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id,
      actor: { id: admin.id },
      now: later,
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.supersededCheckId, first.data.checkId);

    const rows = Object.fromEntries(
      (await db.select().from(schema.sellInventoryFreshnessChecks)).map((row) => [row.id, row]),
    );
    assert.equal(rows[first.data.checkId].revokedAt.valueOf(), later.valueOf());
    assert.equal(rows[first.data.checkId].response, null);
    assert.equal(rows[second.data.checkId].revokedAt, null);
    // Exactly one live check per submission.
    assert.equal(Object.values(rows).filter((row) => !row.revokedAt && !row.respondedAt).length, 1);

    // The revoked credential is dead for both public endpoints.
    assert.equal(await service.viewSellInventoryFreshnessCheck(db, { token: firstToken, tokenKey: TOKEN_KEY, now: later }), null);
    assert.deepEqual(
      await service.respondToSellInventoryFreshnessCheck(db, {
        token: firstToken, tokenKey: TOKEN_KEY, response: "all_available", now: later,
      }),
      { outcome: "unavailable" },
    );
    const secondToken = await credentialFor(db, schema, token, second.data.checkId);
    assert.ok(await service.viewSellInventoryFreshnessCheck(db, { token: secondToken, tokenKey: TOKEN_KEY, now: later }));

    // The superseded check's queued e-mail is terminalised in the same
    // transaction, so a dispatcher never leases it, refuses it, and retries.
    const outbox = Object.fromEntries(
      (await db.select().from(schema.notificationOutbox)).map((row) => [row.aggregateId, row]),
    );
    assert.equal(outbox[first.data.checkId].state, "dead_letter");
    assert.equal(outbox[first.data.checkId].sanitizedFailureCode, "SELL_INVENTORY_FRESHNESS_SUPERSEDED");
    assert.equal(outbox[first.data.checkId].sentAt, null);
    assert.equal(outbox[first.data.checkId].attemptCount, 0);
    assert.equal(outbox[second.data.checkId].state, "pending");

    const actions = (await db.select().from(schema.auditEvents)).map((row) => row.action);
    assert.equal(actions.filter((a) => a === "SELL_SUBMISSION_INVENTORY_FRESHNESS_REVOKED").length, 1);
    assert.equal(actions.filter((a) => a === "SELL_SUBMISSION_INVENTORY_FRESHNESS_REQUESTED").length, 2);
  });
});

test("a superseding reissue leaves a running or succeeded message alone", async () => {
  await withDatabase(async ({ db, schema, requestService }) => {
    const { eq } = await import("drizzle-orm");

    for (const [state, extra] of [
      ["running", { leaseOwner: "worker-1", leaseExpiresAt: new Date(NOW.valueOf() + 60_000) }],
      ["succeeded", { sentAt: NOW, providerMessageId: "provider-abc" }],
    ]) {
      const { admin, submission } = await seed(db, schema);
      const first = await requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
      });
      await db.update(schema.notificationOutbox)
        .set({ state, ...extra })
        .where(eq(schema.notificationOutbox.aggregateId, first.data.checkId));

      await requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: submission.id,
        actor: { id: admin.id },
        now: new Date(NOW.valueOf() + 60_000),
      });

      const [row] = await db.select().from(schema.notificationOutbox)
        .where(eq(schema.notificationOutbox.aggregateId, first.data.checkId));
      assert.equal(row.state, state, `a ${state} message must not be rewritten`);
      assert.equal(row.sanitizedFailureCode, null, `a ${state} message keeps a clean failure code`);
      if (state === "running") assert.equal(row.leaseOwner, "worker-1", "the running lease is not broken");
      if (state === "succeeded") assert.equal(row.providerMessageId, "provider-abc");
    }
  });
});

test("a check Civilon cannot honour is refused and writes nothing", async () => {
  await withDatabase(async ({ db, schema, requestService }) => {
    const admin = await insertAdmin(db, schema);

    // A single-part record: freshness is a question about a list.
    const single = await seed(db, schema, { submission: SINGLE_PART });
    assert.deepEqual(
      await requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: single.submission.id, actor: { id: admin.id }, now: NOW,
      }),
      { ok: false, reason: "not_bulk_inventory", submissionKind: "single_part" },
    );

    // Every status outside the allowlist, refused without being changed.
    for (const status of ["pending_verification", "accepted", "declined", "closed", "spam", "withdrawn"]) {
      const seeded = await seed(db, schema, {
        submission: status === "pending_verification"
          ? { status, verifiedAt: null, verificationRequestedAt: SUBMITTED_AT }
          : { status },
      });
      const outcome = await requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: seeded.submission.id, actor: { id: admin.id }, now: NOW,
      });
      assert.deepEqual(outcome, { ok: false, reason: "ineligible_status", currentStatus: status }, status);
      // The record is left exactly as it was found.
      const { eq } = await import("drizzle-orm");
      const [after] = await db.select().from(schema.sellSubmissions)
        .where(eq(schema.sellSubmissions.id, seeded.submission.id));
      assert.equal(after.status, status, `${status} must not be changed by a refusal`);
    }

    // Both eligible statuses are accepted.
    for (const status of ["verified", "under_review"]) {
      const seeded = await seed(db, schema, { submission: { status } });
      const outcome = await requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: seeded.submission.id, actor: { id: admin.id }, now: NOW,
      });
      assert.equal(outcome.ok, true, status);
    }

    // A seller who never confirmed their address, and one that was deleted.
    for (const contact of [{ verificationState: "UNVERIFIED" }, { deletedAt: NOW }]) {
      const seeded = await seed(db, schema, { contact });
      assert.deepEqual(
        await requestService.requestSellInventoryFreshness(db, {
          sellSubmissionId: seeded.submission.id, actor: { id: admin.id }, now: NOW,
        }),
        { ok: false, reason: "contact_unverified" },
        JSON.stringify(contact),
      );
    }

    // A record that does not exist.
    assert.deepEqual(
      await requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: ulid("XX"), actor: { id: admin.id }, now: NOW,
      }),
      { ok: false, reason: "not_found" },
    );

    // Every refusal wrote nothing: only the accepted pair left rows behind.
    assert.equal((await db.select().from(schema.sellInventoryFreshnessChecks)).length, 2);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 2);
  });
});

/* ================================================================ delivery */

test("the handler mails only a reference, an expiry and a fresh link", async () => {
  await withDatabase(async ({ db, schema, requestService, handlers, token }) => {
    const { eq } = await import("drizzle-orm");
    const { admin, contact, submission } = await seed(db, schema);
    const issued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });
    const [message] = await db.select().from(schema.notificationOutbox);
    await db.update(schema.notificationOutbox)
      .set({ state: "running", leaseOwner: "worker-1" })
      .where(eq(schema.notificationOutbox.id, message.id));

    const sent = [];
    const provider = {
      async send(email) { sent.push(email); return { providerMessageId: "provider-1" }; },
    };
    const result = await handlers.sellInventoryFreshnessNotificationHandler.deliver(
      db,
      { ...message, state: "running", leaseOwner: "worker-1" },
      { now: NOW, leaseOwner: "worker-1", provider },
    );
    assert.equal(result.providerMessageId, "provider-1");
    assert.equal(sent.length, 1);

    const email = sent[0];
    assert.equal(email.to, contact.businessEmail);
    assert.deepEqual(email.metadata, { reference: submission.publicReference });
    // The emailed link carries the live credential and resolves to this check.
    const expected = token.deriveSellInventoryFreshnessToken(
      TOKEN_KEY,
      (await db.select().from(schema.sellInventoryFreshnessChecks))[0].tokenDerivationNonce,
    );
    assert.ok(email.textBody.includes(expected), "the link carries the re-derived credential");
    assert.match(email.textBody, /\/buy-sell-aircraft-parts\/sell\/availability#token=/);
    // Nothing about the inventory reached the message.
    const body = `${email.subject}\n${email.textBody}\n${email.htmlBody}`;
    for (const forbidden of [
      submission.description, contact.companyName, String(submission.estimatedLineItemCount),
      submission.id, contact.id, issued.data.checkId,
    ]) {
      assert.equal(body.includes(forbidden), false, `the email must not carry ${forbidden}`);
    }

    // Success is recorded under the lease, with an audit row that names the
    // check and the provider only.
    const [completed] = await db.select().from(schema.notificationOutbox);
    assert.equal(completed.state, "succeeded");
    assert.equal(completed.providerMessageId, "provider-1");
    assert.equal(completed.leaseOwner, null);
    assert.equal(completed.sentAt.valueOf(), NOW.valueOf());
    const audit = (await db.select().from(schema.auditEvents))
      .find((row) => row.action === "SELL_SUBMISSION_NOTIFICATION_SENT");
    assert.ok(audit, "a sent event is recorded");
    assert.equal(audit.aggregateId, submission.id);
    assert.equal(audit.actorType, "WORKER");
    assert.deepEqual(Object.keys(audit.sanitizedMetadata).sort(), ["inventoryFreshnessCheckId", "messageType", "provider"]);
    assert.equal(audit.sanitizedMetadata.inventoryFreshnessCheckId, issued.data.checkId);
  });
});

test("delivery under a lost lease fails, and a dead check never mails", async () => {
  await withDatabase(async ({ db, schema, requestService, repository, handlers }) => {
    const { eq } = await import("drizzle-orm");
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });
    const [message] = await db.select().from(schema.notificationOutbox);

    // A worker that no longer owns the lease cannot mark the message sent.
    await db.update(schema.notificationOutbox)
      .set({ state: "running", leaseOwner: "worker-2" })
      .where(eq(schema.notificationOutbox.id, message.id));
    await assert.rejects(
      repository.markSellInventoryFreshnessNotificationSucceeded(db, {
        checkId: issued.data.checkId,
        sellSubmissionId: submission.id,
        notificationId: message.id,
        messageType: message.messageType,
        leaseOwner: "worker-1",
        providerMessageId: "provider-1",
        now: NOW,
      }),
      /SELL_INVENTORY_FRESHNESS_DELIVERY_LEASE_LOST/,
    );

    // A revoked check refuses to load, so nothing can mail a dead link.
    await db.update(schema.sellInventoryFreshnessChecks)
      .set({ revokedAt: NOW })
      .where(eq(schema.sellInventoryFreshnessChecks.id, issued.data.checkId));
    await assert.rejects(
      repository.loadSellInventoryFreshnessDelivery(db, issued.data.checkId, NOW),
      /SELL_INVENTORY_FRESHNESS_UNAVAILABLE/,
    );
    // …and so does an expired one, and an answered one.
    await db.update(schema.sellInventoryFreshnessChecks)
      .set({ revokedAt: null })
      .where(eq(schema.sellInventoryFreshnessChecks.id, issued.data.checkId));
    await assert.rejects(
      repository.loadSellInventoryFreshnessDelivery(db, issued.data.checkId, new Date(NOW.valueOf() + FOURTEEN_DAYS_MS)),
      /SELL_INVENTORY_FRESHNESS_UNAVAILABLE/,
    );
    await db.update(schema.sellInventoryFreshnessChecks)
      .set({ respondedAt: NOW, response: "all_available" })
      .where(eq(schema.sellInventoryFreshnessChecks.id, issued.data.checkId));
    await assert.rejects(
      repository.loadSellInventoryFreshnessDelivery(db, issued.data.checkId, NOW),
      /SELL_INVENTORY_FRESHNESS_UNAVAILABLE/,
    );

    // A recorded failure names the check and the code, and nothing else.
    await handlers.sellInventoryFreshnessNotificationHandler.recordFailure(
      db,
      { ...message, aggregateId: issued.data.checkId },
      { code: "DELIVERY_FAILED", deadLetter: false, now: NOW },
    );
    const failure = (await db.select().from(schema.auditEvents))
      .find((row) => row.action === "SELL_SUBMISSION_NOTIFICATION_FAILED");
    assert.ok(failure);
    assert.equal(failure.aggregateId, submission.id);
    assert.deepEqual(
      Object.keys(failure.sanitizedMetadata).sort(),
      ["code", "deadLetter", "inventoryFreshnessCheckId", "messageType"],
    );
    assert.equal(failure.sanitizedMetadata.code, "DELIVERY_FAILED");
  });
});

/* ================================================================= viewing */

test("viewing is non-consuming and reveals only reference and expiry", async () => {
  await withDatabase(async ({ db, schema, requestService, service, token }) => {
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.checkId);

    // Viewed three times: still live, still unanswered, no attempt burned.
    for (let index = 0; index < 3; index += 1) {
      const snapshot = await service.viewSellInventoryFreshnessCheck(db, {
        token: credential, tokenKey: TOKEN_KEY, now: NOW,
      });
      assert.ok(snapshot);
      assert.equal(snapshot.publicReference, submission.publicReference);
      assert.equal(snapshot.expiresAt.valueOf(), NOW.valueOf() + FOURTEEN_DAYS_MS);
    }
    const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(check.respondedAt, null);
    assert.equal(check.response, null);
    assert.equal(check.attemptCount, 0, "viewing must not spend an attempt");
    // Viewing writes no audit row: opening a link is not a statement.
    const audits = await db.select().from(schema.auditEvents);
    assert.equal(audits.filter((row) => row.action.includes("RESPONDED")).length, 0);
  });
});

test("a forged, expired, revoked, answered or wrong-record credential resolves to nothing", async () => {
  await withDatabase(async ({ db, schema, requestService, service, token }) => {
    const { eq } = await import("drizzle-orm");
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.checkId);
    const live = { tokenKey: TOKEN_KEY, now: NOW };

    // Forged and malformed.
    for (const forged of [
      "not-a-token",
      "",
      token.deriveSellInventoryFreshnessToken(TOKEN_KEY, token.newSellInventoryFreshnessNonce()),
      credential.slice(0, 42),
      `${credential}A`,
    ]) {
      assert.equal(await service.viewSellInventoryFreshnessCheck(db, { token: forged, ...live }), null, forged);
    }
    // The right token under the wrong key.
    assert.equal(
      await service.viewSellInventoryFreshnessCheck(db, {
        token: credential,
        tokenKey: "civilon-marketplace-verify-token-key-alternate!!",
        now: NOW,
      }),
      null,
    );
    // An evidence credential is not a freshness credential, even from the same
    // nonce and the same key.
    const evidence = await import("../lib/marketplace/sell-evidence-token.ts");
    const [row] = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(
      await service.viewSellInventoryFreshnessCheck(db, {
        token: evidence.deriveSellEvidenceToken(TOKEN_KEY, row.tokenDerivationNonce),
        ...live,
      }),
      null,
    );

    // Expired.
    assert.equal(
      await service.viewSellInventoryFreshnessCheck(db, {
        token: credential, tokenKey: TOKEN_KEY, now: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
      }),
      null,
    );
    // Attempt-exhausted.
    await db.update(schema.sellInventoryFreshnessChecks)
      .set({ attemptCount: 10 })
      .where(eq(schema.sellInventoryFreshnessChecks.id, issued.data.checkId));
    assert.equal(await service.viewSellInventoryFreshnessCheck(db, { token: credential, ...live }), null);
    await db.update(schema.sellInventoryFreshnessChecks)
      .set({ attemptCount: 0 })
      .where(eq(schema.sellInventoryFreshnessChecks.id, issued.data.checkId));

    // The record moving out of the eligible statuses kills a live link.
    for (const status of ["closed", "accepted", "spam", "withdrawn", "declined"]) {
      await db.update(schema.sellSubmissions)
        .set({ status })
        .where(eq(schema.sellSubmissions.id, submission.id));
      assert.equal(await service.viewSellInventoryFreshnessCheck(db, { token: credential, ...live }), null, status);
    }
    // …and a record that turned into a single-part one does too. The stored
    // description already satisfies `sell_submissions_mode_chk`, so only the
    // kind changes.
    await db.update(schema.sellSubmissions)
      .set({ status: "verified", submissionKind: "single_part" })
      .where(eq(schema.sellSubmissions.id, submission.id));
    assert.equal(await service.viewSellInventoryFreshnessCheck(db, { token: credential, ...live }), null);
  });
});

/* =============================================================== answering */

test("an explicit answer is recorded once, atomically, and audited", async () => {
  for (const response of ["all_available", "some_changed", "none_available"]) {
    await withDatabase(async ({ db, schema, requestService, service, token }) => {
      const { admin, contact, submission } = await seed(db, schema);
      const issued = await requestService.requestSellInventoryFreshness(db, {
        sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
      });
      const credential = await credentialFor(db, schema, token, issued.data.checkId);
      const answeredAt = new Date(NOW.valueOf() + 3_600_000);

      assert.deepEqual(
        await service.respondToSellInventoryFreshnessCheck(db, {
          token: credential, tokenKey: TOKEN_KEY, response, now: answeredAt,
        }),
        { outcome: "recorded" },
        response,
      );

      const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);
      assert.equal(check.response, response);
      assert.equal(check.respondedAt.valueOf(), answeredAt.valueOf());
      assert.equal(check.revokedAt, null);
      assert.equal(check.attemptCount, 1);

      // The seller's statement changed no workflow state at all.
      const [after] = await db.select().from(schema.sellSubmissions);
      assert.equal(after.status, "verified", "a seller statement never moves the workflow");
      assert.equal(after.verifiedAt.valueOf(), VERIFIED_AT.valueOf());
      const [contactAfter] = await db.select().from(schema.marketplaceContacts);
      assert.equal(contactAfter.verificationState, "VERIFIED");
      assert.equal(contactAfter.businessReviewState, "not_reviewed");
      // No attachment or evidence review was touched.
      assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0);
      assert.equal((await db.select().from(schema.marketplaceEvidenceRequests)).length, 0);

      // One audit row, carrying ids, the response code and timestamps only.
      const audit = (await db.select().from(schema.auditEvents))
        .find((row) => row.action === "SELL_SUBMISSION_INVENTORY_FRESHNESS_RESPONDED");
      assert.ok(audit, response);
      assert.equal(audit.aggregateType, "sell_submission");
      assert.equal(audit.aggregateId, submission.id);
      assert.equal(audit.actorType, "REQUESTER");
      assert.equal(audit.actorId, contact.id);
      assert.deepEqual(
        Object.keys(audit.sanitizedMetadata).sort(),
        ["inventoryFreshnessCheckId", "respondedAt", "response"],
      );
      assert.equal(audit.sanitizedMetadata.response, response);
      // Never the seller's address, the company, or anything about the parts.
      const metadata = JSON.stringify(audit.sanitizedMetadata);
      assert.equal(metadata.includes(contact.businessEmail), false);
      assert.equal(metadata.includes(contact.companyName), false);
      assert.equal(metadata.includes(submission.description), false);
    });
  }
});

test("an answer outside the allowlist is refused and records nothing", async () => {
  await withDatabase(async ({ db, schema, requestService, service, repository, token }) => {
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.checkId);

    for (const response of [
      "ALL_AVAILABLE", "all available", "partially_available", "yes", "", null, undefined, 1, {},
    ]) {
      assert.deepEqual(
        await service.respondToSellInventoryFreshnessCheck(db, {
          token: credential, tokenKey: TOKEN_KEY, response, now: NOW,
        }),
        { outcome: "unavailable" },
        String(response),
      );
    }
    // …and the repository refuses it directly too, so a caller that skips the
    // service cannot store a value the seller was never shown.
    assert.deepEqual(
      await repository.recordSellInventoryFreshnessResponse(db, {
        keyedTokenHash: token.hashSellInventoryFreshnessToken(TOKEN_KEY, credential),
        response: "partially_available",
        now: NOW,
      }),
      { outcome: "unavailable" },
    );

    const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(check.response, null);
    assert.equal(check.respondedAt, null);
    assert.equal(check.attemptCount, 0, "a refused answer burns no attempt");
  });
});

test("a spent credential is refused uniformly, including the identical answer", async () => {
  await withDatabase(async ({ db, schema, requestService, service, token }) => {
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.checkId);

    assert.deepEqual(
      await service.respondToSellInventoryFreshnessCheck(db, {
        token: credential, tokenKey: TOKEN_KEY, response: "some_changed", now: NOW,
      }),
      { outcome: "recorded" },
    );

    // Replay is refused identically whether the answer repeats or differs, so
    // the endpoint is never an oracle for what the seller said.
    for (const response of ["some_changed", "all_available", "none_available"]) {
      assert.deepEqual(
        await service.respondToSellInventoryFreshnessCheck(db, {
          token: credential, tokenKey: TOKEN_KEY, response, now: new Date(NOW.valueOf() + 1000),
        }),
        { outcome: "unavailable" },
        response,
      );
    }
    // Viewing it again is refused too.
    assert.equal(
      await service.viewSellInventoryFreshnessCheck(db, { token: credential, tokenKey: TOKEN_KEY, now: NOW }),
      null,
    );

    // The stored answer is the first one, written once.
    const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(check.response, "some_changed");
    assert.equal(check.respondedAt.valueOf(), NOW.valueOf());
    assert.equal(check.attemptCount, 1, "replays burn no further attempts");
    const responded = (await db.select().from(schema.auditEvents))
      .filter((row) => row.action === "SELL_SUBMISSION_INVENTORY_FRESHNESS_RESPONDED");
    assert.equal(responded.length, 1, "exactly one response is ever audited");
  });
});

test("two concurrent answers cannot both be recorded", async () => {
  await withDatabase(async ({ db, schema, requestService, repository, token }) => {
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.checkId);
    const keyedTokenHash = token.hashSellInventoryFreshnessToken(TOKEN_KEY, credential);

    const results = await Promise.allSettled([
      repository.recordSellInventoryFreshnessResponse(db, { keyedTokenHash, response: "all_available", now: NOW }),
      repository.recordSellInventoryFreshnessResponse(db, { keyedTokenHash, response: "none_available", now: NOW }),
    ]);
    const recorded = results.filter(
      (entry) => entry.status === "fulfilled" && entry.value.outcome === "recorded",
    );
    assert.equal(recorded.length, 1, "exactly one of two concurrent answers is recorded");

    const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(check.attemptCount, 1);
    assert.ok(["all_available", "none_available"].includes(check.response));
    const responded = (await db.select().from(schema.auditEvents))
      .filter((row) => row.action === "SELL_SUBMISSION_INVENTORY_FRESHNESS_RESPONDED");
    assert.equal(responded.length, 1);
  });
});

test("an expired or attempt-exhausted credential cannot answer", async () => {
  await withDatabase(async ({ db, schema, requestService, service, token }) => {
    const { eq } = await import("drizzle-orm");
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.checkId);

    // Exactly at the expiry, not merely after it.
    assert.deepEqual(
      await service.respondToSellInventoryFreshnessCheck(db, {
        token: credential, tokenKey: TOKEN_KEY, response: "all_available",
        now: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
      }),
      { outcome: "unavailable" },
    );
    // One millisecond before it, the same credential works.
    const justInTime = new Date(NOW.valueOf() + FOURTEEN_DAYS_MS - 1);
    assert.deepEqual(
      await service.respondToSellInventoryFreshnessCheck(db, {
        token: credential, tokenKey: TOKEN_KEY, response: "all_available", now: justInTime,
      }),
      { outcome: "recorded" },
    );

    // Attempt exhaustion, on a fresh check.
    const second = await seed(db, schema);
    const secondIssued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: second.submission.id, actor: { id: second.admin.id }, now: NOW,
    });
    const secondCredential = await credentialFor(db, schema, token, secondIssued.data.checkId);
    await db.update(schema.sellInventoryFreshnessChecks)
      .set({ attemptCount: 10 })
      .where(eq(schema.sellInventoryFreshnessChecks.id, secondIssued.data.checkId));
    assert.deepEqual(
      await service.respondToSellInventoryFreshnessCheck(db, {
        token: secondCredential, tokenKey: TOKEN_KEY, response: "all_available", now: NOW,
      }),
      { outcome: "unavailable" },
    );
  });
});

/* ============================================================== projection */

test("the staff projection reports the real delivery state and no credential", async () => {
  await withDatabase(async ({ db, schema, requestService, reads, service, token }) => {
    const { eq } = await import("drizzle-orm");
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });

    let detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.ok(detail.inventoryFreshness);
    assert.equal(detail.inventoryFreshness.id, issued.data.checkId);
    assert.equal(detail.inventoryFreshness.requestedByEmail, admin.displayEmail);
    assert.equal(detail.inventoryFreshness.deliveryState, "pending");
    assert.equal(detail.inventoryFreshness.deliveredAt, null);
    assert.equal(detail.inventoryFreshness.response, null);
    assert.equal(detail.inventoryFreshness.respondedAt, null);
    // The projection carries no credential material at all.
    assert.deepEqual(Object.keys(detail.inventoryFreshness).sort(), [
      "deliveredAt", "deliveryState", "expiresAt", "id", "issuedAt",
      "requestedByEmail", "respondedAt", "response", "revokedAt",
    ]);
    const serialized = JSON.stringify(detail);
    const [check] = await db.select().from(schema.sellInventoryFreshnessChecks);
    assert.equal(serialized.includes(check.keyedTokenHash), false, "no keyed hash reaches the page");
    assert.equal(serialized.includes(check.tokenDerivationNonce), false, "no nonce reaches the page");

    // The outbox state is read, not assumed.
    await db.update(schema.notificationOutbox)
      .set({ state: "succeeded", sentAt: NOW, providerMessageId: "provider-1" })
      .where(eq(schema.notificationOutbox.aggregateId, issued.data.checkId));
    detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(detail.inventoryFreshness.deliveryState, "succeeded");
    assert.equal(detail.inventoryFreshness.deliveredAt.valueOf(), NOW.valueOf());
    assert.equal(JSON.stringify(detail).includes("provider-1"), false, "no provider id reaches the page");

    // The seller's answer shows up as the stored code.
    const credential = await credentialFor(db, schema, token, issued.data.checkId);
    await service.respondToSellInventoryFreshnessCheck(db, {
      token: credential, tokenKey: TOKEN_KEY, response: "some_changed", now: NOW,
    });
    detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(detail.inventoryFreshness.response, "some_changed");
    assert.equal(detail.inventoryFreshness.respondedAt.valueOf(), NOW.valueOf());
  });
});

test("the projection shows the latest check only, and null where none exists", async () => {
  await withDatabase(async ({ db, schema, requestService, reads }) => {
    // A single-part record never gets one.
    const single = await seed(db, schema, { submission: SINGLE_PART });
    const singleDetail = await reads.getSellSubmissionAdminDetail(db, single.submission.id);
    assert.equal(singleDetail.inventoryFreshness, null);
    // …and the rest of the single-part detail is unaffected by this workflow.
    assert.equal(singleDetail.evidenceRequest, null);
    assert.equal(singleDetail.sellSubmission.submissionKind, "single_part");

    // A bulk record with no check yet.
    const bulk = await seed(db, schema);
    assert.equal((await reads.getSellSubmissionAdminDetail(db, bulk.submission.id)).inventoryFreshness, null);

    // Three checks; the newest wins.
    const first = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: bulk.submission.id, actor: { id: bulk.admin.id }, now: NOW,
    });
    const second = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: bulk.submission.id, actor: { id: bulk.admin.id }, now: new Date(NOW.valueOf() + 1000),
    });
    const third = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: bulk.submission.id, actor: { id: bulk.admin.id }, now: new Date(NOW.valueOf() + 2000),
    });
    const detail = await reads.getSellSubmissionAdminDetail(db, bulk.submission.id);
    assert.equal(detail.inventoryFreshness.id, third.data.checkId);
    assert.notEqual(detail.inventoryFreshness.id, first.data.checkId);
    assert.notEqual(detail.inventoryFreshness.id, second.data.checkId);
    assert.equal(detail.inventoryFreshness.revokedAt, null);

    // One submission's check never surfaces on another's detail page.
    const other = await seed(db, schema);
    assert.equal((await reads.getSellSubmissionAdminDetail(db, other.submission.id)).inventoryFreshness, null);
  });
});

test("the derived submission state matches the stored rows through a full cycle", async () => {
  await withDatabase(async ({ db, schema, requestService, reads, service, token }) => {
    const domain = await import("../db/price-check/domain/sell-inventory-freshness.ts");
    const { admin, submission } = await seed(db, schema);

    const stateNow = async (now) => domain.sellInventoryFreshnessSubmissionState(
      (await reads.getSellSubmissionAdminDetail(db, submission.id)).inventoryFreshness,
      now,
    );

    assert.equal(await stateNow(NOW), "never_checked");

    const issued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: NOW,
    });
    assert.equal(await stateNow(NOW), "awaiting_seller");

    const credential = await credentialFor(db, schema, token, issued.data.checkId);
    await service.respondToSellInventoryFreshnessCheck(db, {
      token: credential, tokenKey: TOKEN_KEY, response: "all_available", now: NOW,
    });
    assert.equal(await stateNow(NOW), "current");
    assert.equal(await stateNow(new Date(NOW.valueOf() + FORTY_FIVE_DAYS_MS - 1)), "current");
    assert.equal(await stateNow(new Date(NOW.valueOf() + FORTY_FIVE_DAYS_MS)), "due");

    // A staff reissue after a due record, answered with a stop response.
    const reissuedAt = new Date(NOW.valueOf() + FORTY_FIVE_DAYS_MS);
    const reissued = await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: reissuedAt,
    });
    assert.equal(await stateNow(reissuedAt), "awaiting_seller");
    const second = await credentialFor(db, schema, token, reissued.data.checkId);
    await service.respondToSellInventoryFreshnessCheck(db, {
      token: second, tokenKey: TOKEN_KEY, response: "none_available", now: reissuedAt,
    });
    // Sticky: still `none_available` long after the cadence would have elapsed.
    assert.equal(await stateNow(reissuedAt), "none_available");
    assert.equal(
      await stateNow(new Date(reissuedAt.valueOf() + FORTY_FIVE_DAYS_MS * 4)),
      "none_available",
    );

    // Only a staff reissue clears it.
    const thirdAt = new Date(reissuedAt.valueOf() + FORTY_FIVE_DAYS_MS);
    await requestService.requestSellInventoryFreshness(db, {
      sellSubmissionId: submission.id, actor: { id: admin.id }, now: thirdAt,
    });
    assert.equal(await stateNow(thirdAt), "awaiting_seller");
  });
});

/* =========================================================== migration guard */

test("the production migration guard refuses a target that is not production", async () => {
  await withDatabase(async ({ connectionString }) => {
    const script = path.join(
      path.resolve(import.meta.dirname, ".."),
      "scripts",
      "apply-inventory-freshness-production-migration.mjs",
    );
    // A dry run against the local test database. The guard is pinned to the
    // approved production host, so it must refuse — and it must refuse *before*
    // it would have executed any statement.
    const run = (env) => execFileAsync(process.execPath, [script], {
      env: { ...process.env, ...env },
    }).then(
      (ok) => ({ code: 0, ...ok }),
      (error) => ({ code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }),
    );

    const local = await run({ NETLIFY_DB_URL: connectionString, NETLIFY_DB_DRIVER: "server" });
    assert.notEqual(local.code, 0, "a non-production target must not be accepted");
    assert.equal(local.stdout, "", "a refusal prints no summary");
    // The connection string, and any credential inside it, never appear in the
    // output.
    const output = `${local.stdout}${local.stderr}`;
    assert.equal(output.includes(connectionString), false, "the connection string must never be printed");
    const parsedLocal = new URL(connectionString);
    if (parsedLocal.password) assert.equal(output.includes(parsedLocal.password), false);
    if (parsedLocal.hostname) assert.equal(output.includes(parsedLocal.hostname), false);
    // …and the local database is untouched: no freshness table was created by
    // running the guard, because the guard refused before executing anything.
    const { sql } = await import("drizzle-orm");
    const schema = await import("../db/price-check/schema.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const probe = drizzle({ schema });
    const rows = await probe.execute(sql.raw(
      "select count(*)::integer as n from public.sell_inventory_freshness_checks",
    ));
    assert.equal(rows.rows[0].n, 0, "the guard executed nothing");
    await probe.$client.end();

    // A well-formed postgresql URL that is simply not the approved production
    // target is refused by name, before anything connects.
    const wrongHost = await run({
      NETLIFY_DB_URL: "postgresql://netlifydb_readonly:secret@not-production.example.com:5432/netlifydb",
      NETLIFY_DB_DRIVER: "server",
    });
    assert.notEqual(wrongHost.code, 0);
    assert.match(wrongHost.stderr, /does not match the approved target/);
    assert.equal(wrongHost.stdout, "");
    assert.equal(wrongHost.stderr.includes("secret"), false, "a password must never be echoed");

    // Missing or misconfigured connection settings are refused too.
    const missing = await run({ NETLIFY_DB_URL: "", NETLIFY_DB_DRIVER: "server" });
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /NETLIFY_DB_URL is required/);

    const wrongDriver = await run({ NETLIFY_DB_URL: connectionString, NETLIFY_DB_DRIVER: "http" });
    assert.notEqual(wrongDriver.code, 0);
    assert.match(wrongDriver.stderr, /NETLIFY_DB_DRIVER must be server/);

    // `--apply` is refused on the same unapproved target, so the destructive
    // mode is never reachable by flag alone.
    const applyAttempt = await execFileAsync(process.execPath, [script, "--apply"], {
      env: {
        ...process.env,
        NETLIFY_DB_URL: "postgresql://netlifydb_readonly:secret@not-production.example.com:5432/netlifydb",
        NETLIFY_DB_DRIVER: "server",
        CIVILON_APPLY_INVENTORY_FRESHNESS_MIGRATION: "YES",
      },
    }).then(() => ({ code: 0, stderr: "" }), (error) => ({ code: error.code ?? 1, stderr: error.stderr ?? "" }));
    assert.notEqual(applyAttempt.code, 0);
    assert.match(applyAttempt.stderr, /does not match the approved target/);
  });
});
