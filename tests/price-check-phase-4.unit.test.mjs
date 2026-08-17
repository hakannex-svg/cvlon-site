import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bootstrapAdminEmails,
  isBootstrapAdmin,
  verifiedGoogleIdentity,
} from "../lib/price-check/admin/identity.ts";
import {
  createGoogleAuthorizationRequest,
  GoogleTokenExchangeError,
  verifyGoogleAuthorizationTransaction,
} from "../lib/price-check/admin/oidc.ts";
import {
  ADMIN_SESSION_COOKIE,
  clearSecureCookie,
  readCookie,
  secureCookie,
} from "../lib/price-check/admin/session.ts";
import {
  adminRoles,
  allowedOperationalStatuses,
  roleCan,
} from "../lib/price-check/admin/policy.ts";
import { validateInformationRequest, validateReviewedTransaction } from "../lib/price-check/admin/validation.ts";
import { canTransitionPriceCheck } from "../db/price-check/domain/status-policy.ts";

const exactBootstrap = "david@cvlon.com,hakannex@gmail.com";
const validIdentity = {
  iss: "https://accounts.google.com",
  sub: "google-subject-hakan",
  email: "HAKANNEX@GMAIL.COM",
  email_verified: true,
  nonce: "expected-nonce",
  amr: ["pwd", "mfa"],
};

const oidcConfig = {
  clientId: "synthetic-client.apps.googleusercontent.com",
  clientSecret: "synthetic-client-secret",
  redirectUri: "https://deploy-preview-4--cvlon.netlify.app/api/admin/auth/google/callback",
  sessionSecret: "synthetic-session-secret-that-is-long-enough-for-testing-only",
};

test("Google token exchange diagnostics expose only allowlisted error codes", () => {
  assert.equal(new GoogleTokenExchangeError("invalid_client").safeCode, "invalid_client");
  assert.equal(new GoogleTokenExchangeError("provider response details").safeCode, "provider_error");
  assert.equal(new GoogleTokenExchangeError("invalid_client").message, "Google token exchange failed.");
});

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

test("verified Google identity requires issuer, subject, verified email, and matching nonce", () => {
  assert.deepEqual(verifiedGoogleIdentity(validIdentity, "expected-nonce"), {
    issuer: "https://accounts.google.com",
    subject: validIdentity.sub,
    email: "hakannex@gmail.com",
    provider: "google-oidc",
    authenticationMethods: ["pwd", "mfa"],
  });
  assert.equal(verifiedGoogleIdentity({ ...validIdentity, iss: "https://attacker.invalid" }, "expected-nonce"), null);
  assert.equal(verifiedGoogleIdentity({ ...validIdentity, sub: "" }, "expected-nonce"), null);
  assert.equal(verifiedGoogleIdentity({ ...validIdentity, email_verified: false }, "expected-nonce"), null);
  assert.equal(verifiedGoogleIdentity(validIdentity, "wrong-nonce"), null);
  assert.equal(verifiedGoogleIdentity({ ...validIdentity, email: "david@cvlon.com" }, "expected-nonce"), null);
  assert.equal(verifiedGoogleIdentity({ ...validIdentity, email: "david@cvlon.com", hd: "cvlon.com" }, "expected-nonce").email, "david@cvlon.com");
});

test("OIDC authorization request uses code flow, PKCE, minimal scopes, and signed state", async () => {
  const authorization = await createGoogleAuthorizationRequest(oidcConfig);
  assert.equal(authorization.url.origin, "https://accounts.google.com");
  assert.equal(authorization.url.searchParams.get("response_type"), "code");
  assert.equal(authorization.url.searchParams.get("scope"), "openid email profile");
  assert.equal(authorization.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.url.searchParams.get("redirect_uri"), oidcConfig.redirectUri);
  assert.ok(authorization.url.searchParams.get("nonce"));
  const state = authorization.url.searchParams.get("state");
  const transaction = await verifyGoogleAuthorizationTransaction(authorization.transaction, state, oidcConfig);
  assert.ok(transaction.codeVerifier.length >= 43);
  await assert.rejects(verifyGoogleAuthorizationTransaction(authorization.transaction, `${state}tampered`, oidcConfig));
});

test("Civilon session cookies are host-only, secure, HTTP-only, and expire explicitly", () => {
  const cookie = secureCookie(ADMIN_SESSION_COOKIE, "synthetic-token", 600);
  assert.match(cookie, /^__Host-cvlon_admin_session=/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=600/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(readCookie(`other=x; ${ADMIN_SESSION_COOKIE}=synthetic-token`, ADMIN_SESSION_COOKIE), "synthetic-token");
  assert.match(clearSecureCookie(ADMIN_SESSION_COOKIE), /Max-Age=0/);
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

test("Phase 5 exposes analysis_ready only through the server-enforced persisted-analysis transition", () => {
  assert.equal(canTransitionPriceCheck("submitted", "needs_information"), true);
  assert.equal(canTransitionPriceCheck("submitted", "ready_for_analysis"), true);
  assert.equal(canTransitionPriceCheck("ready_for_analysis", "analysis_ready"), true);
  assert.equal(allowedOperationalStatuses("ADMIN").includes("analysis_ready"), true);
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

test("admin source boundary uses server OIDC sessions, strict origin checks, no public analytics, and no public bootstrap variable", async () => {
  const [auth, login, callback, logout, urlCleaner, oidc, packageManifest, netlify, sitemap, analytics, queuePage, detailPage, routes] = await Promise.all([
    readFile("lib/price-check/admin/auth.ts", "utf8"),
    readFile("components/admin/AdminLogin.tsx", "utf8"),
    readFile("app/api/admin/auth/google/callback/route.ts", "utf8"),
    readFile("app/api/admin/auth/logout/route.ts", "utf8"),
    readFile("components/admin/AdminAuthUrlCleaner.tsx", "utf8"),
    readFile("lib/price-check/admin/oidc.ts", "utf8"),
    readFile("package.json", "utf8"),
    readFile("netlify.toml", "utf8"),
    readFile("app/sitemap.ts", "utf8"),
    readFile("lib/analytics.ts", "utf8"),
    readFile("app/admin/price-checks/page.tsx", "utf8"),
    readFile("app/admin/price-checks/[id]/page.tsx", "utf8"),
    Promise.all([
      "assignment", "revision", "information-request", "status",
    ].map(name => readFile(`app/api/admin/price-checks/[id]/${name}/route.ts`, "utf8"))),
  ]);
  assert.match(auth, /resolveAdminSession/);
  assert.match(auth, /cookies/);
  assert.match(auth, /origin !== expectedOrigin/);
  assert.doesNotMatch(auth, /getUser|verifyRequestOrigin/);
  assert.doesNotMatch(auth, /NEXT_PUBLIC_PRICE_CHECK_BOOTSTRAP/);
  assert.match(login, /\/api\/admin\/auth\/google\/login/);
  assert.doesNotMatch(login, /@netlify\/identity|oauthLogin|signup\(/);
  assert.match(callback, /verifyGoogleAuthorizationTransaction/);
  assert.match(callback, /exchangeGoogleAuthorizationCode/);
  assert.match(callback, /isBootstrapAdmin/);
  assert.match(callback, /\/admin\/price-checks/);
  assert.match(callback, /Referrer-Policy/);
  assert.match(urlCleaner, /params\.has\("code"\) && params\.has\("state"\)/);
  assert.match(urlCleaner, /history\.replaceState/);
  assert.match(logout, /revokeAdminSession/);
  assert.match(oidc, /openid email profile/);
  assert.match(oidc, /code_challenge_method/);
  assert.match(oidc, /issuer: GOOGLE_ISSUERS/);
  assert.match(oidc, /audience: config\.clientId/);
  assert.doesNotMatch(packageManifest, /@netlify\/identity/);
  assert.match(netlify, /private, no-store/);
  assert.doesNotMatch(sitemap, /admin/);
  assert.doesNotMatch(analytics, /price_check_admin|requester|assignee/);
  assert.match(queuePage, /<a href=\{`\/admin\/price-checks\/\$\{record\.id\}`\}>\{record\.publicReference\}<\/a>/);
  assert.doesNotMatch(queuePage, /<Link href=\{`\/admin\/price-checks\/\$\{record\.id\}`\}>/);
  assert.match(detailPage, /<section className="admin-detail-aside" aria-label="Administration actions">/);
  assert.doesNotMatch(detailPage, /<aside className="admin-detail-aside">/);
  for (const route of routes) {
    assert.match(route, /requireAdminApi/);
    assert.match(route, /verifyAdminMutationOrigin/);
    assert.match(route, /privateJson/);
    assert.doesNotMatch(route, /businessEmail|fake user email|clientRole/);
  }
});
