import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isPreviewResultDeliveryWorkerEnabled } from "../lib/price-check/email/preview-worker.ts";

test("Phase 10 legal pages, acknowledgement and promotion remain controlled", async () => {
  const [privacy, terms, form, validation, repository, header, footer, home, parts, category, sitemap] = await Promise.all([
    readFile("app/privacy-policy/page.tsx", "utf8"),
    readFile("app/terms-of-use/page.tsx", "utf8"),
    readFile("components/PriceCheckForm.tsx", "utf8"),
    readFile("lib/price-check/validation.ts", "utf8"),
    readFile("db/price-check/repositories/request-repository.ts", "utf8"),
    readFile("components/SiteHeader.tsx", "utf8"),
    readFile("components/SiteFooter.tsx", "utf8"),
    readFile("app/page.tsx", "utf8"),
    readFile("app/parts/page.tsx", "utf8"),
    readFile("app/parts/[category]/page.tsx", "utf8"),
    readFile("app/sitemap.ts", "utf8"),
  ]);
  for (const page of [privacy, terms]) {
    assert.doesNotMatch(page, /PENDING COUNSEL REVIEW|Draft for counsel review/i);
    assert.match(page, /Last updated August 16, 2026/);
    assert.match(page, /Civilon LLC/);
    assert.match(page, /375 Sylvan Ave, Suite 23/);
  }
  assert.match(privacy, /automated extraction/i);
  assert.match(terms, /not an appraisal/i);
  assert.match(form, /price-check-legalAcknowledged/);
  assert.match(form, /href="\/privacy-policy"/);
  assert.match(form, /href="\/terms-of-use"/);
  assert.match(validation, /legalAcknowledged/);
  assert.match(repository, /price_check\.legal_acknowledged/);
  assert.match(repository, /privacyVersion/);
  assert.match(repository, /termsVersion/);
  assert.match(header, /isPriceCheckEnabled/);
  assert.match(footer, /privacy-policy/);
  assert.match(footer, /terms-of-use/);
  assert.match(home, /PriceCheckPromotion/);
  assert.match(parts, /PriceCheckPromotion/);
  assert.match(category, /PriceCheckPromotion/);
  assert.match(sitemap, /privacy-policy/);
  assert.match(sitemap, /terms-of-use/);
});

test("Phase 10 analytics remains consent-gated, excludes private routes, and excludes sensitive form data", async () => {
  const [analytics, bootstrap, form, resultAction] = await Promise.all([
    readFile("lib/analytics.ts", "utf8"),
    readFile("components/AnalyticsBootstrap.tsx", "utf8"),
    readFile("components/PriceCheckForm.tsx", "utf8"),
    readFile("components/price-check/ResultSourcingAction.tsx", "utf8"),
  ]);
  for (const event of ["price_check_view", "price_check_start", "price_check_submit", "price_check_upload_started", "price_check_upload_completed", "whatsapp_click", "contact_submit"]) assert.match(analytics, new RegExp(`"${event}"`));
  assert.doesNotMatch(analytics, /"price_check_result_view"|"price_check_quote_request"/);
  assert.match(bootstrap, /NEXT_PUBLIC_ANALYTICS_MODE/);
  assert.match(bootstrap, /civilon:analytics-consent/);
  assert.match(bootstrap, /granted/);
  assert.doesNotMatch(analytics, /part_number|unit_price|business_email|phone_number|tail_number|result_token/);
  assert.match(form, /price_check_upload_started/);
  assert.match(form, /price_check_upload_completed/);
  assert.doesNotMatch(resultAction, /trackCivilonEvent|price_check_quote_request/);
  assert.match(bootstrap, /\/price-check\/result/);
  assert.match(bootstrap, /\/admin\//);
});

test("Phase 10 preview configuration remains explicit and production fails closed", async () => {
  const [extraction, explanation, runbook, legal] = await Promise.all([
    readFile("lib/price-check/extraction/config.ts", "utf8"),
    readFile("lib/price-check/explanation/config.ts", "utf8"),
    readFile("docs/PRICE-CHECK-PRODUCTION-RUNBOOK.md", "utf8"),
    readFile("docs/CIVILON-LEGAL-REVIEW-CHECKLIST.md", "utf8"),
  ]);
  assert.match(extraction, /codex\/civilon-price-check-phase-10/);
  assert.match(explanation, /codex\/civilon-price-check-phase-10/);
  assert.match(extraction, /OPENAI_PRODUCTION_DISABLED/);
  assert.match(explanation, /OPENAI_EXPLANATION_PRODUCTION_DISABLED/);
  assert.match(runbook, /Price Check still false/);
  assert.match(legal, /OWNER\/COUNSEL DECISION REQUIRED/);
});

test("Phase 10 preview result delivery is explicitly allowed and fails closed elsewhere", () => {
  assert.equal(isPreviewResultDeliveryWorkerEnabled({
    CONTEXT: "deploy-preview",
    PRICE_CHECK_PHASE10_PREVIEW_WORKER_ENABLED: "true",
  }), true);
  assert.equal(isPreviewResultDeliveryWorkerEnabled({
    CONTEXT: "deploy-preview",
    PRICE_CHECK_PHASE6_PREVIEW_WORKER_ENABLED: "true",
  }), true);
  assert.equal(isPreviewResultDeliveryWorkerEnabled({
    CONTEXT: "production",
    BRANCH: "main",
    PRICE_CHECK_PHASE10_PREVIEW_WORKER_ENABLED: "true",
  }), false);
  assert.equal(isPreviewResultDeliveryWorkerEnabled({
    CONTEXT: "deploy-preview",
    BRANCH: "codex/civilon-price-check-phase-11",
    PRICE_CHECK_PHASE10_PREVIEW_WORKER_ENABLED: "true",
  }), true);
  assert.equal(isPreviewResultDeliveryWorkerEnabled({
    CONTEXT: "deploy-preview",
    BRANCH: "codex/civilon-price-check-phase-10",
  }), false);
  assert.equal(isPreviewResultDeliveryWorkerEnabled({
    PRICE_CHECK_PHASE10_PREVIEW_WORKER_ENABLED: "true",
  }, "deploy-preview-10--cvlon.netlify.app"), true);
  assert.equal(isPreviewResultDeliveryWorkerEnabled({
    PRICE_CHECK_PHASE10_PREVIEW_WORKER_ENABLED: "true",
  }, "cvlon.com"), false);
});

test("production result delivery runs only from the scheduled production worker after Price Check is enabled", async () => {
  const worker = await readFile("netlify/functions/process-price-check-notifications.ts", "utf8");
  assert.match(worker, /CONTEXT !== "production"/);
  assert.match(worker, /NEXT_PUBLIC_PRICE_CHECK_ENABLED !== "true"/);
  assert.match(worker, /processOneResultNotification/);
  assert.match(worker, /schedule: "\* \* \* \* \*"/);
});
