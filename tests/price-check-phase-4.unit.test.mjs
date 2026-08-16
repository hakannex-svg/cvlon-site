import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bootstrapAdminEmails,
  GOOGLE_IDENTITY_ISSUER,
  isBootstrapAdmin,
  verifiedStaffIdentity,
} from "../lib/price-check/admin/identity.ts";
import {
  createGoogleAdminSessionToken,
  verifyGoogleAdminSessionToken,
} from "../lib/price-check/admin/session-token.ts";
import {
  adminRoles,
  allowedOperationalStatuses,
  roleCan,
} from "../lib/price-check/admin/policy.ts";
import { validateInformationRequest, validateReviewedTransaction } from "../lib/price-check/admin/validation.ts";
import { canTransitionPriceCheck } from "../db/price-check/domain/status-policy.ts";
import { verifyGoogleProviderToken } from "../lib/price-check/admin/google.ts";

const exactBootstrap = "david@cvlon.com,hakannex@gmail.com";
const validIdentity = {
  id: "95c929fd-fb8d-4694-abf2-3049352efd5d",
  email: "HAKANNEX@GMAIL.COM",
  provider: "google",
  confirmedAt: "2026-08-16T04:00:00.000Z",
};
const validGoogleSession = {
  netlifySubject: validIdentity.id,
  googleSubject: "google-subject-123",
  email: "hakannex@gmail.com",
};

const validRevision = (overrides = {}) => ({
  originalPartNumber: "ABC-123-1",
  description: "Synthetic reviewed component",
  quantity: "1",
  quoteOrPurchased: "quote",
  transactionType: "exchange",
  conditionCode: "OH",
  unitPrice: "4500.00",
  currencyCode: "USD",
  coreCharge: "2500",
  coreDisposition: "REFUNDABLE",
  exchangeFee: "200",
  freight: "75",
  transactionDate: "2026-08-15",
  aircraftModel: "Synthetic aircraft",
  aog: false,
  warrantyValue: "12",
  warrantyUnit: "MONTHS",
  warrantyText: "Synthetic warranty",
  documentationCodes: ["FAA_8130_3", "TEST_REPORT"],
  notes: "Synthetic operational note",
  changeReason: "Customer clarification",
  ...overrides,
});

test("bootstrap authorization is exact-email only and uses the owner-corrected Hakan identity", () => {
  assert.deepEqual([...bootstrapAdminEmails(exactBootstrap)], ["david@cvlon.com", "hakannex@gmail.com"]);
  assert.equal(isBootstrapAdmin("DAVID@CVLON.COM", exactBootstrap), true);
  assert.equal(isBootstrapAdmin("hakannex@gmail.com", exactBootstrap), true);
  assert.equal(isBootstrapAdmin("hakan@shipnex.com", exactBootstrap), false);
  assert.equal(isBootstrapAdmin("other@cvlon.com", exactBootstrap), false);
  assert.equal(isBootstrapAdmin("other@gmail.com", exactBootstrap), false);
});

test("verified staff identity requires a confirmed Netlify user and matching server-verified Google session", () => {
  assert.deepEqual(verifiedStaffIdentity(validIdentity, validGoogleSession), {
    issuer: GOOGLE_IDENTITY_ISSUER,
    subject: validGoogleSession.googleSubject,
    email: "hakannex@gmail.com",
    provider: "google",
  });
  assert.equal(verifiedStaffIdentity({ ...validIdentity, confirmedAt: undefined }, validGoogleSession), null);
  assert.equal(verifiedStaffIdentity(validIdentity, { ...validGoogleSession, netlifySubject: "other" }), null);
  assert.equal(verifiedStaffIdentity(validIdentity, { ...validGoogleSession, email: "other@gmail.com" }), null);
  assert.equal(verifiedStaffIdentity(validIdentity, null), null);
});

test("Google admin session tokens are signed, bounded, identity-specific, and expire", () => {
  const secret = "a".repeat(48);
  const now = Date.parse("2026-08-16T04:00:00.000Z");
  const token = createGoogleAdminSessionToken(validGoogleSession, now, secret);
  assert.deepEqual(verifyGoogleAdminSessionToken(token, now + 1_000, secret), {
    ...validGoogleSession,
    issuedAt: Math.floor(now / 1000),
    expiresAt: Math.floor(now / 1000) + 8 * 60 * 60,
  });
  assert.equal(verifyGoogleAdminSessionToken(`${token}x`, now, secret), null);
  assert.equal(verifyGoogleAdminSessionToken(token, now + 9 * 60 * 60 * 1000, secret), null);
  assert.equal(verifyGoogleAdminSessionToken(token, now, "b".repeat(48)), null);
});

test("Google provider proof requires immutable subject, exact verified email, and a successful UserInfo response", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer synthetic-provider-token");
    return Response.json({ sub: "google-subject-123", email: "HAKANNEX@GMAIL.COM", email_verified: true });
  };
  assert.deepEqual(await verifyGoogleProviderToken("synthetic-provider-token"), {
    subject: "google-subject-123",
    email: "hakannex@gmail.com",
  });
  globalThis.fetch = async () => Response.json({ sub: "google-subject-123", email: "hakannex@gmail.com", email_verified: false });
  assert.equal(await verifyGoogleProviderToken("synthetic-provider-token"), null);
  globalThis.fetch = async () => new Response(null, { status: 401 });
  assert.equal(await verifyGoogleProviderToken("synthetic-provider-token"), null);
});

test("RBAC matrix is deny-by-default and preserves auditor read-only access", () => {
  assert.deepEqual(adminRoles, ["ANALYST", "REVIEWER", "ADMIN", "AUDITOR"]);
  assert.equal(roleCan("ANALYST", "revise"), true);
  assert.equal(roleCan("ANALYST", "assign_any"), false);
  assert.equal(roleCan("REVIEWER", "request_information"), true);
  assert.equal(roleCan("ADMIN", "manage_staff"), true);
  assert.equal(roleCan("AUDITOR", "view"), true);
  assert.equal(roleCan("AUDITOR", "transition"), false);
  assert.deepEqual(allowedOperationalStatuses("AUDITOR"), []);
  assert.ok(allowedOperationalStatuses("ADMIN").includes("spam"));
});

test("Phase 4 enables the approved submitted-to-needs-information transition without faking analysis", () => {
  assert.equal(canTransitionPriceCheck("submitted", "needs_information"), true);
  assert.equal(canTransitionPriceCheck("submitted", "ready_for_analysis"), true);
  assert.equal(canTransitionPriceCheck("ready_for_analysis", "analysis_ready"), true);
  assert.equal(allowedOperationalStatuses("ADMIN").includes("analysis_ready"), false);
});

test("reviewed transaction validation is strict, bounded, normalized, and rejects arbitrary fields", () => {
  const valid = validateReviewedTransaction(validRevision());
  assert.equal(valid.success, true);
  assert.equal(valid.data.originalPartNumber, "ABC-123-1");
  assert.equal(valid.data.coreDisposition, "REFUNDABLE");
  for (const [name, override, field] of [
    ["unknown role", { role: "ADMIN" }, "_form"],
    ["bad currency", { currencyCode: "ZZZ" }, "currencyCode"],
    ["negative price", { unitPrice: "-1" }, "unitPrice"],
    ["bad enum", { transactionType: "lease" }, "transactionType"],
    ["missing reason", { changeReason: "" }, "changeReason"],
    ["bad documentation", { documentationCodes: ["INVENTED"] }, "documentationCodes"],
  ]) {
    const result = validateReviewedTransaction(validRevision(override));
    assert.equal(result.success, false, name);
    assert.ok(result.errors[field], name);
  }
});

test("information request requires controlled state data and does not claim delivery", () => {
  assert.equal(validateInformationRequest({ category: "Documentation", customerNote: "Please clarify release documentation.", internalNote: "Synthetic note" }).success, true);
  assert.equal(validateInformationRequest({ category: "", customerNote: "" }).success, false);
  assert.equal(validateInformationRequest({ category: "Documentation", customerNote: "Clarify.", emailSent: true }).success, false);
});

test("admin source boundary uses server Identity, origin checks, no public analytics, and no public bootstrap variable", async () => {
  const [auth, login, callback, googleSession, netlify, sitemap, analytics, routes] = await Promise.all([
    readFile("lib/price-check/admin/auth.ts", "utf8"),
    readFile("components/admin/AdminLogin.tsx", "utf8"),
    readFile("components/admin/AdminAuthCallback.tsx", "utf8"),
    readFile("app/api/admin/auth/google-session/route.ts", "utf8"),
    readFile("netlify.toml", "utf8"),
    readFile("app/sitemap.ts", "utf8"),
    readFile("lib/analytics.ts", "utf8"),
    Promise.all([
      "assignment", "revision", "information-request", "status",
    ].map(name => readFile(`app/api/admin/price-checks/[id]/${name}/route.ts`, "utf8"))),
  ]);
  assert.match(auth, /getUser/);
  assert.match(auth, /verifiedStaffIdentity/);
  assert.match(auth, /verifyRequestOrigin/);
  assert.doesNotMatch(auth, /NEXT_PUBLIC_PRICE_CHECK_BOOTSTRAP/);
  assert.match(login, /oauthLogin\("google"\)/);
  assert.doesNotMatch(login, /signup\(|login\(/);
  assert.match(callback, /handleAuthCallback/);
  assert.match(callback, /params\.get\("access_token"\)/);
  assert.match(callback, /provider_token/);
  assert.match(callback, /\/admin\/price-checks/);
  assert.match(googleSession, /verifyGoogleProviderToken/);
  assert.match(googleSession, /isBootstrapAdmin/);
  assert.match(googleSession, /bindOrAuthorizeAdmin/);
  assert.match(googleSession, /googleAdminSessionCookie/);
  assert.match(netlify, /private, no-store/);
  assert.doesNotMatch(sitemap, /admin/);
  assert.doesNotMatch(analytics, /price_check_admin|requester|assignee/);
  for (const route of routes) {
    assert.match(route, /requireAdminApi/);
    assert.match(route, /verifyAdminMutationOrigin/);
    assert.match(route, /privateJson/);
    assert.doesNotMatch(route, /businessEmail|fake user email|clientRole/);
  }
});
