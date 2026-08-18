import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

import { migrationsDirectory } from "./helpers/migration-archive.mjs";

/**
 * Real disposable Postgres, migrated from empty, plus a fake storage boundary.
 * No AWS credential, no network, no preview or production database.
 */
async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  try {
    await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const evidence = await import("../lib/marketplace/admin/evidence-download.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, evidence });
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
const CLEAN_TAG = "NO_THREATS_FOUND";

/** Records what the storage boundary was asked to do. Never touches AWS. */
function fakeStorage(options = {}) {
  // Explicit key check, not a default parameter: "the tag was removed" must be
  // expressible as `undefined` rather than silently becoming the clean value.
  const tag = "tag" in options ? options.tag : CLEAN_TAG;
  const { tagThrows = false, signThrows = false } = options;
  const readCalls = [];
  const signCalls = [];
  return {
    readCalls,
    signCalls,
    deps: {
      async readScanTag(objectKey) {
        readCalls.push(objectKey);
        if (tagThrows) throw new Error("MARKETPLACE_UPLOAD_STORAGE_UNCONFIGURED");
        return tag;
      },
      async signDownload(input) {
        signCalls.push(input);
        if (signThrows) throw new Error("SIGNING_FAILED");
        return `https://example-bucket.s3.amazonaws.com/${encodeURIComponent(input.objectKey)}?X-Amz-Signature=fake&X-Amz-Expires=${input.expiresIn}`;
      },
    },
  };
}

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

async function insertContact(db, schema) {
  const row = {
    id: ulid("CT"),
    firstName: "Dana",
    lastName: "Ruiz",
    companyName: "Example Aviation Group",
    businessEmail: "Dana.Ruiz@example.com",
    normalizedEmail: "dana.ruiz@example.com",
    actsAsSeller: true,
  };
  await db.insert(schema.marketplaceContacts).values(row);
  return row;
}

async function insertSellSubmission(db, schema, contactId) {
  const row = {
    id: ulid("SS"),
    publicReference: reference("SS"),
    contactId,
    submissionKind: "single_part",
    originalPartNumber: "SS-PART-7700",
    normalizedPartNumber: "SSPART7700",
    sourcePage: "/buy-sell-aircraft-parts/sell",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: SUBMITTED_AT,
  };
  await db.insert(schema.sellSubmissions).values(row);
  return row;
}

async function insertBuyRequest(db, schema, contactId) {
  const row = {
    id: ulid("BR"),
    publicReference: reference("BR"),
    contactId,
    originalPartNumber: "BR-PART-4100",
    normalizedPartNumber: "BRPART4100",
    quantity: "1",
    sourcePage: "/buy-sell-aircraft-parts/buy",
    idempotencyHash: `hash-${ulid("H")}`,
    submittedAt: SUBMITTED_AT,
  };
  await db.insert(schema.buyRequests).values(row);
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
    displayFilename: "warehouse evidence.pdf",
    objectKey: `marketplace/quarantine/sell_submission/${ulid("K")}`,
    storageProvider: "AWS_S3",
    declaredMime: "application/pdf",
    detectedMime: "application/pdf",
    byteSize: "20480",
    scanState: "CLEAN",
    retentionClass: "MARKETPLACE_INTAKE_EVIDENCE",
    ...overrides,
  };
  await db.insert(schema.marketplaceAttachments).values(row);
  return row;
}

async function auditRows(db, schema) {
  const { eq } = await import("drizzle-orm");
  return db.select().from(schema.auditEvents)
    .where(eq(schema.auditEvents.action, "SELL_SUBMISSION_EVIDENCE_VIEW_AUTHORIZED"));
}

/* ------------------------------------------------------------------------ */

test("a clean attachment under the correct parent is signed once and audited once", async () => {
  await withDatabase(async ({ db, schema, evidence }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const submission = await insertSellSubmission(db, schema, contact.id);
    const attachment = await insertAttachment(db, schema, submission.id);
    const storage = fakeStorage();

    const result = await evidence.authorizeSellEvidenceDownload(db, {
      sellSubmissionId: submission.id,
      attachmentId: attachment.id,
      actorId: admin.id,
    }, storage.deps);

    assert.equal(result.outcome, "ready");
    assert.ok(result.signedUrl.startsWith("https://"));

    // The live tag was re-read for exactly this object before signing.
    assert.deepEqual(storage.readCalls, [attachment.objectKey]);
    assert.equal(storage.signCalls.length, 1);
    assert.equal(storage.signCalls[0].objectKey, attachment.objectKey);
    assert.equal(storage.signCalls[0].expiresIn, 120);
    assert.ok(storage.signCalls[0].expiresIn <= 120);
    assert.equal(storage.signCalls[0].contentType, "application/pdf");
    assert.equal(storage.signCalls[0].contentDisposition, 'attachment; filename="warehouse evidence.pdf"');

    const audit = await auditRows(db, schema);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].aggregateType, "sell_submission");
    assert.equal(audit[0].aggregateId, submission.id);
    assert.equal(audit[0].actorType, "ADMIN");
    assert.equal(audit[0].actorId, admin.id);
    assert.deepEqual(audit[0].sanitizedMetadata, { attachmentId: attachment.id });

    // The audit row carries no filename, key, bucket, contact or URL.
    const auditText = JSON.stringify(audit[0]);
    for (const secret of [
      attachment.objectKey, "marketplace/quarantine", "warehouse evidence.pdf",
      "AWS_S3", "Dana.Ruiz@example.com", "amazonaws", "X-Amz-Signature", result.signedUrl,
    ]) {
      assert.equal(auditText.includes(secret), false, `audit leaked ${secret}`);
    }
  });
});

test("a wrong parent, another aggregate, or an unknown id yields nothing and no audit", async () => {
  await withDatabase(async ({ db, schema, evidence }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const first = await insertSellSubmission(db, schema, contact.id);
    const second = await insertSellSubmission(db, schema, contact.id);
    const buyRequest = await insertBuyRequest(db, schema, contact.id);
    const attachment = await insertAttachment(db, schema, first.id);
    const storage = fakeStorage();

    for (const [label, sellSubmissionId, attachmentId] of [
      ["another Sell Submission", second.id, attachment.id],
      ["a Buy Request id", buyRequest.id, attachment.id],
      ["an unknown parent", ulid("SS"), attachment.id],
      ["an unknown attachment", first.id, ulid("AT")],
      ["a swapped pair", attachment.id, first.id],
    ]) {
      const result = await evidence.authorizeSellEvidenceDownload(db, {
        sellSubmissionId, attachmentId, actorId: admin.id,
      }, storage.deps);
      assert.equal(result.outcome, "not_found", `${label} must not resolve`);
    }

    // Nothing was read from storage, nothing signed, nothing recorded.
    assert.deepEqual(storage.readCalls, []);
    assert.deepEqual(storage.signCalls, []);
    assert.equal((await auditRows(db, schema)).length, 0);

    // The correct pair still works, so the records themselves are intact.
    const ok = await evidence.authorizeSellEvidenceDownload(db, {
      sellSubmissionId: first.id, attachmentId: attachment.id, actorId: admin.id,
    }, storage.deps);
    assert.equal(ok.outcome, "ready");
  });
});

test("a deleted attachment is unavailable and never signed", async () => {
  await withDatabase(async ({ db, schema, evidence }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const submission = await insertSellSubmission(db, schema, contact.id);
    const attachment = await insertAttachment(db, schema, submission.id, {
      deletedAt: new Date("2026-08-17T13:00:00Z"),
    });
    const storage = fakeStorage();

    const result = await evidence.authorizeSellEvidenceDownload(db, {
      sellSubmissionId: submission.id, attachmentId: attachment.id, actorId: admin.id,
    }, storage.deps);

    assert.equal(result.outcome, "not_found");
    assert.deepEqual(storage.readCalls, []);
    assert.deepEqual(storage.signCalls, []);
    assert.equal((await auditRows(db, schema)).length, 0);
  });
});

test("a stored non-clean attachment is refused before storage is consulted", async () => {
  await withDatabase(async ({ db, schema, evidence }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const submission = await insertSellSubmission(db, schema, contact.id);
    const storage = fakeStorage();

    for (const scanState of ["PENDING", "QUARANTINED", "REJECTED", "FAILED"]) {
      const attachment = await insertAttachment(db, schema, submission.id, { scanState });
      const result = await evidence.authorizeSellEvidenceDownload(db, {
        sellSubmissionId: submission.id, attachmentId: attachment.id, actorId: admin.id,
      }, storage.deps);
      assert.equal(result.outcome, "not_clean", `stored ${scanState} must be refused`);
    }

    // The stored gate short-circuits: storage was never asked.
    assert.deepEqual(storage.readCalls, []);
    assert.deepEqual(storage.signCalls, []);
    assert.equal((await auditRows(db, schema)).length, 0);
  });
});

test("a stored-clean object whose live tag is not clean is refused without signing", async () => {
  await withDatabase(async ({ db, schema, evidence }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const submission = await insertSellSubmission(db, schema, contact.id);

    // Each case is a row that the database still believes is clean.
    for (const [label, tag] of [
      ["threats found since upload", "THREATS_FOUND"],
      ["scan still pending", "PENDING"],
      ["tag removed entirely", undefined],
      ["tag whitespace only", "   "],
      ["tag set to null", null],
      ["tag changed to an unrecognised value", "ACCESS_DENIED"],
      ["tag changed to empty", ""],
    ]) {
      const attachment = await insertAttachment(db, schema, submission.id);
      const storage = fakeStorage(tag === undefined ? { tag: undefined } : { tag });
      const result = await evidence.authorizeSellEvidenceDownload(db, {
        sellSubmissionId: submission.id, attachmentId: attachment.id, actorId: admin.id,
      }, storage.deps);

      assert.equal(result.outcome, "not_clean", `${label} must be refused`);
      // The tag was read, but nothing was signed.
      assert.deepEqual(storage.readCalls, [attachment.objectKey]);
      assert.deepEqual(storage.signCalls, [], `${label} must not be signed`);
    }

    assert.equal((await auditRows(db, schema)).length, 0);
  });
});

test("a storage or configuration failure is generic and records nothing", async () => {
  await withDatabase(async ({ db, schema, evidence }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const submission = await insertSellSubmission(db, schema, contact.id);
    const attachment = await insertAttachment(db, schema, submission.id);

    // The tag cannot be read at all.
    const tagOutage = fakeStorage({ tagThrows: true });
    const first = await evidence.authorizeSellEvidenceDownload(db, {
      sellSubmissionId: submission.id, attachmentId: attachment.id, actorId: admin.id,
    }, tagOutage.deps);
    assert.equal(first.outcome, "unavailable");
    assert.deepEqual(Object.keys(first), ["outcome"], "no diagnostic may ride along");
    assert.deepEqual(tagOutage.signCalls, []);

    // The tag reads clean but signing fails.
    const signOutage = fakeStorage({ signThrows: true });
    const second = await evidence.authorizeSellEvidenceDownload(db, {
      sellSubmissionId: submission.id, attachmentId: attachment.id, actorId: admin.id,
    }, signOutage.deps);
    assert.equal(second.outcome, "unavailable");
    assert.deepEqual(Object.keys(second), ["outcome"]);
    assert.equal(signOutage.signCalls.length, 1, "signing was attempted");

    assert.equal((await auditRows(db, schema)).length, 0, "a failed download records nothing");
  });
});

test("a hostile filename is sanitized before it reaches the signed request", async () => {
  await withDatabase(async ({ db, schema, evidence }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const submission = await insertSellSubmission(db, schema, contact.id);
    const CR = String.fromCharCode(13);
    const LF = String.fromCharCode(10);
    const attachment = await insertAttachment(db, schema, submission.id, {
      displayFilename: `..${String.fromCharCode(92)}..${String.fromCharCode(92)}evil";${CR}${LF}X-Injected: 1.pdf`,
      detectedMime: "text/html",
      declaredMime: "text/html",
    });
    const storage = fakeStorage();

    const result = await evidence.authorizeSellEvidenceDownload(db, {
      sellSubmissionId: submission.id, attachmentId: attachment.id, actorId: admin.id,
    }, storage.deps);
    assert.equal(result.outcome, "ready");

    const signed = storage.signCalls[0];
    assert.match(signed.contentDisposition, /^attachment; filename="[A-Za-z0-9._ -]+"$/);
    assert.equal([...signed.contentDisposition].some(ch => ch.charCodeAt(0) < 32), false);
    assert.doesNotMatch(signed.contentDisposition, /\.\./);
    // A type the intake surface does not accept is not echoed back.
    assert.equal(signed.contentType, "application/octet-stream");
  });
});

test("repeated authorized downloads each record their own audit row", async () => {
  await withDatabase(async ({ db, schema, evidence }) => {
    const admin = await insertAdmin(db, schema);
    const contact = await insertContact(db, schema);
    const submission = await insertSellSubmission(db, schema, contact.id);
    const attachment = await insertAttachment(db, schema, submission.id);
    const storage = fakeStorage();

    for (let index = 0; index < 3; index += 1) {
      const result = await evidence.authorizeSellEvidenceDownload(db, {
        sellSubmissionId: submission.id, attachmentId: attachment.id, actorId: admin.id,
      }, storage.deps);
      assert.equal(result.outcome, "ready");
    }

    const audit = await auditRows(db, schema);
    assert.equal(audit.length, 3, "each authorized access is its own record");
    assert.equal(new Set(audit.map(row => row.correlationId)).size, 3, "correlation ids are distinct");
  });
});
