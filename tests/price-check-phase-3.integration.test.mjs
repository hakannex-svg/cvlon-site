import assert from "node:assert/strict";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

const migrationsDirectory = new URL(
  "../netlify/database/migrations/",
  import.meta.url,
).pathname.replace(/^\/(\w:)/, "$1");

const rawSubmission = (overrides = {}) => ({
  idempotencyKey: "e8c09f22-6195-4d07-b6b1-f523d62a21b7",
  partNumber: " TEST-PHASE3-INTEGRATION-001 ",
  quantity: "1",
  quoteOrPurchased: "quote",
  transactionType: "exchange",
  conditionCode: "OH",
  unitPrice: "4200",
  currencyCode: "USD",
  aog: false,
  description: "Synthetic integration component",
  aircraftModel: "Synthetic airframe",
  coreCharge: "2300",
  coreDisposition: "REFUNDABLE",
  exchangeFee: "225",
  freight: "75",
  transactionDate: "2026-08-15",
  warrantyValue: "12",
  warrantyUnit: "MONTHS",
  warrantyText: "Synthetic warranty",
  documentationCodes: ["FAA_8130_3", "TEST_REPORT"],
  documentationOther: "",
  notes: "Synthetic Phase 3 integration request",
  firstName: "Integration",
  lastName: "Buyer",
  companyName: "Example Aviation Test",
  businessEmail: "integration@example.com",
  phone: "",
  role: "Buyer",
  country: "US",
  serviceAcknowledged: true,
  sourcePage: "/price-check",
  landingPage: "https://cvlon.com/price-check",
  referrer: "https://example.test/source",
  utmSource: "synthetic",
  utmMedium: "integration",
  utmCampaign: "phase-3",
  utmContent: "manual",
  utmTerm: "test",
  website: "",
  ...overrides,
});

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
    await run({ server, db, schema, applied });
    await db.$client.end();
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

test("Phase 3 submission atomically creates the accepted aggregate and retries idempotently", async () => {
  await withDatabase(async ({ db, schema, applied }) => {
    const { eq, sql } = await import("drizzle-orm");
    const { validatePriceCheckSubmission } = await import("../lib/price-check/validation.ts");
    const { submitPriceCheck } = await import("../lib/price-check/submission-service.ts");
    assert.equal(applied.length, 7);

    const validation = validatePriceCheckSubmission(rawSubmission());
    assert.equal(validation.success, true);
    const first = await submitPriceCheck(db, validation.data);
    assert.equal(first.created, true);
    assert.match(first.reference, /^PC-[0-9A-HJKMNP-TV-Z]{10}$/);

    const retry = await submitPriceCheck(db, validation.data);
    assert.deepEqual(retry, { reference: first.reference, created: false });

    const [stored] = await db
      .select()
      .from(schema.priceChecks)
      .where(eq(schema.priceChecks.publicReference, first.reference));
    assert.equal(stored.originalPartNumber, "TEST-PHASE3-INTEGRATION-001");
    assert.equal(stored.normalizedPartNumber, "TESTPHASE3INTEGRATION001");
    assert.equal(stored.coreCharge, "2300.00");
    assert.equal(stored.coreDisposition, "REFUNDABLE");
    assert.equal(stored.exchangeFee, "225.00");
    assert.equal(stored.referrerOrigin, "https://example.test");

    const counts = await Promise.all([
      db.select({ count: sql`count(*)::int` }).from(schema.requesters),
      db.select({ count: sql`count(*)::int` }).from(schema.priceChecks),
      db.select({ count: sql`count(*)::int` }).from(schema.priceCheckRevisions),
      db.select({ count: sql`count(*)::int` }).from(schema.priceCheckDocumentRequirements),
      db.select({ count: sql`count(*)::int` }).from(schema.auditEvents),
    ]);
    assert.deepEqual(counts.map(([row]) => row.count), [1, 1, 1, 2, 1]);
  });
});

test("optional phone and country persist as null for routine requests", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { validatePriceCheckSubmission } = await import("../lib/price-check/validation.ts");
    const { submitPriceCheck } = await import("../lib/price-check/submission-service.ts");
    const validation = validatePriceCheckSubmission(rawSubmission({
      idempotencyKey: "3e48ac6b-c06d-4e8f-b776-3246cfd6a7d7",
      transactionType: "outright",
      coreCharge: "",
      coreDisposition: "",
      exchangeFee: "",
      country: "",
      phone: "",
    }));
    assert.equal(validation.success, true);
    await submitPriceCheck(db, validation.data);
    const [requester] = await db.select().from(schema.requesters);
    assert.equal(requester.phone, null);
    assert.equal(requester.normalizedPhone, null);
    assert.equal(requester.country, null);
    assert.equal(requester.marketingConsentAt, null);
  });
});

test("a late aggregate failure rolls back requester, Price Check, revision, and audit writes", async () => {
  await withDatabase(async ({ db, schema }) => {
    const { sql } = await import("drizzle-orm");
    const { createPriceCheckRequest } = await import(
      "../db/price-check/repositories/request-repository.ts"
    );
    const invalidLateAggregate = {
      requester: {
        firstName: "Rollback",
        lastName: "Test",
        companyName: "Example Aviation Test",
        businessEmail: "rollback@example.com",
        phone: null,
        country: null,
        serviceProcessingAcknowledgedAt: new Date(),
        marketingConsentAt: null,
      },
      transaction: {
        originalPartNumber: "TEST-ROLLBACK-001",
        quantity: "1",
        quoteOrPurchased: "quote",
        transactionType: "outright",
        conditionCode: "SV",
        unitPrice: "100",
        currencyCode: "USD",
        aog: false,
      },
      documentation: [
        { code: "FAA_8130_3" },
        { code: "FAA_8130_3" },
      ],
      attribution: { sourcePage: "/price-check" },
      idempotencyHash: "synthetic-rollback-hash",
      correlationId: "synthetic-rollback-correlation",
    };
    await assert.rejects(createPriceCheckRequest(db, invalidLateAggregate));
    const counts = await Promise.all([
      db.select({ count: sql`count(*)::int` }).from(schema.requesters),
      db.select({ count: sql`count(*)::int` }).from(schema.priceChecks),
      db.select({ count: sql`count(*)::int` }).from(schema.priceCheckRevisions),
      db.select({ count: sql`count(*)::int` }).from(schema.auditEvents),
    ]);
    assert.deepEqual(counts.map(([row]) => row.count), [0, 0, 0, 0]);
  });
});
