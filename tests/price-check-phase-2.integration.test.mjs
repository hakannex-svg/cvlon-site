import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

import { priceCheckFixtures } from "./fixtures/price-check-phase-2.mjs";

const execFileAsync = promisify(execFile);
const migrationsDirectory = new URL(
  "../netlify/database/migrations/",
  import.meta.url,
).pathname.replace(/^\/(\w:)/, "$1");

async function withPriceCheckDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";

  try {
    const applied = await server.applyMigrations(migrationsDirectory);
    const schema = await import("../db/price-check/schema.ts");
    const { drizzle } = await import("drizzle-orm/netlify-db");
    const db = drizzle({ schema });
    await run({ server, db, schema, applied });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

test("Phase 2 migration builds an empty database and replays as a no-op", async () => {
  await withPriceCheckDatabase(async ({ server, applied }) => {
    assert.equal(applied.length, 1);
    assert.deepEqual(await server.applyMigrations(migrationsDirectory), []);
    const { rows } = await server.query(
      "select count(*)::int as count from information_schema.tables where table_schema = 'public'",
    );
    assert.equal(rows[0].count, 19);
  });
});

test("a failed migration rolls back its disposable DDL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "civilon-phase2-migration-"));
  const server = new NetlifyDB({ logger: () => undefined });
  await server.start();
  try {
    await writeFile(
      join(directory, "99999999999999_invalid.sql"),
      "create table phase2_failed_probe (id integer);\ninvalid migration statement;",
    );
    await assert.rejects(server.applyMigrations(directory));
    const { rows } = await server.query(
      "select to_regclass('public.phase2_failed_probe') as table_name",
    );
    assert.equal(rows[0].table_name, null);
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("request aggregate, constraints, and immutable versions work together", async () => {
  await withPriceCheckDatabase(async ({ db, schema }) => {
    const { eq, sql } = await import("drizzle-orm");
    const { generateOrderedId } = await import(
      "../db/price-check/domain/identifiers.ts"
    );
    const {
      createPriceCheckRequest,
    } = await import("../db/price-check/repositories/request-repository.ts");
    const { createPriceCheckRevision } = await import(
      "../db/price-check/repositories/revision-repository.ts"
    );
    const normal = await createPriceCheckRequest(
      db,
      priceCheckFixtures.normalOutright,
    );

    const [stored] = await db
      .select()
      .from(schema.priceChecks)
      .where(eq(schema.priceChecks.id, normal.priceCheckId));
    assert.equal(stored.originalPartNumber, "TEST-OUTRIGHT-001");
    assert.equal(stored.normalizedPartNumber, "TESTOUTRIGHT001");
    assert.match(stored.publicReference, /^PC-[0-9A-HJKMNP-TV-Z]{10}$/);

    const copy = { ...stored, id: generateOrderedId() };
    await assert.rejects(
      db.insert(schema.priceChecks).values({
        ...copy,
        idempotencyHash: "synthetic-duplicate-public-ref",
      }),
    );
    await assert.rejects(
      db.insert(schema.priceChecks).values({
        ...copy,
        id: generateOrderedId(),
        publicReference: "PC-0123456789",
      }),
    );
    await assert.rejects(
      db
        .update(schema.priceChecks)
        .set({ currencyCode: "ZZZ" })
        .where(eq(schema.priceChecks.id, normal.priceCheckId)),
    );
    await assert.rejects(
      db
        .update(schema.priceChecks)
        .set({ quantity: "0.000" })
        .where(eq(schema.priceChecks.id, normal.priceCheckId)),
    );
    await assert.rejects(
      db.execute(
        sql`update price_checks set condition_code = ${"INVALID"} where id = ${normal.priceCheckId}`,
      ),
    );
    await assert.rejects(
      db.execute(
        sql`update price_checks set status = ${"invalid_status"} where id = ${normal.priceCheckId}`,
      ),
    );
    await assert.rejects(
      db.insert(schema.priceCheckDocumentRequirements).values({
        priceCheckId: normal.priceCheckId,
        requirementCode: "FAA_8130_3",
      }),
    );

    const correction = await createPriceCheckRevision(db, {
      priceCheckId: normal.priceCheckId,
      normalizedSnapshot: { normalizedPartNumber: "TESTOUTRIGHT001", quantity: "2.000" },
      changeReason: "Synthetic correction",
      actorType: "ADMIN",
    });
    assert.equal(correction.version, 2);
    const revisions = await db
      .select()
      .from(schema.priceCheckRevisions)
      .where(eq(schema.priceCheckRevisions.priceCheckId, normal.priceCheckId));
    assert.deepEqual(
      revisions.map((revision) => revision.version).sort(),
      [1, 2],
    );
    const [originalAfterRevision] = await db
      .select()
      .from(schema.priceChecks)
      .where(eq(schema.priceChecks.id, normal.priceCheckId));
    assert.equal(originalAfterRevision.quantity, "1.000");
    await assert.rejects(
      db.insert(schema.priceCheckRevisions).values({
        ...correction,
        id: generateOrderedId(),
      }),
    );

    await assert.rejects(
      db.insert(schema.resultAccessTokens).values({
        id: generateOrderedId(),
        resultId: generateOrderedId(),
        keyedTokenHash: "synthetic-invalid-foreign-key",
        issuedAt: new Date("2026-08-15T12:00:00Z"),
        expiresAt: new Date("2026-08-29T12:00:00Z"),
      }),
    );
  });
});

test("extraction, analysis, comparable, result, token, and audit history are versioned", async () => {
  await withPriceCheckDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const { generateOrderedId } = await import(
      "../db/price-check/domain/identifiers.ts"
    );
    const { createPriceCheckRequest } = await import(
      "../db/price-check/repositories/request-repository.ts"
    );
    const { createAuthorizedObservation } = await import(
      "../db/price-check/repositories/observation-repository.ts"
    );
    const { createAnalysisVersion } = await import(
      "../db/price-check/repositories/analysis-repository.ts"
    );
    const { createApprovedResultVersion } = await import(
      "../db/price-check/repositories/result-repository.ts"
    );
    const { createResultAccessTokenMetadata } = await import(
      "../db/price-check/repositories/token-repository.ts"
    );
    const { appendAuditEvent } = await import(
      "../db/price-check/repositories/audit-repository.ts"
    );

    const request = await createPriceCheckRequest(
      db,
      priceCheckFixtures.exchangeRefundableCore,
    );
    const adminId = generateOrderedId();
    await db.insert(schema.adminUsers).values({
      id: adminId,
      identityProviderIssuer: "https://identity.example.test",
      identityProviderSubject: "synthetic-admin-subject",
      displayEmail: "analyst@example.com",
      role: "ADMIN",
    });
    const attachmentId = generateOrderedId();
    await db.insert(schema.attachments).values({
      id: attachmentId,
      priceCheckId: request.priceCheckId,
      uploadedByType: "REQUESTER",
      displayFilename: "synthetic-quote.pdf",
      objectKey: "synthetic/opaque/object-key",
      storageProvider: "UNCONFIGURED_TEST",
      byteSize: "1234",
      contentDigest: "synthetic-content-digest",
      scanState: "PENDING",
      retentionClass: "PRICE_CHECK_EVIDENCE",
    });
    for (const version of [1, 2]) {
      await db.insert(schema.attachmentExtractions).values({
        id: generateOrderedId(),
        attachmentId,
        version,
        schemaVersion: "phase2-test-v1",
        structuredProposal: { version },
        processingStatus: "SUCCEEDED",
        acceptanceState: "PENDING",
      });
    }
    const extractions = await db
      .select()
      .from(schema.attachmentExtractions)
      .where(eq(schema.attachmentExtractions.attachmentId, attachmentId));
    assert.deepEqual(
      extractions.map((extraction) => extraction.version).sort(),
      [1, 2],
    );

    const observation = await createAuthorizedObservation(db, {
      provenanceType: "ANALYST_OBSERVATION",
      internalSourceReference: "synthetic-observation-1",
      originalPartNumber: "TEST-EXCHANGE-002",
      conditionCode: "OH",
      transactionType: "exchange",
      quantity: "1.000",
      unitPrice: "4400.00",
      currencyCode: "USD",
      coreCharge: "2500.00",
      coreDisposition: "REFUNDABLE",
      observationDate: "2026-08-01",
      aog: false,
      sourceReliability: "HIGH",
      verificationState: "VERIFIED",
      permittedUseState: "INTERNAL_ANALYSIS",
      deidentificationState: "DEIDENTIFIED",
      createdBy: adminId,
      reviewedBy: adminId,
    });
    const comparableSnapshot = {
      unitPrice: observation.unitPrice,
      conditionCode: observation.conditionCode,
    };
    const baseAnalysis = {
      priceCheckId: request.priceCheckId,
      inputRevisionId: request.revisionId,
      engineVersion: "synthetic-engine-v1",
      policyVersion: "synthetic-policy-v1",
      sourceTransactionComponents: { unitPrice: "4500.00" },
      normalizedTransactionComponents: { unitPrice: "4500.00" },
      marketLow: "4000.00",
      marketMedian: "4400.00",
      marketHigh: "5000.00",
      currencyCode: "USD",
      evidenceCount: 1,
      confidence: "LOW",
      classification: "SYNTHETIC_REVIEW_REQUIRED",
      insufficiencyReasons: ["SPARSE_EVIDENCE"],
      factorCodes: ["EXCHANGE", "REFUNDABLE_CORE"],
      deterministicCalculation: { method: "synthetic-test" },
      deterministicCalculationDigest: "synthetic-calculation-digest-v1",
      analystId: adminId,
      reviewState: "HUMAN_REVIEW",
      comparables: [
        {
          observationId: observation.id,
          included: true,
          reasonCode: "EXACT_SYNTHETIC_TEST",
          comparableSnapshot,
          sequence: 1,
        },
      ],
    };
    const analysis1 = await createAnalysisVersion(db, baseAnalysis);
    const analysis2 = await createAnalysisVersion(db, {
      ...baseAnalysis,
      deterministicCalculationDigest: "synthetic-calculation-digest-v2",
      factorCodes: [...baseAnalysis.factorCodes, "CORRECTION"],
    });
    assert.equal(analysis1.version, 1);
    assert.equal(analysis2.version, 2);

    await db
      .update(schema.priceObservations)
      .set({ unitPrice: "4600.00" })
      .where(eq(schema.priceObservations.id, observation.id));
    const [comparable] = await db
      .select()
      .from(schema.priceCheckComparables)
      .where(eq(schema.priceCheckComparables.analysisId, analysis1.id));
    assert.deepEqual(comparable.comparableSnapshot, comparableSnapshot);
    await assert.rejects(
      db.insert(schema.priceCheckComparables).values({
        ...comparable,
      }),
    );

    const result1 = await createApprovedResultVersion(db, {
      priceCheckId: request.priceCheckId,
      analysisId: analysis1.id,
      approvedClassification: "SYNTHETIC_REVIEWED",
      displayRange: true,
      displayEvidenceCount: true,
      approvedFactorList: ["EXCHANGE"],
      approvedExplanation: "Synthetic result version one.",
      disclaimerVersion: "test-v1",
      approvedBy: adminId,
      approvedAt: new Date("2026-08-15T13:00:00Z"),
      renderedContentDigest: "synthetic-result-digest-v1",
    });
    const result2 = await createApprovedResultVersion(db, {
      priceCheckId: request.priceCheckId,
      analysisId: analysis2.id,
      approvedClassification: "SYNTHETIC_REVIEWED_CORRECTED",
      displayRange: false,
      displayEvidenceCount: true,
      approvedFactorList: ["EXCHANGE", "CORRECTION"],
      approvedExplanation: "Synthetic result version two.",
      disclaimerVersion: "test-v1",
      approvedBy: adminId,
      approvedAt: new Date("2026-08-15T14:00:00Z"),
      renderedContentDigest: "synthetic-result-digest-v2",
    });
    assert.equal(result1.version, 1);
    assert.equal(result2.version, 2);
    const [preservedResult1] = await db
      .select()
      .from(schema.priceCheckResults)
      .where(eq(schema.priceCheckResults.id, result1.id));
    assert.equal(preservedResult1.approvedExplanation, "Synthetic result version one.");
    assert.ok(preservedResult1.supersededAt instanceof Date);

    const issuedAt = new Date("2026-08-15T15:00:00Z");
    const expiresAt = new Date("2026-08-29T15:00:00Z");
    await createResultAccessTokenMetadata(db, {
      resultId: result2.id,
      keyedTokenHash: "synthetic-keyed-token-hash",
      issuedAt,
      expiresAt,
    });
    await assert.rejects(
      createResultAccessTokenMetadata(db, {
        resultId: result2.id,
        keyedTokenHash: "synthetic-keyed-token-hash",
        issuedAt,
        expiresAt,
      }),
    );

    await appendAuditEvent(db, {
      aggregateType: "price_check",
      aggregateId: request.priceCheckId,
      actorType: "ADMIN",
      actorId: adminId,
      action: "result.approved.synthetic",
      afterVersionReference: "result:2",
      correlationId: "synthetic-audit-correlation",
      sanitizedMetadata: { test: true },
    });
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, request.priceCheckId));
    assert.equal(audits.length, 2);
  });
});

test("jobs, outbox, sourcing conversion, and failed transactions are idempotent", async () => {
  await withPriceCheckDatabase(async ({ db, schema }) => {
    const { eq } = await import("drizzle-orm");
    const { generateOrderedId } = await import(
      "../db/price-check/domain/identifiers.ts"
    );
    const { createPriceCheckRequest } = await import(
      "../db/price-check/repositories/request-repository.ts"
    );
    const { enqueueJob, leaseNextJob, failJob, completeJob } = await import(
      "../db/price-check/repositories/job-repository.ts"
    );
    const {
      enqueueNotification,
      leaseNextNotification,
      completeNotification,
    } = await import("../db/price-check/repositories/outbox-repository.ts");
    const { createAnalysisVersion } = await import(
      "../db/price-check/repositories/analysis-repository.ts"
    );
    const { createApprovedResultVersion } = await import(
      "../db/price-check/repositories/result-repository.ts"
    );
    const { createSourcingOpportunity } = await import(
      "../db/price-check/repositories/sourcing-repository.ts"
    );

    const request = await createPriceCheckRequest(db, priceCheckFixtures.aog);
    const now = new Date("2026-08-15T12:00:00Z");
    const jobInput = {
      jobType: "MAINTENANCE",
      aggregateType: "price_check",
      aggregateId: request.priceCheckId,
      idempotencyKey: "synthetic-phase2-job-key",
      nextAttemptAt: now,
    };
    assert.ok(await enqueueJob(db, jobInput));
    assert.equal(await enqueueJob(db, jobInput), null);
    const lease1 = await leaseNextJob(db, {
      leaseOwner: "worker-a",
      now,
      leaseUntil: new Date("2026-08-15T12:05:00Z"),
    });
    assert.equal(lease1.state, "running");
    assert.equal(
      await leaseNextJob(db, {
        leaseOwner: "worker-b",
        now,
        leaseUntil: new Date("2026-08-15T12:05:00Z"),
      }),
      null,
    );
    await failJob(db, {
      id: lease1.id,
      leaseOwner: "worker-a",
      nextAttemptAt: new Date("2026-08-15T12:01:00Z"),
      sanitizedErrorCode: "SYNTHETIC_RETRY",
    });
    const lease2 = await leaseNextJob(db, {
      leaseOwner: "worker-b",
      now: new Date("2026-08-15T12:02:00Z"),
      leaseUntil: new Date("2026-08-15T12:07:00Z"),
    });
    const completed = await completeJob(db, {
      id: lease2.id,
      leaseOwner: "worker-b",
      completedAt: new Date("2026-08-15T12:03:00Z"),
    });
    assert.equal(completed.state, "succeeded");
    assert.equal(completed.attemptCount, 2);

    const messageInput = {
      messageType: "SYNTHETIC_RESULT_READY",
      aggregateType: "price_check",
      aggregateId: request.priceCheckId,
      recipientReference: "requester:test",
      templateVersion: "synthetic-v1",
      idempotencyKey: "synthetic-phase2-message-key",
      nextAttemptAt: now,
    };
    assert.ok(await enqueueNotification(db, messageInput));
    assert.equal(await enqueueNotification(db, messageInput), null);
    const leasedMessage = await leaseNextNotification(db, {
      leaseOwner: "notifier-a",
      now,
      leaseUntil: new Date("2026-08-15T12:05:00Z"),
    });
    assert.equal(
      await leaseNextNotification(db, {
        leaseOwner: "notifier-b",
        now,
        leaseUntil: new Date("2026-08-15T12:05:00Z"),
      }),
      null,
    );
    const sentMessage = await completeNotification(db, {
      id: leasedMessage.id,
      leaseOwner: "notifier-a",
      sentAt: new Date("2026-08-15T12:04:00Z"),
    });
    assert.equal(sentMessage.state, "succeeded");

    const adminId = generateOrderedId();
    await db.insert(schema.adminUsers).values({
      id: adminId,
      identityProviderIssuer: "https://identity.example.test",
      identityProviderSubject: "synthetic-sourcing-admin",
      displayEmail: "sourcing@example.com",
      role: "ADMIN",
    });
    const analysis = await createAnalysisVersion(db, {
      priceCheckId: request.priceCheckId,
      inputRevisionId: request.revisionId,
      engineVersion: "synthetic",
      policyVersion: "synthetic",
      sourceTransactionComponents: {},
      normalizedTransactionComponents: {},
      evidenceCount: 0,
      confidence: "INSUFFICIENT_DATA",
      factorCodes: [],
      deterministicCalculation: {},
      deterministicCalculationDigest: "synthetic-sourcing-analysis",
      reviewState: "HUMAN_REVIEW",
      comparables: [],
    });
    const result = await createApprovedResultVersion(db, {
      priceCheckId: request.priceCheckId,
      analysisId: analysis.id,
      approvedClassification: "INSUFFICIENT_DATA",
      approvedFactorList: [],
      approvedExplanation: "Synthetic sourcing conversion test.",
      disclaimerVersion: "test-v1",
      approvedBy: adminId,
      approvedAt: now,
      renderedContentDigest: "synthetic-sourcing-result",
    });
    const opportunityInput = {
      priceCheckId: request.priceCheckId,
      requesterId: request.requesterId,
      sourceResultId: result.id,
      status: "requested",
    };
    assert.ok(await createSourcingOpportunity(db, opportunityInput));
    assert.equal(await createSourcingOpportunity(db, opportunityInput), null);

    const rolledBackAuditId = generateOrderedId();
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.insert(schema.auditEvents).values({
          id: rolledBackAuditId,
          aggregateType: "price_check",
          aggregateId: request.priceCheckId,
          actorType: "SYSTEM",
          action: "synthetic.rollback",
          correlationId: "synthetic-rollback",
          sanitizedMetadata: {},
        });
        throw new Error("intentional synthetic rollback");
      }),
    );
    const rolledBackRows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.id, rolledBackAuditId));
    assert.equal(rolledBackRows.length, 0);
  });
});

test("Price Check database failure does not require or break the Civilon app", async () => {
  const childEnvironment = { ...process.env };
  delete childEnvironment.NETLIFY_DB_URL;
  delete childEnvironment.NETLIFY_DB_DRIVER;
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ["tests/helpers/price-check-db-unavailable.mjs"],
      { cwd: process.cwd(), env: childEnvironment },
    ),
  );
});
