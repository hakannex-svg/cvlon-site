import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import { createResultSession, deriveResultToken, hashResultToken, newTokenNonce, verifyResultSession } from "../db/price-check/domain/customer-result.ts";
import { parseResultDraftInput } from "../lib/price-check/admin/result-validation.ts";
import { roleCan } from "../lib/price-check/admin/policy.ts";
import { resultReadyEmail } from "../lib/price-check/email/result-ready.ts";

const key = "phase6-test-key-that-is-at-least-thirty-two-characters";

test("result credentials use 256-bit randomness, keyed lookup, and narrow signed sessions", () => {
  const nonce = newTokenNonce();
  assert.match(nonce, /^[a-f0-9]{64}$/);
  const token = deriveResultToken(key, nonce);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(hashResultToken(key, token), token);
  const value = createResultSession(key, { resultId: "01M05B7JBET8B0X5M29B3AZZ7V", tokenId: "01M05B7JC3PPN3DPTT4AN7W2ZQ", expiresAt: 2_000_000 });
  assert.equal(verifyResultSession(key, value, 1_000_000)?.resultId, "01M05B7JBET8B0X5M29B3AZZ7V");
  assert.equal(verifyResultSession(key, `${value}x`, 1_000_000), null);
  assert.equal(verifyResultSession(key, value, 2_000_001), null);
});

test("result drafting accepts editable policy only and rejects forged facts", () => {
  const valid = parseResultDraftInput({ analysisId: "01M05B7JBET8B0X5M29B3AZZ7V", explanation: "A human reviewer compared the submitted price with the approved observations and transaction context.", factorCodes: ["CONDITION_MIXED"], displayRange: true, displayEvidenceCount: true, limitedEvidenceStatement: null });
  assert.equal(valid.factorCodes[0], "CONDITION_MIXED");
  assert.throws(() => parseResultDraftInput({ ...valid, marketLow: "1.00" }), /Unexpected/);
  assert.throws(() => parseResultDraftInput({ ...valid, classification: "SIGNIFICANTLY_ABOVE" }), /Unexpected/);
  assert.throws(() => parseResultDraftInput({ ...valid, factorCodes: ["SUPPLIER_MARGIN"] }), /factors/);
});

test("reviewer approval and sending are explicit capabilities", () => {
  assert.equal(roleCan("ANALYST", "draft_result"), true);
  assert.equal(roleCan("ANALYST", "approve_result"), false);
  assert.equal(roleCan("REVIEWER", "approve_result"), true);
  assert.equal(roleCan("ADMIN", "send_result"), true);
  assert.equal(roleCan("AUDITOR", "draft_result"), false);
});

test("result-ready email is multipart, privacy-minimized, and contains the secure link", () => {
  const email = resultReadyEmail({ from: "Civilon Price Check <pricecheck@cvlon.com>", to: "synthetic@example.com", reference: "PC-0123456789", secureUrl: "https://deploy-preview-6--cvlon.netlify.app/price-check/result/redeem?token=opaque", expiresAt: new Date("2026-08-30T00:00:00Z") });
  assert.match(email.subject, /^Your Civilon Price Check is ready — PC-/);
  assert.match(email.textBody, /opaque/);
  assert.match(email.htmlBody, /View result/);
  for (const forbidden of ["SYN-SV-100", "$1,175", "supplier", "aircraft"]) assert.doesNotMatch(email.subject.toLowerCase(), new RegExp(forbidden.toLowerCase().replace("$", "\\$")));
});

test("private result routes carry cache, robots, and referrer protections", () => {
  const netlify = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../app/price-check/result/page.tsx", import.meta.url), "utf8");
  assert.match(netlify, /\/price-check\/result\*/);
  assert.match(netlify, /private, no-store/);
  assert.match(netlify, /noindex, nofollow/);
  assert.match(netlify, /no-referrer/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
});

test("Phase 6 remains manual and contains no OpenAI or upload implementation", () => {
  const files = ["../db/price-check/domain/customer-result.ts", "../db/price-check/repositories/result-delivery-repository.ts", "../components/admin/AdminResultWorkspace.tsx", "../app/price-check/result/page.tsx"].map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(files, /openai|prompt|generated explanation|object storage|malware/i);
  assert.match(files, /Human written|approvedExplanation/);
});

test("private result and redemption routes are absent from sitemap and navigation", () => {
  const sitemap = fs.readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
  const siteConfig = fs.readFileSync(new URL("../lib/site-config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(sitemap, /price-check\/result/);
  assert.doesNotMatch(siteConfig, /price-check\/result/);
});
