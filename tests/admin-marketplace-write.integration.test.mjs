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
    const writes = await import("../db/price-check/repositories/marketplace-write-repository.ts");
    const reads = await import("../db/price-check/repositories/marketplace-admin-repository.ts");
    const { roleCan } = await import("../lib/price-check/admin/policy.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, writes, reads, roleCan });
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
const VERIFIED_AT = AT("2026-08-17T12:30:00Z");

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

/** Non-pending statuses need `verified_at`, per `*_pending_verification_chk`. */
const VERIFICATION_EXEMPT = new Set(["pending_verification", "spam", "withdrawn", "closed"]);
function verificationColumns(status) {
  if (!status || VERIFICATION_EXEMPT.has(status)) return {};
  return { verificationRequestedAt: SUBMITTED_AT, verifiedAt: VERIFIED_AT };
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
    ...verificationColumns(overrides.status),
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
    originalPartNumber: "SS-PART-7700",
    normalizedPartNumber: "SSPART7700",
    description: "Surplus avionics tray",
    notes: "Seller supplied note",
    sourcePage: "/buy-sell-aircraft-parts/sell",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: SUBMITTED_AT,
    ...verificationColumns(overrides.status),
    ...overrides,
  };
  await db.insert(schema.sellSubmissions).values(row);
  return row;
}

async function rowOf(db, schema, aggregate, id) {
  const { eq } = await import("drizzle-orm");
  const table = aggregate === "buy_request" ? schema.buyRequests : schema.sellSubmissions;
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  return row;
}

async function auditFor(db, schema, aggregateId) {
  const { eq } = await import("drizzle-orm");
  return db.select().from(schema.auditEvents).where(eq(schema.auditEvents.aggregateId, aggregateId));
}

async function notesFor(db, schema, aggregateId) {
  const { eq } = await import("drizzle-orm");
  return db.select().from(schema.marketplaceNotes).where(eq(schema.marketplaceNotes.aggregateId, aggregateId));
}

const ADMIN_ACTOR = (admin) => ({ id: admin.id, role: admin.role });

/* ------------------------------------------------------------------ status */

test("every legal edge of both graphs succeeds and is audited", async () => {
  await withDatabase(async ({ db, schema, writes, roleCan }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);

    const paths = [
      ["buy_request", ["pending_verification", "verified", "sourcing", "quoted", "converted", "closed"]],
      ["sell_submission", ["pending_verification", "verified", "under_review", "accepted", "closed"]],
      ["sell_submission", ["pending_verification", "verified", "under_review", "declined", "closed"]],
    ];

    for (const [aggregate, chain] of paths) {
      const record = aggregate === "buy_request"
        ? await insertBuyRequest(db, schema, contact.id)
        : await insertSellSubmission(db, schema, contact.id);

      for (let index = 0; index < chain.length - 1; index += 1) {
        const result = await writes.changeMarketplaceStatus(db, {
          aggregate, id: record.id,
          expectedStatus: chain[index], to: chain[index + 1],
          actor: ADMIN_ACTOR(admin), roleCan,
        });
        assert.equal(result.ok, true, `${aggregate}: ${chain[index]} -> ${chain[index + 1]}`);
        const stored = await rowOf(db, schema, aggregate, record.id);
        assert.equal(stored.status, chain[index + 1]);
      }

      const audit = await auditFor(db, schema, record.id);
      assert.equal(audit.length, chain.length - 1, `${aggregate}: one audit row per transition`);
      assert.ok(audit.every((row) => row.actorType === "ADMIN" && row.actorId === admin.id));
      assert.ok(audit.every((row) => row.aggregateType === aggregate));
    }
  });
});

test("an illegal, terminal or stale transition changes nothing and records nothing", async () => {
  await withDatabase(async ({ db, schema, writes, roleCan }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);

    // Illegal edge: pending_verification straight to sourcing.
    const illegal = await insertBuyRequest(db, schema, contact.id);
    const a = await writes.changeMarketplaceStatus(db, {
      aggregate: "buy_request", id: illegal.id,
      expectedStatus: "pending_verification", to: "sourcing",
      actor: ADMIN_ACTOR(admin), roleCan,
    });
    assert.deepEqual(a, { ok: false, reason: "forbidden_transition" });
    assert.equal((await rowOf(db, schema, "buy_request", illegal.id)).status, "pending_verification");
    assert.equal((await auditFor(db, schema, illegal.id)).length, 0);

    // Terminal: no resurrection out of closed, spam or withdrawn.
    for (const terminal of ["closed", "spam", "withdrawn"]) {
      const dead = await insertBuyRequest(db, schema, contact.id, { status: terminal, closedAt: VERIFIED_AT });
      for (const to of ["verified", "sourcing", "quoted", "converted"]) {
        const result = await writes.changeMarketplaceStatus(db, {
          aggregate: "buy_request", id: dead.id, expectedStatus: terminal, to,
          actor: ADMIN_ACTOR(admin), roleCan,
        });
        assert.deepEqual(result, { ok: false, reason: "forbidden_transition" }, `${terminal} -> ${to}`);
      }
      assert.equal((await rowOf(db, schema, "buy_request", dead.id)).status, terminal);
      assert.equal((await auditFor(db, schema, dead.id)).length, 0);
    }

    // Stale: the caller believes the record is still pending.
    const moved = await insertBuyRequest(db, schema, contact.id);
    await writes.changeMarketplaceStatus(db, {
      aggregate: "buy_request", id: moved.id,
      expectedStatus: "pending_verification", to: "verified",
      actor: ADMIN_ACTOR(admin), roleCan,
    });
    const stale = await writes.changeMarketplaceStatus(db, {
      aggregate: "buy_request", id: moved.id,
      expectedStatus: "pending_verification", to: "spam",
      actor: ADMIN_ACTOR(admin), roleCan,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "conflict");
    assert.equal(stale.currentStatus, "verified");
    assert.equal((await rowOf(db, schema, "buy_request", moved.id)).status, "verified", "the stale write must not overwrite");
    assert.equal((await auditFor(db, schema, moved.id)).length, 1, "only the first change was recorded");

    // A record that does not exist.
    const missing = await writes.changeMarketplaceStatus(db, {
      aggregate: "buy_request", id: ulid("BR"),
      expectedStatus: "pending_verification", to: "verified",
      actor: ADMIN_ACTOR(admin), roleCan,
    });
    assert.deepEqual(missing, { ok: false, reason: "not_found" });
  });
});

test("spam and closed are refused for ANALYST and REVIEWER, allowed for ADMIN", async () => {
  await withDatabase(async ({ db, schema, writes, roleCan }) => {
    const contact = await insertContact(db, schema);
    const analyst = await insertAdmin(db, schema, { role: "ANALYST" });
    const reviewer = await insertAdmin(db, schema, { role: "REVIEWER" });
    const auditor = await insertAdmin(db, schema, { role: "AUDITOR" });
    const admin = await insertAdmin(db, schema, { role: "ADMIN" });

    for (const actor of [analyst, reviewer, auditor]) {
      for (const to of ["spam", "closed"]) {
        const record = await insertBuyRequest(db, schema, contact.id, { status: "verified" });
        const result = await writes.changeMarketplaceStatus(db, {
          aggregate: "buy_request", id: record.id, expectedStatus: "verified", to,
          actor: ADMIN_ACTOR(actor), roleCan,
        });
        assert.deepEqual(result, { ok: false, reason: "forbidden_transition" }, `${actor.role} -> ${to}`);
        assert.equal((await rowOf(db, schema, "buy_request", record.id)).status, "verified");
        assert.equal((await auditFor(db, schema, record.id)).length, 0);
      }
    }

    // An ordinary edge is fine for ANALYST; AUDITOR is refused even there.
    const ordinary = await insertBuyRequest(db, schema, contact.id, { status: "verified" });
    assert.equal((await writes.changeMarketplaceStatus(db, {
      aggregate: "buy_request", id: ordinary.id, expectedStatus: "verified", to: "sourcing",
      actor: ADMIN_ACTOR(analyst), roleCan,
    })).ok, true);

    const readOnly = await insertBuyRequest(db, schema, contact.id, { status: "verified" });
    assert.deepEqual(await writes.changeMarketplaceStatus(db, {
      aggregate: "buy_request", id: readOnly.id, expectedStatus: "verified", to: "sourcing",
      actor: ADMIN_ACTOR(auditor), roleCan,
    }), { ok: false, reason: "forbidden_transition" });

    // ADMIN may close and mark spam.
    for (const to of ["spam", "closed"]) {
      const record = await insertBuyRequest(db, schema, contact.id, { status: "verified" });
      const result = await writes.changeMarketplaceStatus(db, {
        aggregate: "buy_request", id: record.id, expectedStatus: "verified", to,
        actor: ADMIN_ACTOR(admin), roleCan,
      });
      assert.equal(result.ok, true, to);
      const stored = await rowOf(db, schema, "buy_request", record.id);
      assert.equal(stored.status, to);
      assert.notEqual(stored.closedAt, null, "a terminal state sets closed_at");
      const audit = await auditFor(db, schema, record.id);
      assert.equal(audit[0].action, to === "spam" ? "BUY_REQUEST_MARKED_SPAM" : "BUY_REQUEST_CLOSED");
    }
  });
});

test("the manual verification override never falsifies the contact's verification", async () => {
  await withDatabase(async ({ db, schema, writes, reads, roleCan }) => {
    const { eq } = await import("drizzle-orm");
    const admin = await insertAdmin(db, schema, { role: "ADMIN" });
    const analyst = await insertAdmin(db, schema, { role: "ANALYST" });
    // The contact never confirmed their address.
    const contact = await insertContact(db, schema, { verificationState: "PENDING", verificationRequestedAt: SUBMITTED_AT });

    for (const aggregate of ["buy_request", "sell_submission"]) {
      const record = aggregate === "buy_request"
        ? await insertBuyRequest(db, schema, contact.id)
        : await insertSellSubmission(db, schema, contact.id);

      // ANALYST cannot perform the override.
      assert.deepEqual(await writes.changeMarketplaceStatus(db, {
        aggregate, id: record.id, expectedStatus: "pending_verification", to: "verified",
        actor: ADMIN_ACTOR(analyst), roleCan,
      }), { ok: false, reason: "forbidden_transition" });

      const result = await writes.changeMarketplaceStatus(db, {
        aggregate, id: record.id, expectedStatus: "pending_verification", to: "verified",
        actor: ADMIN_ACTOR(admin), roleCan,
      });
      assert.equal(result.ok, true);

      // The contact row is untouched: still PENDING, still never verified.
      const [storedContact] = await db.select().from(schema.marketplaceContacts)
        .where(eq(schema.marketplaceContacts.id, contact.id)).limit(1);
      assert.equal(storedContact.verificationState, "PENDING");
      assert.equal(storedContact.verifiedAt, null);
      assert.equal(storedContact.verificationRevokedAt, null);

      // The override is recorded under its own action, naming the staff member.
      const audit = await auditFor(db, schema, record.id);
      const expected = aggregate === "buy_request"
        ? "BUY_REQUEST_VERIFICATION_MANUALLY_OVERRIDDEN"
        : "SELL_SUBMISSION_VERIFICATION_MANUALLY_OVERRIDDEN";
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, expected);
      assert.equal(audit[0].actorId, admin.id);
      assert.equal(audit[0].sanitizedMetadata.verificationOverride, true);
      assert.equal(audit[0].sanitizedMetadata.contactVerificationUnchanged, true);
      assert.equal(audit[0].sanitizedMetadata.transition, "manual_verification");

      // The detail page still reports contact verification separately.
      const detail = aggregate === "buy_request"
        ? await reads.getBuyRequestAdminDetail(db, record.id)
        : await reads.getSellSubmissionAdminDetail(db, record.id);
      assert.equal(detail.contact.verificationState, "PENDING");
      assert.equal(detail.contact.verifiedAt, null);
    }
  });
});

test("a status change never rewrites an intake field", async () => {
  await withDatabase(async ({ db, schema, writes, roleCan }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const record = await insertBuyRequest(db, schema, contact.id);
    const before = await rowOf(db, schema, "buy_request", record.id);

    await writes.changeMarketplaceStatus(db, {
      aggregate: "buy_request", id: record.id,
      expectedStatus: "pending_verification", to: "verified",
      actor: ADMIN_ACTOR(admin), roleCan,
    });
    const after = await rowOf(db, schema, "buy_request", record.id);

    for (const column of [
      "publicReference", "contactId", "originalPartNumber", "normalizedPartNumber",
      "description", "quantity", "notes", "sourcePage", "idempotencyHash",
      "submittedAt", "createdAt", "acceptableCondition", "urgency", "fulfillmentPreference",
    ]) {
      assert.deepEqual(after[column], before[column], `${column} must not change`);
    }
    // Only status, verified_at and updated_at moved.
    assert.equal(after.status, "verified");
    assert.notEqual(after.verifiedAt, null);
    assert.equal(after.closedAt, null, "verified is not a closure");
  });
});

/* -------------------------------------------------------------- assignment */

test("assignment accepts an active staff member, unassign, and refuses the rest", async () => {
  await withDatabase(async ({ db, schema, writes }) => {
    const admin = await insertAdmin(db, schema);
    const active = await insertAdmin(db, schema, { role: "ANALYST" });
    const inactive = await insertAdmin(db, schema, { role: "ANALYST", active: false });
    const contact = await insertContact(db, schema);

    for (const aggregate of ["buy_request", "sell_submission"]) {
      const record = aggregate === "buy_request"
        ? await insertBuyRequest(db, schema, contact.id)
        : await insertSellSubmission(db, schema, contact.id);

      const assigned = await writes.assignMarketplaceRecord(db, {
        aggregate, id: record.id, assigneeId: active.id, actor: ADMIN_ACTOR(admin),
      });
      assert.equal(assigned.ok, true);
      assert.equal(assigned.data.previousAssigneeId, null);
      assert.equal((await rowOf(db, schema, aggregate, record.id)).assignedAdminUserId, active.id);

      // An inactive staff member is refused, and the current owner is kept.
      const refused = await writes.assignMarketplaceRecord(db, {
        aggregate, id: record.id, assigneeId: inactive.id, actor: ADMIN_ACTOR(admin),
      });
      assert.deepEqual(refused, { ok: false, reason: "assignee_unavailable" });
      assert.equal((await rowOf(db, schema, aggregate, record.id)).assignedAdminUserId, active.id);

      // An unknown staff id is refused the same way.
      assert.deepEqual(await writes.assignMarketplaceRecord(db, {
        aggregate, id: record.id, assigneeId: ulid("AD"), actor: ADMIN_ACTOR(admin),
      }), { ok: false, reason: "assignee_unavailable" });

      // Unassigning is allowed and audited.
      const cleared = await writes.assignMarketplaceRecord(db, {
        aggregate, id: record.id, assigneeId: null, actor: ADMIN_ACTOR(admin),
      });
      assert.equal(cleared.ok, true);
      assert.equal(cleared.data.previousAssigneeId, active.id);
      assert.equal((await rowOf(db, schema, aggregate, record.id)).assignedAdminUserId, null);

      const audit = await auditFor(db, schema, record.id);
      const expected = aggregate === "buy_request" ? "BUY_REQUEST_ASSIGNED" : "SELL_SUBMISSION_ASSIGNED";
      assert.equal(audit.length, 2, "the two successful assignments, and only those");
      assert.ok(audit.every((row) => row.action === expected));
      assert.deepEqual(audit[1].sanitizedMetadata, { previousAssigneeId: active.id, assigneeId: null });
    }

    // A missing record is not found, not a silent no-op.
    assert.deepEqual(await writes.assignMarketplaceRecord(db, {
      aggregate: "buy_request", id: ulid("BR"), assigneeId: active.id, actor: ADMIN_ACTOR(admin),
    }), { ok: false, reason: "not_found" });
  });
});

/* -------------------------------------------------------------------- notes */

test("a note appends to the right aggregate, with the right author and audit", async () => {
  await withDatabase(async ({ db, schema, writes, reads }) => {
    const admin = await insertAdmin(db, schema, { displayEmail: "david@cvlon.com" });
    const contact = await insertContact(db, schema);
    const buy = await insertBuyRequest(db, schema, contact.id);
    const sell = await insertSellSubmission(db, schema, contact.id);

    const first = await writes.addMarketplaceNote(db, {
      aggregate: "buy_request", id: buy.id, body: "Sourcing started", actor: ADMIN_ACTOR(admin),
    });
    assert.equal(first.ok, true);
    const second = await writes.addMarketplaceNote(db, {
      aggregate: "sell_submission", id: sell.id, body: "Awaiting evidence", actor: ADMIN_ACTOR(admin),
    });
    assert.equal(second.ok, true);

    const buyNotes = await notesFor(db, schema, buy.id);
    assert.equal(buyNotes.length, 1);
    assert.equal(buyNotes[0].body, "Sourcing started");
    assert.equal(buyNotes[0].aggregateType, "buy_request");
    assert.equal(buyNotes[0].buyRequestId, buy.id);
    assert.equal(buyNotes[0].sellSubmissionId, null);
    assert.equal(buyNotes[0].adminUserId, admin.id);
    assert.equal(buyNotes[0].redactedAt, null, "no redaction is written in this slice");

    const sellNotes = await notesFor(db, schema, sell.id);
    assert.equal(sellNotes[0].sellSubmissionId, sell.id);
    assert.equal(sellNotes[0].buyRequestId, null);

    // A note on one aggregate never appears on the other.
    const buyDetail = await reads.getBuyRequestAdminDetail(db, buy.id);
    const sellDetail = await reads.getSellSubmissionAdminDetail(db, sell.id);
    assert.deepEqual(buyDetail.notes.map((n) => n.body), ["Sourcing started"]);
    assert.deepEqual(sellDetail.notes.map((n) => n.body), ["Awaiting evidence"]);
    assert.equal(buyDetail.notes[0].authorEmail, "david@cvlon.com");

    // The audit records the note's existence, never its text.
    const audit = await auditFor(db, schema, buy.id);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "BUY_REQUEST_NOTE_ADDED");
    assert.deepEqual(audit[0].sanitizedMetadata, { noteId: buyNotes[0].id, length: "Sourcing started".length });
    assert.equal(JSON.stringify(audit[0]).includes("Sourcing started"), false, "the note text must not enter the audit row");

    // A missing parent appends nothing.
    assert.deepEqual(await writes.addMarketplaceNote(db, {
      aggregate: "buy_request", id: ulid("BR"), body: "orphan", actor: ADMIN_ACTOR(admin),
    }), { ok: false, reason: "not_found" });
    assert.equal((await db.select().from(schema.marketplaceNotes)).length, 2);
  });
});

test("notes never reach the outbox, and no write enqueues a notification", async () => {
  await withDatabase(async ({ db, schema, writes, roleCan }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const buy = await insertBuyRequest(db, schema, contact.id);

    await writes.addMarketplaceNote(db, {
      aggregate: "buy_request", id: buy.id, body: "Internal only: supplier quoted low", actor: ADMIN_ACTOR(admin),
    });
    await writes.changeMarketplaceStatus(db, {
      aggregate: "buy_request", id: buy.id, expectedStatus: "pending_verification", to: "verified",
      actor: ADMIN_ACTOR(admin), roleCan,
    });
    await writes.assignMarketplaceRecord(db, {
      aggregate: "buy_request", id: buy.id, assigneeId: admin.id, actor: ADMIN_ACTOR(admin),
    });

    // Not one outbox row: staff actions notify nobody.
    const outbox = await db.select().from(schema.notificationOutbox);
    assert.equal(outbox.length, 0, "a staff action must not enqueue a customer notification");

    // The note text exists in exactly one table.
    const everything = JSON.stringify({
      outbox,
      audit: await auditFor(db, schema, buy.id),
      record: await rowOf(db, schema, "buy_request", buy.id),
    });
    assert.equal(everything.includes("supplier quoted low"), false, "the note text escaped its table");
    const notes = await notesFor(db, schema, buy.id);
    assert.equal(notes[0].body, "Internal only: supplier quoted low");
  });
});

/* ------------------------------------------------------------- atomicity */

test("a failed audit rolls the aggregate write back", async () => {
  await withDatabase(async ({ db, schema, writes, roleCan }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const record = await insertBuyRequest(db, schema, contact.id);

    // `audit_events.correlation_id` is NOT NULL, so a null forces the insert to
    // fail inside the same transaction as the status update.
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`alter table audit_events add constraint tmp_reject_writes check (action <> 'BUY_REQUEST_STATUS_CHANGED')`);

    let threw = false;
    try {
      await writes.changeMarketplaceStatus(db, {
        aggregate: "buy_request", id: record.id, expectedStatus: "pending_verification", to: "verified",
        actor: ADMIN_ACTOR(admin), roleCan,
      });
    } catch {
      threw = true;
    }
    // The manual override uses its own action, so pick an edge that uses the
    // generic one: verify first, then try verified -> sourcing under the block.
    await db.execute(sql`alter table audit_events drop constraint tmp_reject_writes`);
    assert.equal(threw, false, "the override action is not the blocked one");

    await writes.changeMarketplaceStatus(db, {
      aggregate: "buy_request", id: record.id, expectedStatus: "pending_verification", to: "verified",
      actor: ADMIN_ACTOR(admin), roleCan,
    });
    await db.execute(sql`alter table audit_events add constraint tmp_reject_writes check (action <> 'BUY_REQUEST_STATUS_CHANGED')`);

    let rolledBack = false;
    try {
      await writes.changeMarketplaceStatus(db, {
        aggregate: "buy_request", id: record.id, expectedStatus: "verified", to: "sourcing",
        actor: ADMIN_ACTOR(admin), roleCan,
      });
    } catch {
      rolledBack = true;
    }
    await db.execute(sql`alter table audit_events drop constraint tmp_reject_writes`);

    assert.equal(rolledBack, true, "the blocked audit insert must fail the call");
    const stored = await rowOf(db, schema, "buy_request", record.id);
    assert.equal(stored.status, "verified", "the aggregate must roll back with its audit row");
    const audit = await auditFor(db, schema, record.id);
    assert.equal(audit.length, 1, "only the successful override was recorded");
  });
});

test("a failed note insert leaves no audit row behind", async () => {
  await withDatabase(async ({ db, schema, writes }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const record = await insertBuyRequest(db, schema, contact.id);
    const { sql } = await import("drizzle-orm");

    await db.execute(sql`alter table marketplace_notes add constraint tmp_reject_notes check (body <> 'blocked note')`);
    let threw = false;
    try {
      await writes.addMarketplaceNote(db, {
        aggregate: "buy_request", id: record.id, body: "blocked note", actor: ADMIN_ACTOR(admin),
      });
    } catch {
      threw = true;
    }
    await db.execute(sql`alter table marketplace_notes drop constraint tmp_reject_notes`);

    assert.equal(threw, true);
    assert.equal((await notesFor(db, schema, record.id)).length, 0);
    assert.equal((await auditFor(db, schema, record.id)).length, 0, "no audit row without its note");
  });
});

test("a staff override is never reported as customer verification, in queue or detail", async () => {
  await withDatabase(async ({ db, schema, writes, reads, roleCan }) => {
    const { eq } = await import("drizzle-orm");
    const admin = await insertAdmin(db, schema, { role: "ADMIN" });
    // The customer never confirmed their address.
    const contact = await insertContact(db, schema, {
      verificationState: "PENDING",
      verificationRequestedAt: SUBMITTED_AT,
    });

    for (const aggregate of ["buy_request", "sell_submission"]) {
      const record = aggregate === "buy_request"
        ? await insertBuyRequest(db, schema, contact.id)
        : await insertSellSubmission(db, schema, contact.id);

      const overridden = await writes.changeMarketplaceStatus(db, {
        aggregate, id: record.id, expectedStatus: "pending_verification", to: "verified",
        actor: ADMIN_ACTOR(admin), roleCan,
      });
      assert.equal(overridden.ok, true, `${aggregate}: the override must succeed`);

      // 1. The contact record is untouched.
      const [storedContact] = await db.select().from(schema.marketplaceContacts)
        .where(eq(schema.marketplaceContacts.id, contact.id)).limit(1);
      assert.equal(storedContact.verificationState, "PENDING", aggregate);
      assert.equal(storedContact.verifiedAt, null, aggregate);

      // 2. The aggregate's technical gate timestamp IS populated, as the schema
      //    check constraint requires, and the status advanced.
      const stored = await rowOf(db, schema, aggregate, record.id);
      assert.equal(stored.status, "verified", aggregate);
      assert.notEqual(stored.verifiedAt, null, `${aggregate}: the schema constraint needs this stamp`);

      // 3. The unified queue reports pending, not verified.
      const queue = await reads.listUnifiedAdminQueue(db, { type: aggregate });
      const row = queue.find((entry) => entry.id === record.id);
      assert.ok(row, `${aggregate}: the record must still be listed`);
      assert.equal(row.verificationState, "pending", `${aggregate}: the queue must not report a staff override as verified`);

      // 4. The verification filters agree with that.
      const pending = await reads.listUnifiedAdminQueue(db, { type: aggregate, verification: "pending" });
      assert.ok(pending.some((entry) => entry.id === record.id), `${aggregate}: must appear under Awaiting verification`);
      const verified = await reads.listUnifiedAdminQueue(db, { type: aggregate, verification: "verified" });
      assert.equal(verified.some((entry) => entry.id === record.id), false, `${aggregate}: must not appear under Verified`);

      // 5. The detail projection that feeds AssignmentPanel agrees too.
      const detail = aggregate === "buy_request"
        ? await reads.getBuyRequestAdminDetail(db, record.id)
        : await reads.getSellSubmissionAdminDetail(db, record.id);
      const projected = aggregate === "buy_request" ? detail.buyRequest : detail.sellSubmission;
      assert.equal(projected.verificationState, "pending", `${aggregate}: detail must not report verified`);
      assert.equal(detail.contact.verificationState, "PENDING", aggregate);
      assert.equal(detail.contact.verifiedAt, null, aggregate);

      // 6. The override is distinctly audited.
      const audit = await auditFor(db, schema, record.id);
      const expected = aggregate === "buy_request"
        ? "BUY_REQUEST_VERIFICATION_MANUALLY_OVERRIDDEN"
        : "SELL_SUBMISSION_VERIFICATION_MANUALLY_OVERRIDDEN";
      assert.equal(audit.length, 1, aggregate);
      assert.equal(audit[0].action, expected, aggregate);
      assert.equal(audit[0].actorId, admin.id, aggregate);
    }
  });
});

test("a genuinely email-verified contact is reported as verified", async () => {
  await withDatabase(async ({ db, schema, reads }) => {
    // The customer did confirm: the intake path sets both sides.
    const contact = await insertContact(db, schema, {
      verificationState: "VERIFIED",
      verificationRequestedAt: SUBMITTED_AT,
      verifiedAt: VERIFIED_AT,
    });
    const buy = await insertBuyRequest(db, schema, contact.id, { status: "verified" });
    const sell = await insertSellSubmission(db, schema, contact.id, { status: "verified" });

    for (const [aggregate, record] of [["buy_request", buy], ["sell_submission", sell]]) {
      const queue = await reads.listUnifiedAdminQueue(db, { type: aggregate });
      assert.equal(queue.find((entry) => entry.id === record.id).verificationState, "verified", aggregate);

      const verified = await reads.listUnifiedAdminQueue(db, { type: aggregate, verification: "verified" });
      assert.ok(verified.some((entry) => entry.id === record.id), aggregate);
      const pending = await reads.listUnifiedAdminQueue(db, { type: aggregate, verification: "pending" });
      assert.equal(pending.some((entry) => entry.id === record.id), false, aggregate);

      const detail = aggregate === "buy_request"
        ? await reads.getBuyRequestAdminDetail(db, record.id)
        : await reads.getSellSubmissionAdminDetail(db, record.id);
      const projected = aggregate === "buy_request" ? detail.buyRequest : detail.sellSubmission;
      assert.equal(projected.verificationState, "verified", aggregate);
    }
  });
});

test("every non-VERIFIED contact state reads as pending", async () => {
  await withDatabase(async ({ db, schema, reads }) => {
    for (const state of ["UNVERIFIED", "PENDING", "EXPIRED"]) {
      const contact = await insertContact(db, schema, { verificationState: state });
      const record = await insertBuyRequest(db, schema, contact.id);
      const queue = await reads.listUnifiedAdminQueue(db, { type: "buy_request" });
      assert.equal(queue.find((entry) => entry.id === record.id).verificationState, "pending", state);
      const verified = await reads.listUnifiedAdminQueue(db, { type: "buy_request", verification: "verified" });
      assert.equal(verified.some((entry) => entry.id === record.id), false, state);
    }
  });
});
