import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  isInternalReviewState,
  summarizeEvidenceCategories,
} from "../db/price-check/domain/internal-review.ts";
import { validateInternalReview } from "../lib/marketplace/admin/validation.ts";
import { roleCan } from "../lib/price-check/admin/policy.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const schema = read("db", "price-check", "schema.ts");
const migration = read(
  "db", "price-check", "migrations-netlify-archive",
  "20260818120000_internal_review_layer", "migration.sql",
);
const writeRoutes = read("lib", "marketplace", "admin", "write-routes.ts");
const writeRepository = read("db", "price-check", "repositories", "marketplace-write-repository.ts");
const detailRepository = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const actions = read("components", "admin", "MarketplaceDetailActions.tsx");
const evidenceReview = read("components", "admin", "MarketplaceEvidenceReview.tsx");
const shared = read("components", "admin", "MarketplaceShared.tsx");
const sellDetail = read("components", "admin", "SellSubmissionDetail.tsx");

test("internal review vocabulary and strict validation are shared", () => {
  for (const state of ["not_reviewed", "reviewed", "concern"]) {
    assert.equal(isInternalReviewState(state), true);
    assert.deepEqual(validateInternalReview({ state }), { ok: true, data: { state } });
  }
  for (const state of ["verified", "approved", "certified", "", null, 1]) {
    assert.equal(isInternalReviewState(state), false);
    assert.equal(validateInternalReview({ state }).ok, false);
  }
  assert.equal(validateInternalReview({ state: "reviewed", score: 5 }).ok, false);
});

test("evidence summaries are derived from live attachment purposes", () => {
  const at = new Date("2026-08-18T12:00:00Z");
  const summary = summarizeEvidenceCategories([
    { purpose: "INVENTORY_SPREADSHEET", reviewState: "reviewed", deletedAt: null },
    { purpose: "WAREHOUSE_BUSINESS_EVIDENCE", reviewState: "reviewed", deletedAt: null },
    { purpose: "WAREHOUSE_BUSINESS_EVIDENCE", reviewState: "not_reviewed", deletedAt: null },
    { purpose: "CUSTODY_PART_PHOTO", reviewState: "concern", deletedAt: null },
    { purpose: "PART_NUMBER_SERIAL_PHOTO", reviewState: "concern", deletedAt: at },
  ]);
  const byPurpose = Object.fromEntries(summary.map(row => [row.purpose, row]));
  assert.deepEqual(byPurpose.INVENTORY_SPREADSHEET, {
    purpose: "INVENTORY_SPREADSHEET", count: 1, state: "reviewed",
  });
  assert.deepEqual(byPurpose.WAREHOUSE_BUSINESS_EVIDENCE, {
    purpose: "WAREHOUSE_BUSINESS_EVIDENCE", count: 2, state: "not_reviewed",
  });
  assert.deepEqual(byPurpose.CUSTODY_PART_PHOTO, {
    purpose: "CUSTODY_PART_PHOTO", count: 1, state: "concern",
  });
  assert.equal(byPurpose.PART_NUMBER_SERIAL_PHOTO.state, "missing", "deleted evidence does not count");
  assert.equal(byPurpose.RELEASE_SUPPORTING_DOCUMENT.state, "missing");
  assert.equal(byPurpose.OTHER.state, "missing");
});

test("schema and additive migration default historical and future rows safely", () => {
  assert.match(schema, /internalReviewStateEnum = pgEnum\("internal_review_state", \[\s*"not_reviewed",\s*"reviewed",\s*"concern",/);
  assert.match(schema, /businessReviewState: internalReviewStateEnum\("business_review_state"\)[\s\S]*?\.default\("not_reviewed"\)/);
  assert.match(schema, /reviewState: internalReviewStateEnum\("review_state"\)[\s\S]*?\.default\("not_reviewed"\)/);
  assert.match(migration, /CREATE TYPE "internal_review_state" AS ENUM\('not_reviewed', 'reviewed', 'concern'\)/);
  assert.match(migration, /ADD COLUMN "business_review_state"[\s\S]*DEFAULT 'not_reviewed'[\s\S]*NOT NULL/);
  assert.match(migration, /ADD COLUMN "review_state"[\s\S]*DEFAULT 'not_reviewed'[\s\S]*NOT NULL/);
  assert.match(migration, /ON DELETE SET NULL/g);
  assert.doesNotMatch(migration, /UPDATE |DELETE FROM|DROP TABLE|DROP COLUMN/i);
});

test("review authority excludes auditors and is independent of public feature flags", () => {
  assert.equal(roleCan("ANALYST", "review_marketplace"), true);
  assert.equal(roleCan("REVIEWER", "review_marketplace"), true);
  assert.equal(roleCan("ADMIN", "review_marketplace"), true);
  assert.equal(roleCan("AUDITOR", "review_marketplace"), false);
  for (const source of [writeRoutes, writeRepository, actions, evidenceReview]) {
    assert.doesNotMatch(source, /NEXT_PUBLIC_|isPriceCheckEnabled|isMarketplaceEnabled|isSellSubmissionEnabled/);
  }
});

test("all three review routes are POST-only and use the staff review capability", () => {
  const routes = [
    ["buy-requests", "business-review", /createBusinessReviewRoute\("buy_request"\)/],
    ["sell-submissions", "business-review", /createBusinessReviewRoute\("sell_submission"\)/],
    ["sell-submissions", path.join("attachments", "[attachmentId]", "review"), /createAttachmentReviewRoute\(\)/],
  ];
  for (const [aggregate, leaf, binding] of routes) {
    const source = read("app", "api", "admin", "marketplace", aggregate, "[id]", leaf, "route.ts");
    assert.match(source, /export const runtime = "nodejs"/);
    assert.match(source, binding);
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.match(source, new RegExp(`export const ${method} = methodNotAllowed;`));
    }
  }
  assert.equal((writeRoutes.match(/requireStaffApi\("review_marketplace"\)/g) ?? []).length, 2);
  assert.match(writeRoutes, /verifyAdminMutationOrigin\(request\)/);
  assert.match(writeRoutes, /validateInternalReview\(await readJsonBody\(request\)\)/);
});

test("business and attachment review writes are optimistic, transactional and audited", () => {
  assert.match(writeRepository, /export async function setContactBusinessReview/);
  assert.match(writeRepository, /export async function setAttachmentReview/);
  assert.match(writeRepository, /eq\(marketplaceContacts\.businessReviewState, contact\.businessReviewState\)/);
  assert.match(writeRepository, /eq\(marketplaceAttachments\.reviewState, attachment\.reviewState\)/);
  assert.match(writeRepository, /attachment\.scanState !== "CLEAN"/);
  assert.match(writeRepository, /BUY_REQUEST_BUSINESS_REVIEW_CHANGED/);
  assert.match(writeRepository, /SELL_SUBMISSION_BUSINESS_REVIEW_CHANGED/);
  assert.match(writeRepository, /SELL_SUBMISSION_ATTACHMENT_REVIEW_CHANGED/);
  assert.match(writeRepository, /emailVerificationUnchanged: true/);
  assert.match(writeRepository, /input\.state === "not_reviewed" \? null : now/);
  assert.match(writeRepository, /input\.state === "not_reviewed" \? null : input\.actor\.id/);
});

test("admin projections expose reviewer metadata without exposing storage secrets", () => {
  for (const field of [
    "businessReviewState", "businessReviewedAt", "businessReviewedByEmail",
    "reviewState", "reviewedAt", "reviewedByEmail",
  ]) assert.match(detailRepository, new RegExp(field));
  assert.match(detailRepository, /alias\(adminUsers, "marketplace_business_reviewer"\)/);
  assert.match(detailRepository, /alias\(adminUsers, "marketplace_attachment_reviewer"\)/);
  for (const source of [detailRepository, shared, sellDetail]) {
    assert.doesNotMatch(source, /objectKey: marketplaceAttachments|storageProvider: marketplaceAttachments|contentDigest: marketplaceAttachments/);
  }
});

test("admin UI separates email verification, business review and evidence review", () => {
  assert.match(shared, /Contact e-mail verification and Civilon&apos;s internal business review are separate/);
  assert.match(shared, /Internal business review/);
  assert.match(actions, /business-review/);
  assert.match(actions, /This is not certification or regulatory approval/);
  assert.match(sellDetail, /summarizeEvidenceCategories\(detail\.attachments\)/);
  for (const label of ["Missing", "Supplied — not reviewed", "Reviewed", "Concern"]) {
    assert.match(sellDetail, new RegExp(label));
  }
  assert.match(evidenceReview, /credentials: "same-origin"/);
  assert.match(evidenceReview, /attachments\/\$\{attachmentId\}\/review/);
  assert.doesNotMatch(`${actions}\n${evidenceReview}`, /trackCivilonEvent|dataLayer|mailto:|Postmark/i);
});

test("review fields do not enter public marketplace routes", () => {
  const publicRoot = path.join(root, "app", "api", "marketplace");
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(publicRoot);
  const publicApi = files.map(file => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(publicApi, /businessReviewState|businessReviewedAt|businessReviewedByAdminUserId|reviewedByAdminUserId|reviewState/);
});
