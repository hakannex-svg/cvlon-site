import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  generateOrderedId,
  generatePublicReference,
} from "../db/price-check/domain/identifiers.ts";
import {
  normalizeEmail,
  normalizePartNumber,
  normalizePhone,
  parseMoney,
  sanitizeAttribution,
  sanitizeDisplayFilename,
  validateCurrencyCode,
} from "../db/price-check/domain/normalization.ts";
import {
  assertPriceCheckTransition,
  canTransitionPriceCheck,
} from "../db/price-check/domain/status-policy.ts";
import { evidenceFixtures, priceCheckFixtures } from "./fixtures/price-check-phase-2.mjs";

test("ordered opaque IDs and public references have separate stable formats", () => {
  const entropy = new Uint8Array(10).fill(7);
  const first = generateOrderedId(1_700_000_000_000, entropy);
  const second = generateOrderedId(1_700_000_000_001, entropy);
  assert.match(first, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(first < second);
  assert.match(
    generatePublicReference(new Uint8Array(7).fill(11)),
    /^PC-[0-9A-HJKMNP-TV-Z]{10}$/,
  );
});

test("normalization helpers are deterministic and do not invent relationships", () => {
  assert.equal(normalizePartNumber("  65-123 / ab  "), "65123AB");
  assert.equal(normalizeEmail(" Buyer@Example.COM "), "buyer@example.com");
  assert.equal(normalizePhone("+1 (202) 555-0198"), "+12025550198");
  assert.equal(validateCurrencyCode("usd"), "USD");
  assert.throws(() => validateCurrencyCode("ZZZ"));
  assert.equal(parseMoney("1200.5"), "1200.50");
  assert.equal(sanitizeDisplayFilename("../quote:<1>.pdf"), "quote--1-.pdf");
  assert.deepEqual(
    sanitizeAttribution({
      landingPage: "https://cvlon.com/price-check?email=hidden",
      referrer: "https://example.com/path?q=hidden",
      utmCampaign: "Test <script>",
    }),
    {
      landingPage: "https://cvlon.com/price-check",
      referrerOrigin: "https://example.com",
      utmSource: null,
      utmMedium: null,
      utmCampaign: "Test script",
      utmContent: null,
      utmTerm: null,
    },
  );
});

test("business status policy rejects arbitrary and job-state transitions", () => {
  assert.equal(canTransitionPriceCheck("submitted", "ready_for_analysis"), true);
  assert.equal(canTransitionPriceCheck("submitted", "sent"), false);
  assert.equal(canTransitionPriceCheck("approved", "human_review"), true);
  assert.throws(() => assertPriceCheckTransition("closed", "submitted"));
});

test("synthetic fixtures cover required Phase 2 transaction and evidence cases", () => {
  assert.equal(priceCheckFixtures.normalOutright.transaction.transactionType, "outright");
  assert.equal(
    priceCheckFixtures.exchangeRefundableCore.transaction.coreDisposition,
    "REFUNDABLE",
  );
  assert.equal(priceCheckFixtures.repair.transaction.transactionType, "repair");
  assert.equal(priceCheckFixtures.aog.transaction.aog, true);
  assert.equal(evidenceFixtures.sparse.length, 1);
  assert.deepEqual(
    evidenceFixtures.mixedCondition.map((item) => item.conditionCode),
    ["NE", "SV", "AR"],
  );
});

test("Price Check database remains server-only and disconnected from public routes", async () => {
  const appFiles = [
    "app/page.tsx",
    "app/about-us/page.tsx",
    "app/aircraft/page.tsx",
    "app/aog-services/page.tsx",
    "app/contact-us/page.tsx",
    "app/parts/page.tsx",
    "app/quality-assurance/page.tsx",
    "app/repair-management/page.tsx",
  ];
  for (const file of appFiles) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /db\/price-check|priceCheckDb|NETLIFY_DB_URL/);
  }
  const adapter = await readFile("db/price-check/index.ts", "utf8");
  assert.match(adapter, /server-boundary/);
  assert.match(adapter, /drizzle-orm\/netlify-db/);
  assert.doesNotMatch(adapter, /getDb/);
});

test("audit repository exposes append only and no mutation API", async () => {
  const auditSource = await readFile(
    "db/price-check/repositories/audit-repository.ts",
    "utf8",
  );
  assert.match(auditSource, /appendAuditEvent/);
  assert.doesNotMatch(auditSource, /updateAuditEvent|deleteAuditEvent/);
});

test("Phase 2 migration defines all 19 tables and no disposable probe", async () => {
  const migrationDirectories = await readdir("netlify/database/migrations");
  assert.ok(migrationDirectories.length >= 1);
  const foundationDirectory = migrationDirectories.find((directory) =>
    directory.includes("chemical_arclight"),
  );
  assert.ok(foundationDirectory);
  const migration = await readFile(
    `netlify/database/migrations/${foundationDirectory}/migration.sql`,
    "utf8",
  );
  assert.equal((migration.match(/CREATE TABLE/g) ?? []).length, 19);
  assert.doesNotMatch(migration, /civilon_db_probe/);
  assert.match(migration, /CREATE TABLE "price_checks"/);
  assert.match(migration, /CREATE TABLE "price_observations"/);
  assert.match(migration, /CREATE TABLE "notification_outbox"/);
});
