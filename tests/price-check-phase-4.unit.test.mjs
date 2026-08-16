import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bootstrapAdminEmails,
  isBootstrapAdmin,
  verifiedStaffIdentity,
} from "../lib/price-check/admin/identity.ts";
import {
  adminRoles,
  allowedOperationalStatuses,
  roleCan,
} from "../lib/price-check/admin/policy.ts";
import { validateInformationRequest, validateReviewedTransaction } from "../lib/price-check/admin/validation.ts";
import { canTransitionPriceCheck } from "../db/price-check/domain/status-policy.ts";

const exactBootstrap = "david@cvlon.com,hakannex@gmail.com";
const validIdentity = {
  id: "95c929fd-fb8d-4694-abf2-3049352efd5d",
  email: "HAKANNEX@GMAIL.COM",
  provider: "google",
  confirmedAt: "2026-08-16T04:00:00.000Z",
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

test("verified staff identity requires confirmed server claims and a stable site issuer", () => {
  assert.deepEqual(verifiedStaffIdentity(validIdentity, "civilon-site-id"), {
    issuer: "netlify-identity:civilon-site-id",
    subject: validIdentity.id,
    email: "hakannex@gmail.com",
    provider: "google",
  });
  assert.equal(verifiedStaffIdentity({ ...validIdentity, confirmedAt: undefined }, "civilon-site-id"), null);
  assert.equal(verifiedStaffIdentity(validIdentity, ""), null);
});

test("the signed Netlify login event gate denies every non-Google, wrong, missing, and domain-only identity", async () => {
  const { default: identityEvents } = await import("../netlify/functions/identity.mts");
  const originalInfo = console.info;
  console.info = () => {};
  const run = (provider, email) => {
    let denied = false;
    const event = { user: { provider, email }, deny() { denied = true; } };
    identityEvents.userValidate(event);
    identityEvents.userSignup(event);
    identityEvents.userLogin(event);
    return denied;
  };
  const previous = process.env.PRICE_CHECK_BOOTSTRAP_ADMIN_EMAILS;
  process.env.PRICE_CHECK_BOOTSTRAP_ADMIN_EMAILS = exactBootstrap;
  try {
    assert.equal(run("google", "hakannex@gmail.com"), false);
    assert.equal(run("google", "DAVID@CVLON.COM"), false);
    assert.equal(run("email", "hakannex@gmail.com"), true);
    assert.equal(run("github", "david@cvlon.com"), true);
    assert.equal(run("google", "hakan@shipnex.com"), true);
    assert.equal(run("google", "other@cvlon.com"), true);
    assert.equal(run("google", undefined), true);
  } finally {
    console.info = originalInfo;
    if (previous === undefined) delete process.env.PRICE_CHECK_BOOTSTRAP_ADMIN_EMAILS;
    else process.env.PRICE_CHECK_BOOTSTRAP_ADMIN_EMAILS = previous;
  }
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
  const [auth, login, callback, identityHook, netlify, sitemap, analytics, routes] = await Promise.all([
    readFile("lib/price-check/admin/auth.ts", "utf8"),
    readFile("components/admin/AdminLogin.tsx", "utf8"),
    readFile("components/admin/AdminAuthCallback.tsx", "utf8"),
    readFile("netlify/functions/identity.mts", "utf8"),
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
  assert.match(callback, /\/admin\/price-checks/);
  assert.match(identityHook, /userLogin/);
  assert.match(identityHook, /userSignup/);
  assert.match(identityHook, /userValidate/);
  assert.match(identityHook, /provider !== "google"/);
  assert.match(identityHook, /isBootstrapAdmin/);
  assert.match(identityHook, /event\.deny/);
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
