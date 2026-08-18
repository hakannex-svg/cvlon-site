import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";

import { NetlifyDB } from "@netlify/database-dev";

import { expectedMigrationCount, migrationsDirectory } from "./helpers/migration-archive.mjs";
import { jpegBytes, pdfBytes } from "./fixtures/marketplace-upload-bytes.mjs";

/**
 * Follow-up seller evidence, against real Postgres.
 *
 * Everything here is a stored fact. The archive is applied from empty, every
 * assertion reads the rows back, and nothing about the credential, the
 * transaction boundaries, or the refusals is inferred from source text — that
 * is what `sell-evidence-request.unit.test.mjs` is for.
 *
 * Storage is a fake, exactly as in `marketplace-sell-uploads.integration.test.mjs`:
 * no AWS credential, no network call and no real bucket. The rules under test
 * are database rules, and the storage answers they depend on are supplied
 * directly so each verdict can be exercised deterministically.
 */

const TOKEN_KEY = "civilon-marketplace-verify-token-key-for-tests";
const SESSION_KEY = "civilon-marketplace-upload-session-key-for-tests";
const APPROVED_ORIGIN = "https://deploy-preview-1--cvlon.netlify.app";
const BUCKET = "civilon-marketplace-test-bucket";

const NOW = new Date("2026-08-18T12:00:00Z");
const SUBMITTED_AT = new Date("2026-08-17T12:00:00Z");
const VERIFIED_AT = new Date("2026-08-17T12:30:00Z");
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  process.env.MARKETPLACE_VERIFY_TOKEN_KEY = TOKEN_KEY;
  process.env.MARKETPLACE_UPLOAD_SESSION_KEY = SESSION_KEY;
  process.env.URL = APPROVED_ORIGIN;
  delete process.env.DEPLOY_PRIME_URL;
  delete process.env.MARKETPLACE_EMAIL_FROM;
  try {
    const applied = await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const repository = await import("../db/price-check/repositories/sell-evidence-request-repository.ts");
    const reads = await import("../db/price-check/repositories/marketplace-admin-repository.ts");
    const writes = await import("../db/price-check/repositories/marketplace-write-repository.ts");
    const service = await import("../lib/marketplace/sell-evidence-service.ts");
    const requestService = await import("../lib/marketplace/sell-evidence-request-service.ts");
    const token = await import("../lib/marketplace/sell-evidence-token.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, applied, repository, reads, writes, service, requestService, token });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    delete process.env.MARKETPLACE_VERIFY_TOKEN_KEY;
    delete process.env.MARKETPLACE_UPLOAD_SESSION_KEY;
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
    submissionKind: "single_part",
    originalPartNumber: "SS-PART-7700",
    normalizedPartNumber: "SSPART7700",
    description: "Surplus avionics tray",
    quantity: "1",
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

/** A verified seller with one live Sell Submission, and the staff member asking. */
async function seed(db, schema, { contact = {}, submission = {} } = {}) {
  const admin = await insertAdmin(db, schema);
  const contactRow = await insertContact(db, schema, contact);
  const submissionRow = await insertSellSubmission(db, schema, contactRow.id, submission);
  return { admin, contact: contactRow, submission: submissionRow };
}

/* --------------------------------------------------------------- fake S3 */

function fakeStorage(objects = new Map()) {
  const client = {
    async send(command) {
      const name = command.constructor.name;
      const object = objects.get(command.input.Key);
      if (!object) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      if (name === "GetObjectTaggingCommand") {
        return { TagSet: [{ Key: "GuardDutyMalwareScanStatus", Value: "NO_THREATS_FOUND" }] };
      }
      if (name === "HeadObjectCommand") {
        return { ContentLength: object.body.length, ContentType: object.contentType };
      }
      if (name === "GetObjectCommand") {
        const range = command.input.Range ?? "";
        const suffix = /^bytes=-(\d+)$/.exec(range);
        const window = /^bytes=(\d+)-(\d+)$/.exec(range);
        const bytes = suffix
          ? object.body.subarray(object.body.length - Number(suffix[1]))
          : window
            ? object.body.subarray(Number(window[1]), Number(window[2]) + 1)
            : object.body;
        return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
      }
      throw new Error(`unexpected command ${name}`);
    },
  };
  return { objects, storage: () => ({ client, bucket: BUCKET }) };
}

/* --------------------------------------------------------------- uploads */

async function newUploadSessionToken() {
  const { newMarketplaceUploadSessionToken } = await import("../lib/marketplace/uploads/session.ts");
  return newMarketplaceUploadSessionToken();
}

/**
 * Authorizes one pending upload through the real repository, then registers a
 * matching stored object in the fake bucket. Returns the handle and the row.
 */
async function authorizeUpload(db, objects, sessionToken, declaration, overrides = {}) {
  const [uploadRepository, session, fileValidation] = await Promise.all([
    import("../db/price-check/repositories/marketplace-upload-repository.ts"),
    import("../lib/marketplace/uploads/session.ts"),
    import("../lib/marketplace/uploads/file-validation.ts"),
  ]);
  const { body, ...declaredFields } = declaration;
  const validated = fileValidation.validateMarketplaceUploadDeclaration(declaredFields);
  const tokenHash = session.hashMarketplaceUploadSessionToken(SESSION_KEY, sessionToken);
  const active = await uploadRepository.findActiveMarketplaceUploadSession(db, tokenHash, "sell_submission");
  const objectKey = `marketplace/quarantine/sell_submission/${randomBytes(32).toString("base64url")}`;
  const authorized = await uploadRepository.authorizeMarketplacePendingUpload(db, {
    session: active ? { id: active.id, tokenHash: active.tokenHash } : null,
    tokenHash,
    intendedAggregateType: "sell_submission",
    filename: validated.filename,
    mime: validated.mime,
    size: validated.size,
    purpose: validated.purpose,
    objectKey,
    ...overrides,
  });
  objects.set(objectKey, { body, contentType: validated.mime });
  return { handle: authorized.handle, objectKey };
}

const JPEG = jpegBytes();
const PDF = pdfBytes();

function photoDeclaration(name = "part.jpg") {
  return { filename: name, mime: "image/jpeg", size: JPEG.length, purpose: "CUSTODY_PART_PHOTO", body: JPEG };
}

function documentDeclaration(name = "release.pdf") {
  return { filename: name, mime: "application/pdf", size: PDF.length, purpose: "RELEASE_SUPPORTING_DOCUMENT", body: PDF };
}

/** Runs the real submit service with the real binding module and a fake bucket. */
async function submitEvidence(db, service, { token, handles, sessionToken, storage, now = NOW }) {
  const [binding, session, uploadRepository, repository] = await Promise.all([
    import("../lib/marketplace/uploads/binding.ts"),
    import("../lib/marketplace/uploads/session.ts"),
    import("../db/price-check/repositories/marketplace-upload-repository.ts"),
    import("../db/price-check/repositories/sell-evidence-request-repository.ts"),
  ]);
  return service.submitSellEvidence(
    db,
    { token, tokenKey: TOKEN_KEY, handles, uploadSessionToken: sessionToken, now },
    {
      findLive: repository.findLiveSellEvidenceRequest,
      redeem: repository.redeemSellEvidenceRequest,
      prepareAttachments: (database, input) => binding.prepareMarketplaceAttachments(
        database,
        {
          handles: input.handles,
          uploadSessionToken: input.uploadSessionToken,
          tokenHash: input.uploadSessionToken
            ? session.hashMarketplaceUploadSessionToken(SESSION_KEY, input.uploadSessionToken)
            : null,
          intendedAggregateType: "sell_submission",
        },
        { findClaimable: uploadRepository.findClaimableMarketplaceUploads, storage },
      ),
    },
  );
}

/** Re-derives the plaintext credential the seller would receive by e-mail. */
async function credentialFor(db, schema, token, evidenceRequestId) {
  const [row] = await db.select({ nonce: schema.marketplaceEvidenceRequests.tokenDerivationNonce })
    .from(schema.marketplaceEvidenceRequests)
    .where(eqId(schema.marketplaceEvidenceRequests.id, evidenceRequestId));
  return token.deriveSellEvidenceToken(TOKEN_KEY, row.nonce);
}

function eqId(column, value) {
  // `eq` is imported lazily so this file needs no static drizzle import.
  return sqlEq(column, value);
}

let sqlEq;
test.before(async () => {
  ({ eq: sqlEq } = await import("drizzle-orm"));
});

/* =========================================================== the migration */

test("the archive applies from empty and creates the evidence-request table", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    assert.equal(applied.length, expectedMigrationCount());
    assert.equal((await db.select().from(schema.marketplaceEvidenceRequests)).length, 0);

    // The check constraint refuses a category the domain does not name, and an
    // empty list, at the database itself.
    const contactRow = await insertContact(db, schema);
    const submission = await insertSellSubmission(db, schema, contactRow.id);
    const base = {
      id: ulid("ER"),
      sellSubmissionId: submission.id,
      contactId: contactRow.id,
      keyedTokenHash: randomBytes(32).toString("hex"),
      tokenDerivationNonce: randomBytes(32).toString("hex"),
      issuedAt: NOW,
      expiresAt: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
    };
    for (const [label, categories] of [
      ["OTHER is not requestable", ["OTHER"]],
      ["an empty request is not a request", []],
      ["an invented category", ["SOMETHING_ELSE"]],
    ]) {
      await assert.rejects(
        db.insert(schema.marketplaceEvidenceRequests).values({ ...base, id: ulid("ER"), requestedCategories: categories }),
        label,
      );
    }
    // …and accepts the exact allowlist.
    await db.insert(schema.marketplaceEvidenceRequests).values({
      ...base,
      requestedCategories: ["CUSTODY_PART_PHOTO", "RELEASE_SUPPORTING_DOCUMENT"],
    });
    assert.equal((await db.select().from(schema.marketplaceEvidenceRequests)).length, 1);
  });
});

/* ================================================================== issue */

test("issuing writes one request, one audit and one queued email in one transaction", async () => {
  await withDatabase(async ({ db, schema, requestService }) => {
    const { admin, contact, submission } = await seed(db, schema);

    const result = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      // Duplicated and out of canonical order on purpose: the boundary
      // normalises rather than storing what the caller happened to send.
      categories: ["INVENTORY_SPREADSHEET", "CUSTODY_PART_PHOTO", "CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.categories, ["CUSTODY_PART_PHOTO", "INVENTORY_SPREADSHEET"]);
    assert.equal(result.data.supersededRequestId, null);
    assert.equal(result.data.expiresAt.valueOf(), NOW.valueOf() + FOURTEEN_DAYS_MS);

    const requests = await db.select().from(schema.marketplaceEvidenceRequests);
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request.id, result.data.requestId);
    assert.equal(request.sellSubmissionId, submission.id);
    assert.equal(request.contactId, contact.id);
    assert.equal(request.requestedByAdminUserId, admin.id);
    assert.deepEqual(request.requestedCategories, ["CUSTODY_PART_PHOTO", "INVENTORY_SPREADSHEET"]);
    assert.equal(request.consumedAt, null);
    assert.equal(request.revokedAt, null);
    assert.equal(request.attemptCount, 0);
    assert.equal(request.submittedAttachmentCount, 0);
    assert.equal(request.expiresAt.valueOf() - request.issuedAt.valueOf(), FOURTEEN_DAYS_MS);

    // Exactly one audit event, naming the request and nothing about the offer.
    const audits = await db.select().from(schema.auditEvents);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "SELL_SUBMISSION_EVIDENCE_REQUESTED");
    assert.equal(audits[0].aggregateType, "sell_submission");
    assert.equal(audits[0].aggregateId, submission.id);
    assert.equal(audits[0].actorType, "ADMIN");
    assert.equal(audits[0].actorId, admin.id);
    assert.deepEqual(Object.keys(audits[0].sanitizedMetadata).sort(), ["categories", "evidenceRequestId", "expiresAt"]);

    // Exactly one queued message, keyed to the request rather than the record.
    const outbox = await db.select().from(schema.notificationOutbox);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].messageType, "SELL_SUBMISSION_EVIDENCE_REQUEST");
    assert.equal(outbox[0].aggregateType, "sell_evidence_request");
    assert.equal(outbox[0].aggregateId, request.id);
    assert.equal(outbox[0].recipientReference, contact.id);
    assert.equal(outbox[0].state, "pending");
    assert.equal(outbox[0].sentAt, null);
    assert.equal(outbox[0].idempotencyKey, `sell-evidence-request:${request.id}:v1`);
  });
});

test("no plaintext credential, URL or address is stored anywhere", async () => {
  await withDatabase(async ({ db, schema, requestService, token }) => {
    const { admin, contact, submission } = await seed(db, schema);
    const result = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });

    const [request] = await db.select().from(schema.marketplaceEvidenceRequests);
    const plaintext = token.deriveSellEvidenceToken(TOKEN_KEY, request.tokenDerivationNonce);
    const stored = JSON.stringify([
      request,
      await db.select().from(schema.auditEvents),
      await db.select().from(schema.notificationOutbox),
    ]);

    // The token itself, the URL that carries it, and the seller's address are
    // all absent from every row this workflow writes.
    assert.equal(stored.includes(plaintext), false, "the plaintext credential must never be stored");
    assert.equal(stored.includes("/sell/evidence#"), false, "no secure URL is stored");
    assert.equal(stored.includes(contact.businessEmail), false, "no recipient address is stored");
    // What is stored is the keyed lookup hash, which needs the server key to
    // reproduce and is not the credential.
    assert.equal(request.keyedTokenHash, token.hashSellEvidenceToken(TOKEN_KEY, plaintext));
    assert.notEqual(request.keyedTokenHash, plaintext);
    assert.match(request.keyedTokenHash, /^[a-f0-9]{64}$/);
    assert.equal(result.data.requestId, request.id);
    // Nothing in the service's own return value carries a credential either.
    assert.equal(JSON.stringify(result).includes(plaintext), false);
  });
});

test("reissuing revokes the earlier credential and terminalises its queued email", async () => {
  await withDatabase(async ({ db, schema, requestService, service, token }) => {
    const { admin, submission } = await seed(db, schema);
    const first = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    const firstToken = await credentialFor(db, schema, token, first.data.requestId);
    // The first link works before the reissue.
    assert.ok(await service.viewSellEvidenceRequest(db, { token: firstToken, tokenKey: TOKEN_KEY, now: NOW }));

    const later = new Date(NOW.valueOf() + 60_000);
    const second = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["RELEASE_SUPPORTING_DOCUMENT"],
      actor: { id: admin.id },
      now: later,
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.supersededRequestId, first.data.requestId);

    const rows = Object.fromEntries(
      (await db.select().from(schema.marketplaceEvidenceRequests)).map((row) => [row.id, row]),
    );
    assert.equal(rows[first.data.requestId].revokedAt.valueOf(), later.valueOf());
    assert.equal(rows[second.data.requestId].revokedAt, null);
    // The partial unique index means exactly one live request per submission.
    assert.equal(Object.values(rows).filter((row) => !row.revokedAt && !row.consumedAt).length, 1);

    // The revoked credential is dead for both public endpoints.
    assert.equal(await service.viewSellEvidenceRequest(db, { token: firstToken, tokenKey: TOKEN_KEY, now: later }), null);
    const secondToken = await credentialFor(db, schema, token, second.data.requestId);
    assert.ok(await service.viewSellEvidenceRequest(db, { token: secondToken, tokenKey: TOKEN_KEY, now: later }));

    // The superseded request's queued e-mail is terminalised in the same
    // transaction, so a dispatcher never leases it, refuses it, and retries.
    const outbox = Object.fromEntries(
      (await db.select().from(schema.notificationOutbox)).map((row) => [row.aggregateId, row]),
    );
    assert.equal(outbox[first.data.requestId].state, "dead_letter");
    assert.equal(outbox[first.data.requestId].sanitizedFailureCode, "SELL_EVIDENCE_REQUEST_SUPERSEDED");
    assert.equal(outbox[first.data.requestId].sentAt, null);
    assert.equal(outbox[first.data.requestId].attemptCount, 0);
    // The new request's message is untouched and still queued.
    assert.equal(outbox[second.data.requestId].state, "pending");

    // Both the revocation and the new request are audited.
    const actions = (await db.select().from(schema.auditEvents)).map((row) => row.action);
    assert.deepEqual(actions.filter((action) => action.includes("EVIDENCE_REQUEST_REVOKED")).length, 1);
    assert.equal(actions.filter((action) => action === "SELL_SUBMISSION_EVIDENCE_REQUESTED").length, 2);
  });
});

test("a request Civilon cannot honour is refused and writes nothing", async () => {
  await withDatabase(async ({ db, schema, repository, requestService }) => {
    const admin = await insertAdmin(db, schema);

    // A record Civilon has closed.
    const closed = await seed(db, schema, { submission: { status: "closed", verifiedAt: null, verificationRequestedAt: null } });
    const terminal = await requestService.requestSellEvidence(db, {
      sellSubmissionId: closed.submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    assert.deepEqual(terminal, { ok: false, reason: "terminal_record", currentStatus: "closed" });

    // A seller who never confirmed their address.
    const unverified = await seed(db, schema, { contact: { verificationState: "UNVERIFIED" } });
    assert.deepEqual(
      await requestService.requestSellEvidence(db, {
        sellSubmissionId: unverified.submission.id,
        categories: ["CUSTODY_PART_PHOTO"],
        actor: { id: admin.id },
        now: NOW,
      }),
      { ok: false, reason: "contact_unverified" },
    );

    // A contact that has since been erased.
    const deleted = await seed(db, schema, { contact: { deletedAt: SUBMITTED_AT } });
    assert.deepEqual(
      await requestService.requestSellEvidence(db, {
        sellSubmissionId: deleted.submission.id,
        categories: ["CUSTODY_PART_PHOTO"],
        actor: { id: admin.id },
        now: NOW,
      }),
      { ok: false, reason: "contact_unverified" },
    );

    // A record that does not exist.
    assert.deepEqual(
      await requestService.requestSellEvidence(db, {
        sellSubmissionId: ulid("SS"),
        categories: ["CUSTODY_PART_PHOTO"],
        actor: { id: admin.id },
        now: NOW,
      }),
      { ok: false, reason: "not_found" },
    );

    // An invalid or empty category set never reaches the database at all.
    const live = await seed(db, schema);
    for (const categories of [[], ["OTHER"], ["INVENTED"], ["CUSTODY_PART_PHOTO", "OTHER"]]) {
      await assert.rejects(
        repository.issueSellEvidenceRequest(db, {
          sellSubmissionId: live.submission.id,
          categories,
          keyedTokenHash: randomBytes(32).toString("hex"),
          tokenDerivationNonce: randomBytes(32).toString("hex"),
          expiresAt: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
          actor: { id: admin.id },
          now: NOW,
        }),
        /SELL_EVIDENCE_CATEGORIES_INVALID/,
        JSON.stringify(categories),
      );
    }

    // Nothing was written by any refusal.
    assert.equal((await db.select().from(schema.marketplaceEvidenceRequests)).length, 0);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 0);
    assert.equal((await db.select().from(schema.auditEvents)).length, 0);
  });
});

/* ================================================================ delivery */

test("the handler refuses to load a request that is no longer live", async () => {
  await withDatabase(async ({ db, schema, repository, requestService, token }) => {
    const { admin, contact, submission } = await seed(db, schema);
    const issued = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });

    // While live, the send path is handed exactly what the template needs.
    const delivery = await repository.loadSellEvidenceRequestDelivery(db, issued.data.requestId, NOW);
    assert.deepEqual(Object.keys(delivery).sort(), [
      "businessEmail", "consumedAt", "evidenceRequestId", "expiresAt",
      "publicReference", "requestedCategories", "revokedAt", "sellSubmissionId", "tokenDerivationNonce",
    ]);
    assert.equal(delivery.businessEmail, contact.businessEmail);
    assert.equal(delivery.publicReference, submission.publicReference);
    // Nothing about the offer is selectable from here.
    assert.equal(JSON.stringify(delivery).includes(submission.originalPartNumber), false);
    assert.equal(JSON.stringify(delivery).includes(submission.description), false);
    // The credential is re-derived from the nonce, never read from a column.
    assert.match(token.deriveSellEvidenceToken(TOKEN_KEY, delivery.tokenDerivationNonce), /^[A-Za-z0-9_-]{43}$/);

    // Past its expiry, the message refuses to load rather than mailing a dead link.
    await assert.rejects(
      repository.loadSellEvidenceRequestDelivery(db, issued.data.requestId, new Date(NOW.valueOf() + FOURTEEN_DAYS_MS + 1)),
      /SELL_EVIDENCE_REQUEST_UNAVAILABLE/,
    );

    // …and once superseded, so does the older one.
    await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["RELEASE_SUPPORTING_DOCUMENT"],
      actor: { id: admin.id },
      now: new Date(NOW.valueOf() + 60_000),
    });
    await assert.rejects(
      repository.loadSellEvidenceRequestDelivery(db, issued.data.requestId, NOW),
      /SELL_EVIDENCE_REQUEST_UNAVAILABLE/,
    );
    // A request that does not exist is the same refusal, so a caller learns
    // nothing from which error it got.
    await assert.rejects(
      repository.loadSellEvidenceRequestDelivery(db, ulid("ER"), NOW),
      /SELL_EVIDENCE_REQUEST_UNAVAILABLE/,
    );
    assert.equal((await db.select().from(schema.marketplaceEvidenceRequests)).length, 2);
  });
});

/* ==================================================================== view */

test("viewing is non-consuming and reveals only reference, categories and expiry", async () => {
  await withDatabase(async ({ db, schema, requestService, service, token }) => {
    const { admin, submission, contact } = await seed(db, schema);
    const issued = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO", "RELEASE_SUPPORTING_DOCUMENT"],
      actor: { id: admin.id },
      now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.requestId);

    // Opened five times — a mail scanner, a link previewer, a prefetcher and the
    // seller twice — and still live.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const snapshot = await service.viewSellEvidenceRequest(db, { token: credential, tokenKey: TOKEN_KEY, now: NOW });
      assert.equal(snapshot.publicReference, submission.publicReference);
      assert.deepEqual(snapshot.categories, ["CUSTODY_PART_PHOTO", "RELEASE_SUPPORTING_DOCUMENT"]);
      assert.equal(snapshot.expiresAt.valueOf(), NOW.valueOf() + FOURTEEN_DAYS_MS);
      // The offer, the contact and the seller's address are not in the snapshot.
      const rendered = JSON.stringify(snapshot);
      assert.equal(rendered.includes(contact.businessEmail), false);
      assert.equal(rendered.includes(submission.originalPartNumber), false);
      assert.equal(rendered.includes(contact.id), false);
    }

    const [request] = await db.select().from(schema.marketplaceEvidenceRequests);
    assert.equal(request.consumedAt, null);
    assert.equal(request.attemptCount, 0);
    assert.equal(request.submittedAttachmentCount, 0);
    // Reading spends nothing, so no attachment and no audit appears either.
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0);
    assert.equal((await db.select().from(schema.auditEvents)).length, 1);
  });
});

test("a forged, expired, revoked or consumed credential resolves to nothing", async () => {
  await withDatabase(async ({ db, schema, requestService, service, token }) => {
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.requestId);

    // Well-formed but never issued.
    const forged = token.deriveSellEvidenceToken(TOKEN_KEY, token.newSellEvidenceNonce());
    assert.equal(await service.viewSellEvidenceRequest(db, { token: forged, tokenKey: TOKEN_KEY, now: NOW }), null);
    // Malformed shapes never reach a query.
    for (const malformed of ["", "not-a-token", `${credential}A`, credential.slice(0, 42)]) {
      assert.equal(await service.viewSellEvidenceRequest(db, { token: malformed, tokenKey: TOKEN_KEY, now: NOW }), null, malformed);
    }
    // The right token under the wrong key is not this token.
    assert.equal(
      await service.viewSellEvidenceRequest(db, { token: credential, tokenKey: "a-different-key-of-sufficient-length!!", now: NOW }),
      null,
    );
    // Past its expiry.
    assert.equal(
      await service.viewSellEvidenceRequest(db, { token: credential, tokenKey: TOKEN_KEY, now: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS) }),
      null,
    );
    // On a record Civilon has since closed.
    await db.update(schema.sellSubmissions)
      .set({ status: "closed" })
      .where(sqlEq(schema.sellSubmissions.id, submission.id));
    assert.equal(await service.viewSellEvidenceRequest(db, { token: credential, tokenKey: TOKEN_KEY, now: NOW }), null);
  });
});

/* ================================================================== bind */

test("valid evidence binds privately to the original submission and consumes the credential", async () => {
  await withDatabase(async ({ db, schema, requestService, service, reads, token }) => {
    const { admin, contact, submission } = await seed(db, schema);
    const issued = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO", "RELEASE_SUPPORTING_DOCUMENT"],
      actor: { id: admin.id },
      now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.requestId);

    const { objects, storage } = fakeStorage();
    const sessionToken = await newUploadSessionToken();
    const photo = await authorizeUpload(db, objects, sessionToken, photoDeclaration());
    const document = await authorizeUpload(db, objects, sessionToken, documentDeclaration());

    const result = await submitEvidence(db, service, {
      token: credential,
      handles: [photo.handle, document.handle],
      sessionToken,
      storage,
    });
    assert.equal(result.outcome, "bound");
    assert.equal(result.reference, submission.publicReference);
    assert.equal(result.attachmentIds.length, 2);

    const attachments = await db.select().from(schema.marketplaceAttachments);
    assert.equal(attachments.length, 2);
    for (const attachment of attachments) {
      assert.equal(attachment.sellSubmissionId, submission.id);
      assert.equal(attachment.aggregateType, "sell_submission");
      assert.equal(attachment.aggregateId, submission.id);
      assert.equal(attachment.buyRequestId, null);
      // The seller uploaded it, not a staff member.
      assert.equal(attachment.uploadedByType, "CONTACT");
      assert.equal(attachment.scanState, "CLEAN");
      // Clean means staff may review it, not that it leaves the private
      // namespace. Nothing here is ever public.
      assert.equal(attachment.quarantineReleasedAt, null);
      assert.equal(attachment.reviewState, "not_reviewed");
      assert.equal(attachment.reviewedAt, null);
      assert.equal(attachment.reviewedByAdminUserId, null);
      assert.equal(attachment.retentionClass, "MARKETPLACE_INTAKE_EVIDENCE");
      assert.ok(["CUSTODY_PART_PHOTO", "RELEASE_SUPPORTING_DOCUMENT"].includes(attachment.purpose));
    }

    // Both handles are spent and claimed by this submission only.
    const pending = await db.select().from(schema.marketplacePendingUploads);
    assert.equal(pending.length, 2);
    for (const row of pending) {
      assert.equal(row.state, "BOUND");
      assert.equal(row.claimedSellSubmissionId, submission.id);
      assert.equal(row.claimedBuyRequestId, null);
    }

    // The credential is spent exactly once, and records what arrived.
    const [request] = await db.select().from(schema.marketplaceEvidenceRequests);
    assert.equal(request.consumedAt.valueOf(), NOW.valueOf());
    assert.equal(request.attemptCount, 1);
    assert.equal(request.submittedAttachmentCount, 2);
    assert.equal(request.revokedAt, null);

    // One submission audit plus one per bound file, attributed to the seller.
    const audits = await db.select().from(schema.auditEvents);
    const bound = audits.filter((row) => row.action === "SELL_SUBMISSION_EVIDENCE_ATTACHMENT_BOUND");
    const submitted = audits.filter((row) => row.action === "SELL_SUBMISSION_EVIDENCE_SUBMITTED");
    assert.equal(submitted.length, 1);
    assert.equal(bound.length, 2);
    for (const row of [...bound, ...submitted]) {
      assert.equal(row.actorType, "REQUESTER");
      assert.equal(row.actorId, contact.id);
      assert.equal(row.correlationId, `sell-evidence-request:${request.id}`);
    }
    // Never the seller's filename, and never anything read from inside a file.
    assert.equal(JSON.stringify(audits).includes("part.jpg"), false);
    assert.equal(JSON.stringify(audits).includes("release.pdf"), false);

    // The staff detail sees the new evidence and the answered request.
    const detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(detail.attachments.length, 2);
    assert.equal(detail.evidenceRequest.submittedAttachmentCount, 2);
    assert.ok(detail.evidenceRequest.consumedAt);
  });
});

test("the existing per-file review control works on newly bound evidence", async () => {
  await withDatabase(async ({ db, schema, requestService, service, writes, reads, token }) => {
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.requestId);
    const { objects, storage } = fakeStorage();
    const sessionToken = await newUploadSessionToken();
    const photo = await authorizeUpload(db, objects, sessionToken, photoDeclaration());
    const bound = await submitEvidence(db, service, {
      token: credential, handles: [photo.handle], sessionToken, storage,
    });
    const [attachmentId] = bound.attachmentIds;

    // The same mutation the initial-intake evidence uses. No second review
    // mechanism exists for follow-up files.
    const reviewed = await writes.setAttachmentReview(db, {
      sellSubmissionId: submission.id,
      attachmentId,
      state: "reviewed",
      actor: { id: admin.id, role: "ADMIN" },
      now: NOW,
    });
    assert.equal(reviewed.ok, true);
    assert.deepEqual(reviewed.data, { from: "not_reviewed", to: "reviewed", changed: true });

    const concern = await writes.setAttachmentReview(db, {
      sellSubmissionId: submission.id,
      attachmentId,
      state: "concern",
      actor: { id: admin.id, role: "ADMIN" },
      now: NOW,
    });
    assert.equal(concern.ok, true);

    const [attachment] = await db.select().from(schema.marketplaceAttachments);
    assert.equal(attachment.reviewState, "concern");
    assert.equal(attachment.reviewedByAdminUserId, admin.id);
    // An internal working status only — it changes nothing about the file.
    assert.equal(attachment.scanState, "CLEAN");
    assert.equal(attachment.quarantineReleasedAt, null);

    const detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(detail.attachments[0].reviewState, "concern");

    // The review is refused for an attachment on a different submission.
    const other = await seed(db, schema);
    assert.deepEqual(
      await writes.setAttachmentReview(db, {
        sellSubmissionId: other.submission.id,
        attachmentId,
        state: "reviewed",
        actor: { id: admin.id, role: "ADMIN" },
        now: NOW,
      }),
      { ok: false, reason: "not_found" },
    );
  });
});

test("every invalid submission binds nothing at all", async () => {
  await withDatabase(async ({ db, schema, requestService, service, token }) => {
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.requestId);
    const { objects, storage } = fakeStorage();
    const sessionToken = await newUploadSessionToken();

    async function refused(label, input) {
      const before = await db.select().from(schema.marketplaceEvidenceRequests);
      let outcome;
      try {
        outcome = (await submitEvidence(db, service, { storage, sessionToken, token: credential, ...input })).outcome;
      } catch (error) {
        // A storage/scan code the public route translates for the seller. It is
        // still a refusal as far as the database is concerned.
        outcome = `threw:${error.message}`;
      }
      assert.notEqual(outcome, "bound", label);
      // Nothing partial: no attachment, no claim, and the credential unspent.
      assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0, `${label}: no attachment`);
      const claimed = (await db.select().from(schema.marketplacePendingUploads))
        .filter((row) => row.state === "BOUND" || row.claimedSellSubmissionId);
      assert.equal(claimed.length, 0, `${label}: no claim`);
      const [after] = await db.select().from(schema.marketplaceEvidenceRequests);
      assert.equal(after.consumedAt, null, `${label}: unconsumed`);
      assert.equal(after.attemptCount, before[0].attemptCount, `${label}: attempt count unchanged`);
      assert.equal(after.submittedAttachmentCount, 0, `${label}: nothing recorded`);
    }

    // A file filed under a purpose nobody asked for.
    const wrongPurpose = await authorizeUpload(db, objects, sessionToken, documentDeclaration());
    await refused("purpose outside the request", { handles: [wrongPurpose.handle] });

    // A batch where one handle is good and one is not: all or nothing.
    const good = await authorizeUpload(db, objects, sessionToken, photoDeclaration());
    await refused("mixed-validity batch", { handles: [good.handle, wrongPurpose.handle] });
    await refused("unknown handle in the batch", { handles: [good.handle, ulid("PU")] });
    await refused("a duplicated handle", { handles: [good.handle, good.handle] });

    // Someone else's upload session, and no session at all.
    const strangerSession = await newUploadSessionToken();
    await authorizeUpload(db, objects, strangerSession, photoDeclaration());
    await refused("cross-session handle", { handles: [good.handle], sessionToken: strangerSession });
    await refused("no session cookie", { handles: [good.handle], sessionToken: null });

    // A handle that lapsed while the seller was uploading.
    const stale = await authorizeUpload(db, objects, sessionToken, photoDeclaration());
    await db.update(schema.marketplacePendingUploads)
      .set({ expiresAt: new Date(NOW.valueOf() - 1) })
      .where(sqlEq(schema.marketplacePendingUploads.id, stale.handle));
    await refused("expired upload handle", { handles: [stale.handle] });

    // Forged and empty credentials.
    const forged = token.deriveSellEvidenceToken(TOKEN_KEY, token.newSellEvidenceNonce());
    await refused("forged credential", { handles: [good.handle], token: forged });
    await refused("no files", { handles: [] });

    // Past the expiry of an otherwise perfect submission.
    await refused("expired credential", {
      handles: [good.handle],
      now: new Date(NOW.valueOf() + FOURTEEN_DAYS_MS),
    });

    // Once revoked, the credential is dead even though every file is fine.
    await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: new Date(NOW.valueOf() + 1000),
    });
    const revoked = await submitEvidence(db, service, {
      token: credential, handles: [good.handle], sessionToken, storage,
    });
    assert.equal(revoked.outcome, "unavailable");
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0);
  });
});

test("a spent credential cannot be replayed and a spent handle cannot be rebound", async () => {
  await withDatabase(async ({ db, schema, requestService, service, token }) => {
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.requestId);
    const { objects, storage } = fakeStorage();
    const sessionToken = await newUploadSessionToken();
    const first = await authorizeUpload(db, objects, sessionToken, photoDeclaration());
    const second = await authorizeUpload(db, objects, sessionToken, photoDeclaration("other.jpg"));

    assert.equal(
      (await submitEvidence(db, service, { token: credential, handles: [first.handle], sessionToken, storage })).outcome,
      "bound",
    );

    // The same credential, a second time, with a perfectly good new file.
    assert.equal(
      (await submitEvidence(db, service, { token: credential, handles: [second.handle], sessionToken, storage })).outcome,
      "unavailable",
    );
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 1);
    const [request] = await db.select().from(schema.marketplaceEvidenceRequests);
    assert.equal(request.attemptCount, 1);
    assert.equal(request.submittedAttachmentCount, 1);

    // A fresh credential cannot rebind the already-bound handle either.
    const reissued = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: new Date(NOW.valueOf() + 1000),
    });
    const freshCredential = await credentialFor(db, schema, token, reissued.data.requestId);
    await assert.rejects(
      submitEvidence(db, service, {
        token: freshCredential, handles: [first.handle], sessionToken, storage,
        now: new Date(NOW.valueOf() + 1000),
      }),
      /MARKETPLACE_UPLOAD_HANDLES_UNAVAILABLE/,
    );
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 1);
  });
});

test("the claim predicate refuses a handle that changed between preparation and binding", async () => {
  await withDatabase(async ({ db, schema, repository, requestService, token }) => {
    const { admin, submission } = await seed(db, schema);
    const issued = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    const credential = await credentialFor(db, schema, token, issued.data.requestId);
    const keyedTokenHash = token.hashSellEvidenceToken(TOKEN_KEY, credential);

    const { objects } = fakeStorage();
    const sessionToken = await newUploadSessionToken();
    const upload = await authorizeUpload(db, objects, sessionToken, photoDeclaration());
    const [row] = await db.select().from(schema.marketplacePendingUploads)
      .where(sqlEq(schema.marketplacePendingUploads.id, upload.handle));

    /** The attachment the storage pass would have produced for that row. */
    const prepared = (overrides = {}) => ([{
      id: ulid("AT"),
      pendingUploadId: row.id,
      uploadSessionId: row.uploadSessionId,
      displayFilename: row.displayFilename,
      objectKey: row.objectKey,
      declaredMime: row.declaredMime,
      detectedMime: row.declaredMime,
      purpose: row.purpose,
      byteSize: Number(row.expectedByteSize),
      ...overrides,
    }]);

    // Each of these is the prepared row disagreeing with the stored row on a
    // field that is fixed at authorize time, so the claim must find nothing.
    for (const [label, overrides] of [
      ["a different object key", { objectKey: `${row.objectKey}-x` }],
      ["a different declared type", { declaredMime: "application/pdf" }],
      ["a different reserved size", { byteSize: Number(row.expectedByteSize) + 1 }],
      ["a different session", { uploadSessionId: ulid("US") }],
    ]) {
      await assert.rejects(
        repository.redeemSellEvidenceRequest(db, { keyedTokenHash, attachments: prepared(overrides), now: NOW }),
        /MARKETPLACE_UPLOAD_HANDLE_ALREADY_USED/,
        label,
      );
      const [after] = await db.select().from(schema.marketplaceEvidenceRequests);
      assert.equal(after.consumedAt, null, `${label}: the credential is not spent`);
      assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0, label);
    }

    // A handle that lapsed after it was prepared is refused at the claim, not
    // merely before the transaction opened.
    await assert.rejects(
      repository.redeemSellEvidenceRequest(db, {
        keyedTokenHash,
        attachments: prepared(),
        now: new Date(row.expiresAt.valueOf() + 1),
      }),
      /MARKETPLACE_UPLOAD_HANDLE_ALREADY_USED/,
    );
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0);

    // The unmodified prepared row still binds, so the predicate is not simply
    // refusing everything.
    const bound = await repository.redeemSellEvidenceRequest(db, {
      keyedTokenHash, attachments: prepared(), now: NOW,
    });
    assert.equal(bound.outcome, "bound");
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 1);
  });
});

/* ============================================================== projection */

test("the staff projection reports the real delivery state and no credential", async () => {
  await withDatabase(async ({ db, schema, requestService, reads, token }) => {
    const { admin, contact, submission } = await seed(db, schema);
    const issued = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    const [request] = await db.select().from(schema.marketplaceEvidenceRequests);
    const plaintext = token.deriveSellEvidenceToken(TOKEN_KEY, request.tokenDerivationNonce);

    const domain = await import("../db/price-check/domain/sell-evidence-request.ts");

    // Queued, because that is all the outbox says so far.
    let detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(detail.evidenceRequest.id, issued.data.requestId);
    assert.equal(detail.evidenceRequest.requestedByEmail, admin.displayEmail);
    assert.deepEqual(detail.evidenceRequest.categories, ["CUSTODY_PART_PHOTO"]);
    assert.equal(detail.evidenceRequest.deliveryState, "pending");
    assert.equal(detail.evidenceRequest.deliveredAt, null);
    assert.equal(domain.sellEvidenceDeliveryState(detail.evidenceRequest.deliveryState), "queued");

    // The projection carries no credential material, no secure URL, no
    // recipient address, and nothing else about the submission's contact.
    const projected = JSON.stringify(detail.evidenceRequest);
    for (const secret of [
      plaintext, request.keyedTokenHash, request.tokenDerivationNonce, contact.businessEmail, contact.id,
    ]) {
      assert.equal(projected.includes(secret), false, `projection must not carry ${secret.slice(0, 12)}…`);
    }
    assert.equal(projected.includes("/sell/evidence#"), false);
    assert.deepEqual(Object.keys(detail.evidenceRequest).sort(), [
      "categories", "consumedAt", "deliveredAt", "deliveryState", "expiresAt",
      "id", "issuedAt", "requestedByEmail", "revokedAt", "submittedAttachmentCount",
    ]);

    // Once the provider accepts the message, the same projection says so.
    const sentAt = new Date(NOW.valueOf() + 5000);
    await db.update(schema.notificationOutbox)
      .set({ state: "succeeded", sentAt, providerMessageId: "provider-message-1" })
      .where(sqlEq(schema.notificationOutbox.aggregateId, issued.data.requestId));
    detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(detail.evidenceRequest.deliveryState, "succeeded");
    assert.equal(detail.evidenceRequest.deliveredAt.valueOf(), sentAt.valueOf());
    assert.equal(domain.sellEvidenceDeliveryState(detail.evidenceRequest.deliveryState), "delivered");
    // The provider's own message id is not something a staff page needs.
    assert.equal(JSON.stringify(detail.evidenceRequest).includes("provider-message-1"), false);

    // A dead-lettered message reports as undeliverable rather than as sent.
    await db.update(schema.notificationOutbox)
      .set({ state: "dead_letter", sentAt: null, sanitizedFailureCode: "PROVIDER_REJECTED" })
      .where(sqlEq(schema.notificationOutbox.aggregateId, issued.data.requestId));
    detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(domain.sellEvidenceDeliveryState(detail.evidenceRequest.deliveryState), "undeliverable");

    // With no message row at all, the projection says nothing is known.
    await db.delete(schema.notificationOutbox);
    detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(detail.evidenceRequest.deliveryState, null);
    assert.equal(domain.sellEvidenceDeliveryState(detail.evidenceRequest.deliveryState), "unrecorded");
  });
});

test("the projection shows the latest request only, and null when none was ever made", async () => {
  await withDatabase(async ({ db, schema, requestService, reads }) => {
    const { admin, submission } = await seed(db, schema);
    let detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(detail.evidenceRequest, null);

    await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    const second = await requestService.requestSellEvidence(db, {
      sellSubmissionId: submission.id,
      categories: ["RELEASE_SUPPORTING_DOCUMENT", "WAREHOUSE_BUSINESS_EVIDENCE"],
      actor: { id: admin.id },
      now: new Date(NOW.valueOf() + 60_000),
    });

    detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(detail.evidenceRequest.id, second.data.requestId);
    assert.deepEqual(detail.evidenceRequest.categories, ["WAREHOUSE_BUSINESS_EVIDENCE", "RELEASE_SUPPORTING_DOCUMENT"]);
    assert.equal(detail.evidenceRequest.revokedAt, null);

    // A different submission's request never appears on this record.
    const other = await seed(db, schema);
    await requestService.requestSellEvidence(db, {
      sellSubmissionId: other.submission.id,
      categories: ["CUSTODY_PART_PHOTO"],
      actor: { id: admin.id },
      now: NOW,
    });
    detail = await reads.getSellSubmissionAdminDetail(db, submission.id);
    assert.equal(detail.evidenceRequest.id, second.data.requestId);
  });
});
