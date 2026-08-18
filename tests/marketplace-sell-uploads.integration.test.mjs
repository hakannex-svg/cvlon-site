import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

import { expectedMigrationCount, migrationsDirectory } from "./helpers/migration-archive.mjs";
import { csvBytes, jpegBytes, pdfBytes, xlsmBytes, xlsxBytes } from "./fixtures/marketplace-upload-bytes.mjs";

const TOKEN_KEY = "civilon-marketplace-verify-token-key-for-tests";
const SESSION_KEY = "civilon-marketplace-upload-session-key-for-tests";
const APPROVED_ORIGIN = "https://deploy-preview-1--cvlon.netlify.app";
const SOURCE_PAGE = "/buy-sell-aircraft-parts/sell";
const BUCKET = "civilon-marketplace-test-bucket";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * A real disposable Postgres from `@netlify/database-dev`, migrated from empty,
 * exactly as every other Civilon integration suite does.
 *
 * Storage is always a fake. No AWS credential, no network call and no real
 * bucket is involved anywhere in this file: the ownership and claim rules under
 * test are database rules, and the storage answers they depend on are supplied
 * directly so each verdict — clean, pending, dirty, missing, mismatched — can
 * be exercised deterministically.
 */
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
  delete process.env.MARKETPLACE_INTERNAL_RECIPIENTS;
  try {
    const applied = await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema, applied });
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

/* --------------------------------------------------------------- fake S3 */

/**
 * Stands in for S3. Objects are described by the test, so the tag set, stored
 * length, content type and bytes are all under the test's control and no
 * provider is ever contacted.
 */
function fakeStorage(objects = new Map()) {
  const calls = [];
  const client = {
    async send(command) {
      const name = command.constructor.name;
      const key = command.input.Key;
      calls.push({ name, key });
      const object = objects.get(key);
      if (!object) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });

      if (name === "GetObjectTaggingCommand") {
        if (object.tagsUnreadable) throw new Error("AccessDenied");
        return {
          TagSet: object.scanStatus === undefined
            ? []
            : [{ Key: "GuardDutyMalwareScanStatus", Value: object.scanStatus }],
        };
      }
      if (name === "HeadObjectCommand") {
        return {
          ContentLength: object.storedSize ?? object.body.length,
          ContentType: object.contentType,
        };
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
  return { objects, calls, storage: () => ({ client, bucket: BUCKET }) };
}

/** A stored object that passes every check unless the test says otherwise. */
function cleanObject(body, contentType, overrides = {}) {
  return { body, contentType, scanStatus: "NO_THREATS_FOUND", ...overrides };
}

/* ------------------------------------------------------------- helpers */

async function authorizeUpload(db, sessionToken, declaration) {
  const [{ authorizeMarketplacePendingUpload }, { hashMarketplaceUploadSessionToken }, repository] =
    await Promise.all([
      import("../db/price-check/repositories/marketplace-upload-repository.ts"),
      import("../lib/marketplace/uploads/session.ts"),
      import("../db/price-check/repositories/marketplace-upload-repository.ts"),
    ]);
  const { validateMarketplaceUploadDeclaration } = await import("../lib/marketplace/uploads/file-validation.ts");
  const validated = validateMarketplaceUploadDeclaration(declaration);
  const tokenHash = hashMarketplaceUploadSessionToken(SESSION_KEY, sessionToken);
  const active = await repository.findActiveMarketplaceUploadSession(db, tokenHash, "sell_submission");
  const { randomBytes } = await import("node:crypto");
  return authorizeMarketplacePendingUpload(db, {
    session: active ? { id: active.id, tokenHash: active.tokenHash } : null,
    tokenHash,
    intendedAggregateType: "sell_submission",
    filename: validated.filename,
    mime: validated.mime,
    size: validated.size,
    purpose: validated.purpose,
    objectKey: `marketplace/quarantine/sell_submission/${randomBytes(32).toString("base64url")}`,
  });
}

async function newSessionToken() {
  const { newMarketplaceUploadSessionToken } = await import("../lib/marketplace/uploads/session.ts");
  return newMarketplaceUploadSessionToken();
}

function sellPayload(overrides = {}) {
  return {
    idempotencyKey: "3f1a2b4c-5d6e-4f70-8123-456789abcdef",
    submissionKind: "single_part",
    partNumber: "101-384025-5",
    firstName: "Sam",
    lastName: "Okafor",
    companyName: "Example Component Supply",
    businessEmail: "Sam.Okafor@Example.com",
    serviceAcknowledged: true,
    legalAcknowledged: true,
    sourcePage: SOURCE_PAGE,
    ...overrides,
  };
}

/**
 * Runs the real submission service with the real binding module, but with
 * storage injected. Everything below the fake is production code: the same
 * ownership query, the same scan gate, the same content verifier and the same
 * single transaction that claims handles and writes attachment rows.
 */
async function submit(db, { payload = {}, sessionToken, storage }) {
  const [{ validateSellSubmission }, { submitSellSubmission }, binding, session] = await Promise.all([
    import("../lib/marketplace/sell-validation.ts"),
    import("../lib/marketplace/sell-submission-service.ts"),
    import("../lib/marketplace/uploads/binding.ts"),
    import("../lib/marketplace/uploads/session.ts"),
  ]);
  const [{ createSellSubmission, findSellSubmissionByIdempotencyHash }, identifiers, verification, marketplaceRepository] =
    await Promise.all([
      import("../db/price-check/repositories/sell-submission-repository.ts"),
      import("../db/price-check/domain/identifiers.ts"),
      import("../lib/marketplace/verification.ts"),
      import("../db/price-check/repositories/marketplace-upload-repository.ts"),
    ]);

  const validation = validateSellSubmission(sellPayload(payload));
  assert.equal(validation.success, true, JSON.stringify(validation.fieldErrors));

  return submitSellSubmission(
    db,
    validation.data,
    {
      create: createSellSubmission,
      findByIdempotency: findSellSubmissionByIdempotencyHash,
      generateReference: () => identifiers.generatePublicReference("SS"),
      tokenKey: () => verification.marketplaceVerifyTokenKey(),
      newNonce: verification.newVerificationNonce,
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
        { findClaimable: marketplaceRepository.findClaimableMarketplaceUploads, storage },
      ),
    },
    { uploadSessionToken: sessionToken },
  );
}

/* --------------------------------------------------------------- tests */

test("the archive still applies all nine migrations from empty", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    assert.equal(applied.length, expectedMigrationCount());
    assert.ok(applied.length >= 9, `expected at least 9 migrations, applied ${applied.length}`);
    // The three marketplace upload tables exist and start empty.
    assert.equal((await db.select().from(schema.marketplaceUploadSessions)).length, 0);
    assert.equal((await db.select().from(schema.marketplacePendingUploads)).length, 0);
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0);
  });
});

test("an authorized upload is owned by its session and lands in the marketplace namespace", async () => {
  await withDatabase(async ({ db, schema }) => {
    const token = await newSessionToken();
    const pending = await authorizeUpload(db, token, {
      filename: "inventory.csv", mime: "text/csv", size: 2048, purpose: "INVENTORY_SPREADSHEET",
    });
    assert.match(pending.handle, /^[0-9A-HJKMNP-TV-Z]{26}$/);

    const [session] = await db.select().from(schema.marketplaceUploadSessions);
    assert.equal(session.intendedAggregateType, "sell_submission");
    assert.equal(session.authorizedCount, 1);
    assert.equal(session.expectedByteSize, "2048");
    // Only a keyed hash is stored. The cookie value itself appears nowhere.
    assert.match(session.tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(session).includes(token), false);

    const [row] = await db.select().from(schema.marketplacePendingUploads);
    assert.equal(row.id, pending.handle);
    assert.equal(row.uploadSessionId, session.id);
    assert.ok(row.objectKey.startsWith("marketplace/quarantine/sell_submission/"));
    assert.equal(row.state, "AUTHORIZED");
    assert.equal(row.purpose, "INVENTORY_SPREADSHEET");
    assert.equal(row.claimedBuyRequestId, null);
    assert.equal(row.claimedSellSubmissionId, null);
    // The key carries no seller-supplied text, so a filename can never traverse.
    assert.equal(row.objectKey.includes("inventory"), false);

    const audits = await db.select().from(schema.auditEvents);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "MARKETPLACE_UPLOAD_AUTHORIZED");
    assert.equal(JSON.stringify(audits[0].sanitizedMetadata).includes("inventory.csv"), false);
  });
});

test("twelve files fit one session; the thirteenth and an over-200 MB total are refused", async () => {
  await withDatabase(async ({ db, schema }) => {
    const token = await newSessionToken();
    for (let index = 0; index < 12; index += 1) {
      await authorizeUpload(db, token, {
        filename: `photo-${index}.jpg`, mime: "image/jpeg", size: 1024, purpose: "CUSTODY_PART_PHOTO",
      });
    }
    const [session] = await db.select().from(schema.marketplaceUploadSessions);
    assert.equal(session.authorizedCount, 12);
    assert.equal((await db.select().from(schema.marketplacePendingUploads)).length, 12);

    await assert.rejects(
      authorizeUpload(db, token, {
        filename: "photo-13.jpg", mime: "image/jpeg", size: 1024, purpose: "CUSTODY_PART_PHOTO",
      }),
      /SESSION_LIMIT_REACHED/,
    );
    assert.equal((await db.select().from(schema.marketplacePendingUploads)).length, 12, "nothing was reserved");

    // A fresh session: four 50 MB files fit, the fifth breaks 200 MB.
    const bulkToken = await newSessionToken();
    for (let index = 0; index < 4; index += 1) {
      await authorizeUpload(db, bulkToken, {
        filename: `list-${index}.csv`, mime: "text/csv", size: 50 * 1024 * 1024, purpose: "INVENTORY_SPREADSHEET",
      });
    }
    const sessions = await db.select().from(schema.marketplaceUploadSessions);
    const bulk = sessions.find((entry) => entry.authorizedCount === 4);
    assert.equal(bulk.expectedByteSize, String(200 * 1024 * 1024));
    await assert.rejects(
      authorizeUpload(db, bulkToken, {
        filename: "list-5.csv", mime: "text/csv", size: 1, purpose: "INVENTORY_SPREADSHEET",
      }),
      /SESSION_LIMIT_REACHED/,
    );
    assert.equal(bulk.authorizedCount, 4);
  });
});

test("a clean, verified handle is claimed and turned into an attachment in one transaction", async () => {
  await withDatabase(async ({ db, schema }) => {
    const token = await newSessionToken();
    const spreadsheet = await authorizeUpload(db, token, {
      filename: "inventory.csv", mime: "text/csv", size: csvBytes().length, purpose: "INVENTORY_SPREADSHEET",
    });
    const photo = await authorizeUpload(db, token, {
      filename: "nameplate.jpg", mime: "image/jpeg", size: jpegBytes().length, purpose: "PART_NUMBER_SERIAL_PHOTO",
    });
    const rows = await db.select().from(schema.marketplacePendingUploads);
    const fake = fakeStorage(new Map(rows.map((row) => [
      row.objectKey,
      cleanObject(row.declaredMime === "text/csv" ? csvBytes() : jpegBytes(), row.declaredMime),
    ])));

    const result = await submit(db, {
      payload: { attachmentHandles: [spreadsheet.handle, photo.handle] },
      sessionToken: token,
      storage: fake.storage,
    });
    assert.equal(result.created, true);

    const [submission] = await db.select().from(schema.sellSubmissions);
    const attachments = await db.select().from(schema.marketplaceAttachments);
    assert.equal(attachments.length, 2);
    for (const attachment of attachments) {
      assert.equal(attachment.aggregateType, "sell_submission");
      assert.equal(attachment.aggregateId, submission.id);
      assert.equal(attachment.sellSubmissionId, submission.id);
      assert.equal(attachment.buyRequestId, null, "a Sell attachment never names a Buy Request");
      assert.equal(attachment.uploadedByType, "CONTACT");
      assert.equal(attachment.storageProvider, "AWS_S3");
      assert.equal(attachment.retentionClass, "MARKETPLACE_INTAKE_EVIDENCE");
      assert.ok(attachment.objectKey.startsWith("marketplace/"));
      assert.equal(attachment.scanState, "CLEAN");
      // Clean means staff may review it, not that it left quarantine.
      assert.equal(attachment.quarantineReleasedAt, null);
      assert.equal(attachment.deletedAt, null);
      assert.equal(attachment.detectedMime, attachment.declaredMime);
      assert.ok(attachment.sourcePendingUploadId);
    }
    assert.deepEqual(
      attachments.map((entry) => entry.purpose).sort(),
      ["INVENTORY_SPREADSHEET", "PART_NUMBER_SERIAL_PHOTO"],
    );

    // Both handles are spent and bound to this submission and no other.
    const claimed = await db.select().from(schema.marketplacePendingUploads);
    assert.ok(claimed.every((row) => row.state === "BOUND"));
    assert.ok(claimed.every((row) => row.claimedSellSubmissionId === submission.id));
    assert.ok(claimed.every((row) => row.claimedBuyRequestId === null));

    const bound = await db.select().from(schema.auditEvents);
    const attachmentAudits = bound.filter((event) => event.action === "SELL_SUBMISSION_ATTACHMENT_BOUND");
    assert.equal(attachmentAudits.length, 2);
    const auditText = JSON.stringify(attachmentAudits);
    for (const secret of ["inventory.csv", "nameplate.jpg", "marketplace/quarantine"]) {
      assert.equal(auditText.includes(secret), false, `audit must not carry ${secret}`);
    }
  });
});

test("a submission with zero attachments still succeeds and never touches storage", async () => {
  await withDatabase(async ({ db, schema }) => {
    const fake = fakeStorage();
    const result = await submit(db, { payload: {}, sessionToken: null, storage: fake.storage });
    assert.equal(result.created, true);
    assert.match(result.reference, /^SS-[0-9A-HJKMNP-TV-Z]{10}$/);

    assert.equal((await db.select().from(schema.sellSubmissions)).length, 1);
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0);
    assert.equal((await db.select().from(schema.notificationOutbox)).length, 2);
    assert.equal(fake.calls.length, 0, "no storage call may happen when nothing was attached");

    // Uploads are optional even with an active session the seller never used.
    const token = await newSessionToken();
    await authorizeUpload(db, token, {
      filename: "unused.pdf", mime: "application/pdf", size: 512, purpose: "RELEASE_SUPPORTING_DOCUMENT",
    });
    const second = await submit(db, {
      payload: { idempotencyKey: "7c1a2b4c-5d6e-4f70-8123-456789abcdef", attachmentHandles: [] },
      sessionToken: token,
      storage: fake.storage,
    });
    assert.equal(second.created, true);
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0);
    const [unused] = await db.select().from(schema.marketplacePendingUploads);
    assert.equal(unused.state, "AUTHORIZED", "an unused handle is left alone, not consumed");
  });
});

test("pending, dirty and unreadable scan evidence each roll the whole submission back", async () => {
  for (const scenario of [
    { label: "no tag yet", object: { scanStatus: undefined }, code: /SCAN_PENDING/ },
    { label: "threats found", object: { scanStatus: "THREATS_FOUND" }, code: /SCAN_REJECTED/ },
    { label: "scanner failed", object: { scanStatus: "ACCESS_DENIED" }, code: /SCAN_UNAVAILABLE/ },
    { label: "tags unreadable", object: { tagsUnreadable: true }, code: /SCAN_UNAVAILABLE/ },
  ]) {
    await withDatabase(async ({ db, schema }) => {
      const token = await newSessionToken();
      const pending = await authorizeUpload(db, token, {
        filename: "list.csv", mime: "text/csv", size: csvBytes().length, purpose: "INVENTORY_SPREADSHEET",
      });
      const [row] = await db.select().from(schema.marketplacePendingUploads);
      const fake = fakeStorage(new Map([[
        row.objectKey,
        cleanObject(csvBytes(), "text/csv", scenario.object),
      ]]));

      await assert.rejects(
        submit(db, {
          payload: { attachmentHandles: [pending.handle] },
          sessionToken: token,
          storage: fake.storage,
        }),
        scenario.code,
        scenario.label,
      );

      // Nothing at all was written: no submission, no contact, no attachment,
      // no outbox message, and the handle is still unspent.
      assert.equal((await db.select().from(schema.sellSubmissions)).length, 0, scenario.label);
      assert.equal((await db.select().from(schema.marketplaceContacts)).length, 0, scenario.label);
      assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0, scenario.label);
      assert.equal((await db.select().from(schema.notificationOutbox)).length, 0, scenario.label);
      const [after] = await db.select().from(schema.marketplacePendingUploads);
      assert.equal(after.state, "AUTHORIZED", scenario.label);
      assert.equal(after.claimedSellSubmissionId, null, scenario.label);

      // A non-clean verdict is never read for content.
      assert.equal(fake.calls.some((call) => call.name === "GetObjectCommand"), false, scenario.label);
    });
  }
});

test("a missing object, a wrong size, a wrong type and wrong content are all refused", async () => {
  /*
   * Each scenario declares the upload exactly as an honest seller would, then
   * changes one fact about the object that was actually stored. Every one of
   * them must abort the whole submission, and the declared size is always the
   * size the session reserved — a swapped payload cannot buy itself room by
   * being a different length.
   */
  const csv = csvBytes();
  for (const scenario of [
    {
      label: "object missing",
      declared: { mime: "text/csv", filename: "list.csv", size: csv.length },
      build: () => new Map(),
      code: /SCAN_UNAVAILABLE/,
    },
    {
      label: "stored object is a different length than the seller reserved",
      declared: { mime: "text/csv", filename: "list.csv", size: csv.length },
      build: (key) => new Map([[key, cleanObject(csv, "text/csv", { storedSize: 999_999 })]]),
      code: /SIZE_MISMATCH/,
    },
    {
      label: "stored content type does not match the handle",
      declared: { mime: "text/csv", filename: "list.csv", size: csv.length },
      build: (key) => new Map([[key, cleanObject(csv, "application/pdf")]]),
      code: /TYPE_MISMATCH/,
    },
    {
      label: "a macro workbook uploaded against an XLSX handle",
      declared: { mime: XLSX_MIME, filename: "stock.xlsx", size: xlsmBytes().length },
      build: (key) => new Map([[key, cleanObject(xlsmBytes(), XLSX_MIME)]]),
      code: /Macro-enabled/,
    },
    {
      label: "a PDF uploaded against a CSV handle",
      declared: { mime: "text/csv", filename: "list.csv", size: pdfBytes().length },
      build: (key) => new Map([[key, cleanObject(pdfBytes(), "text/csv")]]),
      code: /does not match its declared type/,
    },
    {
      label: "an encrypted PDF uploaded against a PDF handle",
      declared: {
        mime: "application/pdf",
        filename: "release.pdf",
        size: pdfBytes({ encrypted: true }).length,
      },
      build: (key) => new Map([[key, cleanObject(pdfBytes({ encrypted: true }), "application/pdf")]]),
      code: /Password-protected/,
    },
  ]) {
    await withDatabase(async ({ db, schema }) => {
      const token = await newSessionToken();
      const pending = await authorizeUpload(db, token, {
        ...scenario.declared,
        purpose: scenario.declared.mime === "application/pdf"
          ? "RELEASE_SUPPORTING_DOCUMENT"
          : "INVENTORY_SPREADSHEET",
      });
      const [row] = await db.select().from(schema.marketplacePendingUploads);
      const fake = fakeStorage(scenario.build(row.objectKey));

      await assert.rejects(
        submit(db, {
          payload: { attachmentHandles: [pending.handle] },
          sessionToken: token,
          storage: fake.storage,
        }),
        scenario.code,
        scenario.label,
      );
      assert.equal((await db.select().from(schema.sellSubmissions)).length, 0, scenario.label);
      assert.equal((await db.select().from(schema.marketplaceContacts)).length, 0, scenario.label);
      assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0, scenario.label);
      assert.equal((await db.select().from(schema.notificationOutbox)).length, 0, scenario.label);
      const [after] = await db.select().from(schema.marketplacePendingUploads);
      assert.equal(after.state, "AUTHORIZED", scenario.label);
      assert.equal(after.claimedSellSubmissionId, null, scenario.label);
    });
  }
});

test("a ZIP renamed .xlsx is refused, and a genuine macro-free package is accepted", async () => {
  await withDatabase(async ({ db, schema }) => {
    const token = await newSessionToken();
    const genuine = xlsxBytes();
    const disguised = xlsxBytes({ firstEntry: "payload.exe" });

    const good = await authorizeUpload(db, token, {
      filename: "inventory.xlsx", mime: XLSX_MIME, size: genuine.length, purpose: "INVENTORY_SPREADSHEET",
    });
    const bad = await authorizeUpload(db, token, {
      filename: "stock.xlsx", mime: XLSX_MIME, size: disguised.length, purpose: "INVENTORY_SPREADSHEET",
    });
    const rows = await db.select().from(schema.marketplacePendingUploads);
    const goodRow = rows.find((row) => row.id === good.handle);
    const badRow = rows.find((row) => row.id === bad.handle);

    // The disguised archive is refused even though its extension, declared MIME
    // and stored length are all exactly what the package should look like.
    await assert.rejects(
      submit(db, {
        payload: { attachmentHandles: [bad.handle] },
        sessionToken: token,
        storage: fakeStorage(new Map([[badRow.objectKey, cleanObject(disguised, XLSX_MIME)]])).storage,
      }),
      /not a valid XLSX/,
    );
    assert.equal((await db.select().from(schema.sellSubmissions)).length, 0);

    const accepted = await submit(db, {
      payload: { attachmentHandles: [good.handle] },
      sessionToken: token,
      storage: fakeStorage(new Map([[goodRow.objectKey, cleanObject(genuine, XLSX_MIME)]])).storage,
    });
    assert.equal(accepted.created, true);
    const [attachment] = await db.select().from(schema.marketplaceAttachments);
    assert.equal(attachment.detectedMime, XLSX_MIME);
    // The refused handle is still unspent and can be replaced by the seller.
    const after = await db.select().from(schema.marketplacePendingUploads);
    assert.equal(after.find((row) => row.id === bad.handle).state, "AUTHORIZED");
    assert.equal(after.find((row) => row.id === good.handle).state, "BOUND");
  });
});

test("a handle cannot be reused, by the same seller or by a second submission", async () => {
  await withDatabase(async ({ db, schema }) => {
    const token = await newSessionToken();
    const pending = await authorizeUpload(db, token, {
      filename: "release.pdf",
      mime: "application/pdf",
      size: pdfBytes().length,
      purpose: "RELEASE_SUPPORTING_DOCUMENT",
    });
    const [row] = await db.select().from(schema.marketplacePendingUploads);
    const fake = fakeStorage(new Map([[row.objectKey, cleanObject(pdfBytes(), "application/pdf")]]));

    const first = await submit(db, {
      payload: { attachmentHandles: [pending.handle] },
      sessionToken: token,
      storage: fake.storage,
    });
    assert.equal(first.created, true);

    // A different offer presenting the same handle finds nothing claimable.
    await assert.rejects(
      submit(db, {
        payload: {
          idempotencyKey: "8b1a2b4c-5d6e-4f70-8123-456789abcdef",
          attachmentHandles: [pending.handle],
        },
        sessionToken: token,
        storage: fake.storage,
      }),
      /HANDLES_UNAVAILABLE/,
    );

    assert.equal((await db.select().from(schema.sellSubmissions)).length, 1, "the second offer wrote nothing");
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 1);
    const [claimed] = await db.select().from(schema.marketplacePendingUploads);
    assert.equal(claimed.state, "BOUND");
    assert.equal(claimed.claimedSellSubmissionId, (await db.select().from(schema.sellSubmissions))[0].id);
  });
});

test("a handle from another session, or with no session at all, is refused", async () => {
  await withDatabase(async ({ db, schema }) => {
    const ownerToken = await newSessionToken();
    const strangerToken = await newSessionToken();
    const pending = await authorizeUpload(db, ownerToken, {
      filename: "list.csv", mime: "text/csv", size: csvBytes().length, purpose: "INVENTORY_SPREADSHEET",
    });
    const [row] = await db.select().from(schema.marketplacePendingUploads);
    const fake = fakeStorage(new Map([[row.objectKey, cleanObject(csvBytes(), "text/csv")]]));

    // Someone else's cookie: the handle is real, the ownership is not.
    await assert.rejects(
      submit(db, {
        payload: { attachmentHandles: [pending.handle] },
        sessionToken: strangerToken,
        storage: fake.storage,
      }),
      /HANDLES_UNAVAILABLE/,
    );
    // No cookie at all.
    await assert.rejects(
      submit(db, {
        payload: { attachmentHandles: [pending.handle] },
        sessionToken: null,
        storage: fake.storage,
      }),
      /SESSION_MISSING/,
    );
    // A handle that never existed.
    await assert.rejects(
      submit(db, {
        payload: { attachmentHandles: ["01M06PHA5E7P10AD0000000009"] },
        sessionToken: ownerToken,
        storage: fake.storage,
      }),
      /HANDLES_UNAVAILABLE/,
    );

    assert.equal((await db.select().from(schema.sellSubmissions)).length, 0);
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0);
    const [untouched] = await db.select().from(schema.marketplacePendingUploads);
    assert.equal(untouched.state, "AUTHORIZED");
    assert.equal(fake.calls.length, 0, "ownership is settled before storage is contacted");
  });
});

test("a session opened for a Buy Request cannot be claimed by a Sell Submission", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { authorizeMarketplacePendingUpload } = await import("../db/price-check/repositories/marketplace-upload-repository.ts");
    const { hashMarketplaceUploadSessionToken } = await import("../lib/marketplace/uploads/session.ts");
    const { randomBytes } = await import("node:crypto");

    const token = await newSessionToken();
    const buySession = await authorizeMarketplacePendingUpload(db, {
      session: null,
      tokenHash: hashMarketplaceUploadSessionToken(SESSION_KEY, token),
      intendedAggregateType: "buy_request",
      filename: "list.csv",
      mime: "text/csv",
      size: csvBytes().length,
      purpose: "INVENTORY_SPREADSHEET",
      objectKey: `marketplace/quarantine/buy_request/${randomBytes(32).toString("base64url")}`,
    });

    const [row] = await db.select().from(schema.marketplacePendingUploads);
    const fake = fakeStorage(new Map([[row.objectKey, cleanObject(csvBytes(), "text/csv")]]));
    await assert.rejects(
      submit(db, {
        payload: { attachmentHandles: [buySession.handle] },
        sessionToken: token,
        storage: fake.storage,
      }),
      /HANDLES_UNAVAILABLE/,
      "the intended aggregate is part of the ownership predicate",
    );

    assert.equal((await db.select().from(schema.sellSubmissions)).length, 0);
    const [session] = await db.select().from(schema.marketplaceUploadSessions);
    assert.equal(session.intendedAggregateType, "buy_request");
    const [after] = await db.select().from(schema.marketplacePendingUploads);
    assert.equal(after.state, "AUTHORIZED");
    assert.equal(after.claimedBuyRequestId, null);
  });
});

test("Price Check and marketplace handles are unusable in each other's workflow", async () => {
  await withDatabase(async ({ db, schema }) => {
    const priceCheckUploads = await import("../db/price-check/repositories/upload-repository.ts");
    const priceCheckSession = await import("../lib/price-check/uploads/session.ts");
    const marketplaceUploads = await import("../db/price-check/repositories/marketplace-upload-repository.ts");
    const marketplaceSession = await import("../lib/marketplace/uploads/session.ts");

    // One Price Check pending upload and one marketplace pending upload.
    const sharedCookieValue = await newSessionToken();
    const priceCheckPending = await priceCheckUploads.authorizePendingUpload(db, {
      session: null,
      tokenHash: priceCheckSession.hashUploadSessionToken(sharedCookieValue),
      filename: "quote.pdf",
      mime: "application/pdf",
      size: pdfBytes().length,
      objectKey: `quarantine/${"a".repeat(43)}`,
    });
    const marketplacePending = await authorizeUpload(db, sharedCookieValue, {
      filename: "release.pdf",
      mime: "application/pdf",
      size: pdfBytes().length,
      purpose: "RELEASE_SUPPORTING_DOCUMENT",
    });

    const marketplaceHash = marketplaceSession.hashMarketplaceUploadSessionToken(SESSION_KEY, sharedCookieValue);
    const priceCheckHash = priceCheckSession.hashUploadSessionToken(sharedCookieValue);
    assert.notEqual(marketplaceHash, priceCheckHash, "the same cookie value hashes into two namespaces");

    // Direction 1: a Price Check handle offered to the marketplace claim query.
    assert.deepEqual(
      await marketplaceUploads.findClaimableMarketplaceUploads(db, {
        tokenHash: marketplaceHash,
        handles: [priceCheckPending.handle],
        intendedAggregateType: "sell_submission",
      }),
      [],
    );
    const rows = await db.select().from(schema.marketplacePendingUploads);
    const marketplaceRow = rows.find((row) => row.id === marketplacePending.handle);
    await assert.rejects(
      submit(db, {
        payload: { attachmentHandles: [priceCheckPending.handle] },
        sessionToken: sharedCookieValue,
        storage: fakeStorage(new Map([[marketplaceRow.objectKey, cleanObject(pdfBytes(), "application/pdf")]])).storage,
      }),
      /HANDLES_UNAVAILABLE/,
    );

    // Direction 2: a marketplace handle offered to the Price Check claim query.
    assert.deepEqual(
      await priceCheckUploads.findClaimablePendingUploads(db, priceCheckHash, [marketplacePending.handle]),
      [],
    );
    // Even the marketplace session's own hash finds nothing on the Price Check side.
    assert.deepEqual(
      await priceCheckUploads.findClaimablePendingUploads(db, marketplaceHash, [marketplacePending.handle]),
      [],
    );

    // Neither row moved, and the two workflows kept their own object prefixes.
    const [priceCheckRow] = await db.select().from(schema.pendingUploads);
    assert.equal(priceCheckRow.state, "AUTHORIZED");
    assert.equal(priceCheckRow.claimedPriceCheckId, null);
    assert.ok(priceCheckRow.objectKey.startsWith("quarantine/"));
    assert.equal(priceCheckRow.objectKey.startsWith("marketplace/"), false);
    assert.ok(marketplaceRow.objectKey.startsWith("marketplace/quarantine/"));
    assert.equal((await db.select().from(schema.marketplaceAttachments)).length, 0);
    assert.equal((await db.select().from(schema.attachments)).length, 0);
  });
});

test("evidence never reaches the seller or internal email, and the offer still verifies", async () => {
  await withDatabase(async ({ db, schema }) => {
    const token = await newSessionToken();
    const pending = await authorizeUpload(db, token, {
      filename: "warehouse-lease.pdf",
      mime: "application/pdf",
      size: pdfBytes().length,
      purpose: "WAREHOUSE_BUSINESS_EVIDENCE",
    });
    const [row] = await db.select().from(schema.marketplacePendingUploads);
    const submitted = await submit(db, {
      payload: { attachmentHandles: [pending.handle] },
      sessionToken: token,
      storage: fakeStorage(new Map([[row.objectKey, cleanObject(pdfBytes(), "application/pdf")]])).storage,
    });

    const { processNextNotification } = await import("../lib/notifications/outbox-worker.ts");
    const { civilonNotificationHandlers } = await import("../lib/notifications/registry.ts");
    const sent = [];
    const provider = {
      async send(message) {
        sent.push(message);
        return { providerMessageId: "test", submittedAt: new Date().toISOString() };
      },
    };
    const now = new Date();
    for (let drain = 0; drain < 2; drain += 1) {
      const outcome = await processNextNotification(db, {
        handlers: civilonNotificationHandlers, provider, now, leaseOwner: `w${drain}`,
      });
      assert.equal(outcome.status, "succeeded");
    }

    assert.equal(sent.length, 2);
    for (const mail of sent) {
      const surface = [mail.subject, mail.textBody, mail.htmlBody, mail.tag, JSON.stringify(mail.metadata)].join("\n");
      for (const secret of [
        "warehouse-lease", ".pdf", "marketplace/", "WAREHOUSE_BUSINESS_EVIDENCE",
        "attachment", "application/pdf", row.objectKey, pending.handle,
      ]) {
        assert.equal(surface.includes(secret), false, `${mail.tag} must not contain ${secret}`);
      }
      assert.ok(surface.includes(submitted.reference));
    }

    // The offer remains email-verification-gated: evidence proves nothing.
    const [submission] = await db.select().from(schema.sellSubmissions);
    assert.equal(submission.status, "pending_verification");
    assert.equal(submission.verifiedAt, null);
    const [contact] = await db.select().from(schema.marketplaceContacts);
    assert.equal(contact.verificationState, "PENDING");

    const { verifySellSubmissionContact } = await import("../lib/marketplace/sell-verification-service.ts");
    const { deriveSellVerificationToken } = await import("../lib/marketplace/verification.ts");
    const [tokenRow] = await db.select().from(schema.emailVerificationTokens);
    const outcome = await verifySellSubmissionContact(db, {
      token: deriveSellVerificationToken(TOKEN_KEY, tokenRow.tokenDerivationNonce),
    });
    assert.deepEqual(outcome, { outcome: "verified", reference: submitted.reference });

    // Verification changes the offer's status and nothing about the evidence:
    // it is not company verification, custody proof, or an approval of any kind.
    const [attachment] = await db.select().from(schema.marketplaceAttachments);
    assert.equal(attachment.scanState, "CLEAN");
    assert.equal(attachment.quarantineReleasedAt, null);
    assert.equal(attachment.deletedAt, null);
    assert.equal(attachment.deletionDueAt, null);
  });
});
