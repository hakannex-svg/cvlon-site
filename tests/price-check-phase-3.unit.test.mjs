import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  conditionCodes,
  currencyCodes,
  documentationCodes,
  PRICE_CHECK_MAX_BODY_BYTES,
} from "../lib/price-check/contract.ts";
import { isPriceCheckEnabled } from "../lib/price-check/feature.ts";
import {
  consumePriceCheckAttempt,
  rateLimitKey,
  resetPriceCheckRateLimitForTests,
} from "../lib/price-check/rate-limit.ts";
import { submitPriceCheck } from "../lib/price-check/submission-service.ts";
import { validatePriceCheckSubmission } from "../lib/price-check/validation.ts";

const validPayload = (overrides = {}) => ({
  idempotencyKey: "e8c09f22-6195-4d07-b6b1-f523d62a21b7",
  partNumber: " TEST-OUTRIGHT-001 ",
  quantity: "1",
  quoteOrPurchased: "quote",
  transactionType: "outright",
  conditionCode: "SV",
  unitPrice: "1250.50",
  currencyCode: "USD",
  aog: false,
  description: "Synthetic test component",
  aircraftModel: "Challenger 605",
  coreCharge: "",
  coreDisposition: "",
  exchangeFee: "",
  freight: "75",
  transactionDate: "2026-08-15",
  warrantyValue: "12",
  warrantyUnit: "MONTHS",
  warrantyText: "Synthetic stated warranty",
  documentationCodes: ["FAA_8130_3", "TEST_REPORT"],
  documentationOther: "",
  notes: "Synthetic Phase 3 request",
  firstName: "Casey",
  lastName: "Buyer",
  companyName: "Example Aviation Test",
  businessEmail: "CASEY@EXAMPLE.COM",
  phone: "",
  role: "Buyer",
  country: "us",
  serviceAcknowledged: true,
  legalAcknowledged: true,
  sourcePage: "/price-check",
  landingPage: "https://cvlon.com/price-check?email=private@example.com",
  referrer: "https://search.example/path?q=private",
  utmSource: "Synthetic <source>",
  utmMedium: "test",
  utmCampaign: "phase-3",
  utmContent: "manual-entry",
  utmTerm: "aircraft parts",
  website: "",
  ...overrides,
});

test("feature flag is disabled unless explicitly true", () => {
  const previous = process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED;
    assert.equal(isPriceCheckEnabled(), false);
    process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED = "false";
    assert.equal(isPriceCheckEnabled(), false);
    process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED = "true";
    assert.equal(isPriceCheckEnabled(), true);
    process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED = "TRUE";
    assert.equal(isPriceCheckEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED;
    else process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED = previous;
  }
});

test("valid submission is normalized to the Phase 2 controlled contract", () => {
  const result = validatePriceCheckSubmission(validPayload());
  assert.equal(result.success, true);
  assert.equal(result.data.partNumber, "TEST-OUTRIGHT-001");
  assert.equal(result.data.unitPrice, "1250.50");
  assert.equal(result.data.freight, "75.00");
  assert.equal(result.data.businessEmail, "CASEY@EXAMPLE.COM");
  assert.equal(result.data.country, "US");
  assert.equal(result.data.landingPage, "https://cvlon.com/price-check");
  assert.equal(result.data.referrer, "https://search.example");
  assert.equal(result.data.utmSource, "Synthetic source");
  assert.deepEqual(result.data.documentationCodes, ["FAA_8130_3", "TEST_REPORT"]);
});

test("currency, condition, and documentation values exactly match Phase 2", () => {
  assert.deepEqual(currencyCodes, ["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "USD"]);
  assert.deepEqual(conditionCodes, ["NE", "NS", "OH", "SV", "AR", "NOT_SURE"]);
  assert.deepEqual(documentationCodes, [
    "FAA_8130_3", "EASA_FORM_1", "DUAL_RELEASE", "OEM_MANUFACTURER_COC",
    "MATERIAL_CERTIFICATION", "REMOVAL_RECORDS", "TEARDOWN_EVALUATION_REPORT",
    "TEST_REPORT", "OTHER", "NOT_SURE",
  ]);
});

test("authoritative validation rejects every required Phase 3 error class", () => {
  const cases = [
    ["invalid part number", { partNumber: "<script>" }, "partNumber"],
    ["zero quantity", { quantity: "0" }, "quantity"],
    ["oversized quantity", { quantity: "1000000000" }, "quantity"],
    ["negative amount", { unitPrice: "-1" }, "unitPrice"],
    ["unsupported currency", { currencyCode: "ZZZ" }, "currencyCode"],
    ["invalid email", { businessEmail: "not-an-email" }, "businessEmail"],
    ["AOG without phone", { aog: true, phone: "" }, "phone"],
    ["tampered enum", { transactionType: "lease" }, "transactionType"],
    ["unknown field", { databaseRole: "admin" }, "_form"],
    ["oversized notes", { notes: "x".repeat(2001) }, "notes"],
    ["invalid date", { transactionDate: "2026-02-31" }, "transactionDate"],
    ["missing privacy acknowledgment", { serviceAcknowledged: false }, "serviceAcknowledged"],
    ["missing legal acknowledgment", { legalAcknowledged: false }, "legalAcknowledged"],
    ["invalid documentation", { documentationCodes: ["FAA_8130_3", "INVENTED"] }, "documentationCodes"],
    ["Other without explanation", { documentationCodes: ["OTHER"] }, "documentationOther"],
  ];
  for (const [name, override, expectedField] of cases) {
    const result = validatePriceCheckSubmission(validPayload(override));
    assert.equal(result.success, false, name);
    assert.ok(result.fieldErrors[expectedField], name);
  }
});

test("exchange values persist separately while non-exchange core values are discarded", () => {
  const exchange = validatePriceCheckSubmission(validPayload({
    transactionType: "exchange",
    coreCharge: "2500",
    coreDisposition: "REFUNDABLE",
    exchangeFee: "350.25",
  }));
  assert.equal(exchange.success, true);
  assert.equal(exchange.data.coreCharge, "2500.00");
  assert.equal(exchange.data.coreDisposition, "REFUNDABLE");
  assert.equal(exchange.data.exchangeFee, "350.25");

  const outright = validatePriceCheckSubmission(validPayload({
    transactionType: "outright",
    coreCharge: "2500",
    coreDisposition: "REFUNDABLE",
    exchangeFee: "350.25",
  }));
  assert.equal(outright.success, true);
  assert.equal(outright.data.coreCharge, null);
  assert.equal(outright.data.coreDisposition, null);
  assert.equal(outright.data.exchangeFee, null);
});

test("public reference collisions retry and idempotent retries return the accepted reference", async () => {
  const submission = validatePriceCheckSubmission(validPayload()).data;
  const references = ["PC-0000000001", "PC-0000000002"];
  let creates = 0;
  let storedReference = null;
  const dependencies = {
    generateReference: () => references.shift(),
    findByIdempotency: async () => storedReference ? { publicReference: storedReference } : null,
    create: async (_db, input) => {
      creates += 1;
      if (creates === 1) {
        const error = new Error("synthetic unique collision");
        error.code = "23505";
        error.constraint = "price_checks_public_reference_uidx";
        throw error;
      }
      storedReference = input.publicReference;
      return { publicReference: input.publicReference };
    },
  };
  const first = await submitPriceCheck({}, submission, dependencies);
  assert.deepEqual(first, { reference: "PC-0000000002", created: true });
  assert.equal(creates, 2);
  const retry = await submitPriceCheck({}, submission, dependencies);
  assert.deepEqual(retry, { reference: "PC-0000000002", created: false });
  assert.equal(creates, 2);
});

test("rate limiter stores a one-way key and permits five attempts per ten minutes", () => {
  resetPriceCheckRateLimitForTests();
  const key = rateLimitKey("203.0.113.20");
  assert.notEqual(key, "203.0.113.20");
  assert.match(key, /^[0-9a-f]{64}$/);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(consumePriceCheckAttempt(key, 1_000).allowed, true);
  }
  const blocked = consumePriceCheckAttempt(key, 1_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 600);
  assert.equal(consumePriceCheckAttempt(key, 601_001).allowed, true);
});

test("API and analytics boundaries exclude secrets and transaction data", async () => {
  const [route, analytics, component] = await Promise.all([
    readFile("app/api/price-check/submit/route.ts", "utf8"),
    readFile("lib/analytics.ts", "utf8"),
    readFile("components/PriceCheckForm.tsx", "utf8"),
  ]);
  assert.equal(PRICE_CHECK_MAX_BODY_BYTES, 65_536);
  assert.match(route, /PRICE_CHECK_MAX_BODY_BYTES/);
  assert.match(route, /x-nf-client-connection-ip/);
  assert.match(route, /consumePriceCheckAttempt/);
  assert.match(route, /website/);
  assert.doesNotMatch(route, /quick-rfq|Netlify Forms/);
  assert.doesNotMatch(analytics, /part_number|unit_price|business_email|public_reference/);
  assert.match(component, /source_page: "\/price-check"/);
  assert.doesNotMatch(component, /localStorage|sessionStorage/);
});

test("metadata, sitemap, and navigation keep Price Check feature-gated", async () => {
  const [page, sitemap, siteConfig, header, home, css] = await Promise.all([
    readFile("app/price-check/page.tsx", "utf8"),
    readFile("app/sitemap.ts", "utf8"),
    readFile("lib/site-config.ts", "utf8"),
    readFile("components/SiteHeader.tsx", "utf8"),
    readFile("app/page.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);
  assert.match(page, /isPriceCheckEnabled\(\).*notFound/);
  assert.match(page, /"Aircraft Part Price Check"/);
  assert.match(page, /"\/price-check"/);
  assert.match(page, /Before you approve the PO, check the market\./);
  assert.match(sitemap, /isPriceCheckEnabled/);
  assert.doesNotMatch(siteConfig, /price-check/);
  assert.match(header, /priceCheckEnabled/);
  assert.match(home, /PriceCheckPromotion/);
  assert.match(css, /\.pc-disclosure>summary small\{color:#52687a\}/);
  assert.match(css, /\.pc-aog-notice \.button-primary\{background:#0e56a9;color:#fff\}/);
});
