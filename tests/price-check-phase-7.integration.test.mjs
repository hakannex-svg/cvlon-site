import assert from "node:assert/strict";
import test from "node:test";
import { NetlifyDB } from "@netlify/database-dev";

const migrationsDirectory = new URL("../netlify/database/migrations/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
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
    await server.stop();
  }
}

function requestInput(attachments, suffix = "A") {
  return {
    requester: { firstName: "Synthetic", lastName: "Upload", companyName: "Example Phase 7 Aviation", businessEmail: `phase7-${suffix}@example.com`, phone: null, role: "Buyer", country: "US", serviceProcessingAcknowledgedAt: new Date() },
    transaction: { originalPartNumber: `TEST-PHASE7-${suffix}`, quantity: "1", quoteOrPurchased: "quote", transactionType: "outright", conditionCode: "SV", unitPrice: "1200", currencyCode: "USD", coreDisposition: "NOT_APPLICABLE", aog: false },
    documentation: [], attachments, attribution: { sourcePage: "/price-check" }, idempotencyHash: `phase7-idempotency-${suffix}`, correlationId: `phase7-correlation-${suffix}`,
  };
}

test("pre-submission ownership binds atomically and a handle cannot be reused", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    assert.equal(applied.length, 7);
    const { eq } = await import("drizzle-orm");
    const { authorizePendingUpload, findClaimablePendingUploads } = await import("../db/price-check/repositories/upload-repository.ts");
    const { createPriceCheckRequest } = await import("../db/price-check/repositories/request-repository.ts");
    const { hashUploadSessionToken } = await import("../lib/price-check/uploads/session.ts");
    const tokenHash = hashUploadSessionToken("synthetic-session-token");
    const pending = await authorizePendingUpload(db, { session: null, tokenHash, filename: "quote.pdf", mime: "application/pdf", size: 1024, objectKey: "quarantine/synthetic-opaque-object" });
    const claimable = await findClaimablePendingUploads(db, tokenHash, [pending.handle]);
    assert.equal(claimable.length, 1);
    assert.equal((await findClaimablePendingUploads(db, hashUploadSessionToken("other-session"), [pending.handle])).length, 0);

    const attachment = { id: "01M06PHASE7ATTACHMENT00001", pendingUploadId: pending.handle, uploadSessionId: pending.sessionId, displayFilename: "quote.pdf", objectKey: "quarantine/synthetic-opaque-object", declaredMime: "application/pdf", byteSize: 1024 };
    const created = await createPriceCheckRequest(db, requestInput([attachment], "A"));
    const [stored] = await db.select().from(schema.attachments).where(eq(schema.attachments.priceCheckId, created.priceCheckId));
    const [claimed] = await db.select().from(schema.pendingUploads).where(eq(schema.pendingUploads.id, pending.handle));
    assert.equal(stored.scanState, "PENDING");
    assert.equal(stored.storageProvider, "AWS_S3");
    assert.equal(stored.contentDigest, null);
    assert.equal(claimed.state, "BOUND");
    assert.equal(claimed.claimedPriceCheckId, created.priceCheckId);
    await assert.rejects(createPriceCheckRequest(db, requestInput([{ ...attachment, id: "01M06PHASE7ATTACHMENT00002" }], "B")), /already used or expired/);
    assert.equal((await db.select().from(schema.priceChecks)).length, 1);
    assert.equal((await db.select().from(schema.requesters)).length, 1);
  });
});

test("upload session enforces three files and 30 MB expected-byte ceiling", async () => {
  await withDatabase(async ({ db }) => {
    const { authorizePendingUpload, findActiveUploadSession } = await import("../db/price-check/repositories/upload-repository.ts");
    const tokenHash = "a".repeat(64);
    const first = await authorizePendingUpload(db, { session: null, tokenHash, filename: "one.pdf", mime: "application/pdf", size: 10 * 1024 * 1024, objectKey: "quarantine/one" });
    const session = await findActiveUploadSession(db, tokenHash);
    await authorizePendingUpload(db, { session, tokenHash, filename: "two.pdf", mime: "application/pdf", size: 10 * 1024 * 1024, objectKey: "quarantine/two" });
    await authorizePendingUpload(db, { session, tokenHash, filename: "three.pdf", mime: "application/pdf", size: 10 * 1024 * 1024, objectKey: "quarantine/three" });
    await assert.rejects(authorizePendingUpload(db, { session, tokenHash, filename: "four.pdf", mime: "application/pdf", size: 1, objectKey: "quarantine/four" }), /maximum/);
    assert.ok(first.handle);
  });
});

