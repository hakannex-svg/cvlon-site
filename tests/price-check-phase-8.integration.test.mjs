import assert from "node:assert/strict";
import test from "node:test";
import { NetlifyDB } from "@netlify/database-dev";

import { extraction } from "./fixtures/price-check-phase-8-golden.mjs";

const migrationsDirectory = new URL(
  "../db/price-check/migrations-netlify-archive/",
  import.meta.url,
).pathname.replace(/^\/(\w:)/, "$1");

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";
  try {
    await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ db, schema });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

async function seedRequest(db, schema, suffix, clean = true) {
  const { authorizePendingUpload, findActiveUploadSession } = await import("../db/price-check/repositories/upload-repository.ts");
  const { createPriceCheckRequest } = await import("../db/price-check/repositories/request-repository.ts");
  const { generateOrderedId } = await import("../db/price-check/domain/identifiers.ts");
  const { eq } = await import("drizzle-orm");
  const tokenHash = suffix.toLowerCase().padEnd(64, "a").slice(0, 64);
  const pending = await authorizePendingUpload(db, { session: null, tokenHash, filename: `synthetic-${suffix}.pdf`, mime: "application/pdf", size: 64, objectKey: `quarantine/synthetic-${suffix}` });
  const session = await findActiveUploadSession(db, tokenHash);
  const attachmentId = generateOrderedId();
  const created = await createPriceCheckRequest(db, {
    requester: { firstName: "Synthetic", lastName: "Reviewer", companyName: "Example Aviation", businessEmail: `phase8-${suffix}@example.com`, role: "Buyer", country: "US", serviceProcessingAcknowledgedAt: new Date() },
    transaction: { originalPartNumber: "TEST-123-7", description: "Synthetic aviation component", quantity: "2", quoteOrPurchased: "quote", transactionType: "outright", conditionCode: "SV", unitPrice: "18750.00", currencyCode: "USD", coreDisposition: "NOT_APPLICABLE", aog: false },
    documentation: [],
    attachments: [{ id: attachmentId, pendingUploadId: pending.handle, uploadSessionId: session.id, displayFilename: `synthetic-${suffix}.pdf`, objectKey: `quarantine/synthetic-${suffix}`, declaredMime: "application/pdf", byteSize: 64 }],
    attribution: { sourcePage: "/price-check" }, idempotencyHash: `phase8-idempotency-${suffix}`, correlationId: `phase8-correlation-${suffix}`,
  });
  if (clean) await db.update(schema.attachments).set({ scanState: "CLEAN", detectedMime: "application/pdf", contentDigest: suffix.toLowerCase().padEnd(64, "b").slice(0, 64) }).where(eq(schema.attachments.id, attachmentId));
  return { ...created, attachmentId };
}

async function seedAdmin(db, schema) {
  const { generateOrderedId } = await import("../db/price-check/domain/identifiers.ts");
  const id = generateOrderedId();
  await db.insert(schema.adminUsers).values({ id, identityProviderIssuer: "https://accounts.google.com", identityProviderSubject: `synthetic-${id}`, displayEmail: "phase8-admin@example.com", role: "ADMIN", active: true });
  return { id, role: "ADMIN" };
}

test("only a clean owned attachment can queue and repeated triggers reuse one job", async () => {
  await withDatabase(async ({ db, schema }) => {
    const repository = await import("../db/price-check/repositories/extraction-repository.ts");
    const actor = await seedAdmin(db, schema);
    const clean = await seedRequest(db, schema, "CLEAN");
    const pending = await seedRequest(db, schema, "PENDING", false);
    const input = { priceCheckId: clean.priceCheckId, attachmentId: clean.attachmentId, actor, model: "test-model", schemaVersion: "phase8-v1", promptVersion: "phase8-v1" };
    const first = await repository.queueAttachmentExtraction(db, input);
    const duplicate = await repository.queueAttachmentExtraction(db, input);
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.job.id, first.job.id);
    assert.equal((await db.select().from(schema.processingJobs)).length, 1);
    await assert.rejects(repository.queueAttachmentExtraction(db, { ...input, priceCheckId: pending.priceCheckId, attachmentId: pending.attachmentId }), /ATTACHMENT_NOT_CLEAN/);
    await assert.rejects(repository.queueAttachmentExtraction(db, { ...input, attachmentId: pending.attachmentId }), /ATTACHMENT_NOT_FOUND/);
    await assert.rejects(repository.queueAttachmentExtraction(db, { ...input, attachmentId: "01M00000000000000000000000" }), /ATTACHMENT_NOT_FOUND/);
  });
});

test("successful extraction is immutable and confirmation creates a revision without an observation", async () => {
  await withDatabase(async ({ db, schema }) => {
    const repository = await import("../db/price-check/repositories/extraction-repository.ts");
    const actor = await seedAdmin(db, schema);
    const request = await seedRequest(db, schema, "APPLY");
    const queued = await repository.queueAttachmentExtraction(db, { priceCheckId: request.priceCheckId, attachmentId: request.attachmentId, actor, model: "test-model", schemaVersion: "phase8-v1", promptVersion: "phase8-v1" });
    const leased = await repository.leaseExtractionJob(db, { jobId: queued.job.id, leaseOwner: "synthetic-worker", now: new Date(), leaseUntil: new Date(Date.now() + 60_000) });
    assert.ok(leased);
    const stored = await repository.storeExtractionSuccess(db, { jobId: queued.job.id, leaseOwner: "synthetic-worker", attachmentId: request.attachmentId, priceCheckId: request.priceCheckId, model: "test-model", schemaVersion: "phase8-v1", promptVersion: "phase8-v1", proposal: extraction(), requestDigest: "c".repeat(64), latencyMs: 50, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });
    const applied = await repository.applyConfirmedExtraction(db, { priceCheckId: request.priceCheckId, extractionId: stored.extractionId, lineItemIndex: 0, acceptedFields: ["unitPrice", "quantity", "conditionCode"], changeReason: "Synthetic document extraction confirmed", actor });
    assert.equal(applied.version, 2);
    assert.equal(applied.acceptanceState, "PARTIALLY_ACCEPTED");
    const revisions = await db.select().from(schema.priceCheckRevisions);
    assert.equal(revisions.length, 2);
    assert.equal(revisions[1].sourceExtractionId, stored.extractionId);
    assert.equal(revisions[1].normalizedSnapshot.unitPrice, "16850.00");
    assert.equal(revisions[1].normalizedSnapshot.quantity, "1");
    assert.equal((await db.select().from(schema.priceObservations)).length, 0);
    assert.equal((await db.select().from(schema.attachmentExtractions)).length, 1);
    assert.equal((await db.select().from(schema.aiArtifacts)).length, 1);
    assert.equal((await db.select().from(schema.processingJobs))[0].state, "succeeded");
  });
});

test("browser cannot forge proposed values or apply unknown, missing, or cross-request extraction fields", async () => {
  await withDatabase(async ({ db, schema }) => {
    const repository = await import("../db/price-check/repositories/extraction-repository.ts");
    const actor = await seedAdmin(db, schema);
    const first = await seedRequest(db, schema, "FIRST");
    const second = await seedRequest(db, schema, "SECOND");
    const queued = await repository.queueAttachmentExtraction(db, { priceCheckId: first.priceCheckId, attachmentId: first.attachmentId, actor, model: "test-model", schemaVersion: "phase8-v1", promptVersion: "phase8-v1" });
    await repository.leaseExtractionJob(db, { jobId: queued.job.id, leaseOwner: "synthetic-worker", now: new Date(), leaseUntil: new Date(Date.now() + 60_000) });
    const proposal = extraction(); proposal.line_items[0].warranty = { state: "NOT_FOUND", value: null, raw: null, evidence: { page: null, span: null, source_type: "unknown", ambiguous: false } };
    const stored = await repository.storeExtractionSuccess(db, { jobId: queued.job.id, leaseOwner: "synthetic-worker", attachmentId: first.attachmentId, priceCheckId: first.priceCheckId, model: "test-model", schemaVersion: "phase8-v1", promptVersion: "phase8-v1", proposal, requestDigest: "d".repeat(64), latencyMs: 50, usage: { inputTokens: null, outputTokens: null, totalTokens: null } });
    await assert.rejects(repository.applyConfirmedExtraction(db, { priceCheckId: second.priceCheckId, extractionId: stored.extractionId, lineItemIndex: 0, acceptedFields: ["unitPrice"], changeReason: "Cross request attempt rejected", actor }), /EXTRACTION_NOT_READY/);
    await assert.rejects(repository.applyConfirmedExtraction(db, { priceCheckId: first.priceCheckId, extractionId: stored.extractionId, lineItemIndex: 0, acceptedFields: ["marketPrice"], changeReason: "Unknown field rejected", actor }), /EXTRACTION_FIELDS_INVALID/);
    await assert.rejects(repository.applyConfirmedExtraction(db, { priceCheckId: first.priceCheckId, extractionId: stored.extractionId, lineItemIndex: 0, acceptedFields: ["warrantyText"], changeReason: "Missing field rejected", actor }), /EXTRACTION_FIELD_NOT_PRESENT/);
    assert.equal((await db.select().from(schema.priceCheckRevisions)).length, 2);
    assert.equal((await db.select().from(schema.priceObservations)).length, 0);
  });
});
