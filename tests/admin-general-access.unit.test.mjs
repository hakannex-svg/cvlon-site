import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

/**
 * Civilon may close all public intake while staff still need the database
 * records. These assertions pin the boundary: general staff surfaces (sign-in,
 * OIDC, sign-out, access-denied, staff allowlist, operations guide, unified
 * queue) must be reachable with every public product flag off, while the Price
 * Check operational surfaces stay behind the Price Check flag.
 */

const generalSurfaces = {
  "app/admin/login/page.tsx": read("app", "admin", "login", "page.tsx"),
  "app/admin/access-denied/page.tsx": read("app", "admin", "access-denied", "page.tsx"),
  "app/admin/help/page.tsx": read("app", "admin", "help", "page.tsx"),
  "app/admin/staff/page.tsx": read("app", "admin", "staff", "page.tsx"),
  "app/admin/page.tsx": read("app", "admin", "page.tsx"),
  "app/admin/buy-requests/page.tsx": read("app", "admin", "buy-requests", "page.tsx"),
  "app/admin/buy-requests/[id]/page.tsx": read("app", "admin", "buy-requests", "[id]", "page.tsx"),
  "app/admin/sell-submissions/page.tsx": read("app", "admin", "sell-submissions", "page.tsx"),
  "app/admin/sell-submissions/[id]/page.tsx": read("app", "admin", "sell-submissions", "[id]", "page.tsx"),
  "lib/price-check/admin/marketplace-access.ts": read("lib", "price-check", "admin", "marketplace-access.ts"),
  "app/api/admin/auth/google/login/route.ts": read("app", "api", "admin", "auth", "google", "login", "route.ts"),
  "app/api/admin/auth/google/callback/route.ts": read("app", "api", "admin", "auth", "google", "callback", "route.ts"),
  "app/api/admin/auth/logout/route.ts": read("app", "api", "admin", "auth", "logout", "route.ts"),
  "app/api/admin/staff/route.ts": read("app", "api", "admin", "staff", "route.ts"),
};

const priceCheckGated = {
  "app/admin/price-checks/page.tsx": read("app", "admin", "price-checks", "page.tsx"),
  "app/admin/price-checks/[id]/page.tsx": read("app", "admin", "price-checks", "[id]", "page.tsx"),
};

const loginRoute = generalSurfaces["app/api/admin/auth/google/login/route.ts"];
const callbackRoute = generalSurfaces["app/api/admin/auth/google/callback/route.ts"];
const logoutRoute = generalSurfaces["app/api/admin/auth/logout/route.ts"];
const staffApi = generalSurfaces["app/api/admin/staff/route.ts"];

/* ---------------------------------------------------------------- flags off */

test("no general staff surface depends on any public product flag", () => {
  for (const [name, source] of Object.entries(generalSurfaces)) {
    assert.doesNotMatch(source, /isPriceCheckEnabled/, `${name} must not gate on the Price Check flag`);
    assert.doesNotMatch(source, /getPriceCheckAdminAccess/, `${name} must not use the Price Check access guard`);
    assert.doesNotMatch(source, /requireAdminApi/, `${name} must not use the Price Check API guard`);
    assert.doesNotMatch(
      source,
      /isMarketplaceEnabled|isSellSubmissionEnabled|NEXT_PUBLIC_MARKETPLACE_ENABLED|NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED|NEXT_PUBLIC_PRICE_CHECK_ENABLED/,
      `${name} must not read a public product flag`,
    );
  }
});

test("the unified queue reads the Price Check flag only to decide row inclusion", () => {
  const queuePage = read("app", "admin", "queue", "page.tsx");
  assert.doesNotMatch(queuePage, /getPriceCheckAdminAccess/);
  assert.match(queuePage, /const access = await getAdminAccess\(\)/);
  // The single permitted use: Price Check detail is still flag-gated, so its
  // rows are listed only when that page is reachable.
  assert.equal((queuePage.match(/isPriceCheckEnabled\(\)/g) ?? []).length, 1);
  assert.match(queuePage, /includePriceChecks: isPriceCheckEnabled\(\)/);
});

test("sign-in is product independent and lands an authorized user on the unified queue", () => {
  const page = generalSurfaces["app/admin/login/page.tsx"];
  assert.match(page, /const access = await getAdminAccess\(\)/);
  assert.match(page, /if \(access\.status === "authorized"\) redirect\("\/admin\/queue"\)/);
  assert.doesNotMatch(page, /notFound/);
  assert.match(page, /return <AdminLogin \/>/);
});

test("access denied stays reachable with no gate at all", () => {
  const page = generalSurfaces["app/admin/access-denied/page.tsx"];
  assert.doesNotMatch(page, /notFound/);
  assert.match(page, /return <AdminAccessDenied \/>/);
});

/* -------------------------------------------------- OIDC controls unchanged */

test("OIDC login preserves PKCE, state, nonce, cookie and header handling", () => {
  assert.doesNotMatch(loginRoute, /status: 404/);
  assert.match(loginRoute, /const config = getGoogleOidcConfig\(\)/);
  assert.match(loginRoute, /await createGoogleAuthorizationRequest\(config\)/);
  assert.match(loginRoute, /Location: authorization\.url\.toString\(\)/);
  assert.match(loginRoute, /headers\.append\("Set-Cookie", secureCookie\(\s*GOOGLE_OIDC_TRANSACTION_COOKIE,\s*authorization\.transaction,\s*googleOidcTransactionMaxAge,\s*\)\)/);
  assert.match(loginRoute, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(loginRoute, /"X-Robots-Tag": "noindex, nofollow, noarchive"/);
  // Configuration failures still fail closed with a generic 503.
  assert.match(loginRoute, /status: 503/);
  assert.match(loginRoute, /export const dynamic = "force-dynamic"/);
});

test("OIDC callback preserves transaction verification, binding, session and generic failure", () => {
  assert.doesNotMatch(callbackRoute, /if \(!isPriceCheckEnabled\(\)\)/);
  assert.match(callbackRoute, /await verifyGoogleAuthorizationTransaction\(\s*transactionCookie,\s*state,\s*config,\s*\)/);
  assert.match(callbackRoute, /await exchangeGoogleAuthorizationCode\(code, transaction, config\)/);
  assert.match(callbackRoute, /const bootstrapAllowed = isBootstrapAdmin\(identity\.email\)/);
  assert.match(callbackRoute, /adminRepository\.bindOrAuthorizeAdmin\(/);
  assert.match(callbackRoute, /authorization\.status !== "authorized" &&\s*authorization\.status !== "bound" &&\s*authorization\.status !== "rebound"/);
  assert.match(callbackRoute, /sessionRepository\.createAdminSession\(/);
  // Generic, non-enumerating failure path and its cookie clearing are intact.
  assert.match(callbackRoute, /callbackRedirect\(config, "\/admin\/login\?auth=failed", \[\s*clearSecureCookie\(GOOGLE_OIDC_TRANSACTION_COOKIE\),\s*\]\)/);
  assert.match(callbackRoute, /console\.error\("admin_oidc_callback_failed", stage, safeCode\)/);
  assert.match(callbackRoute, /error instanceof GoogleTokenExchangeError\s*\? error\.safeCode\s*: "unexpected"/);
  // Length bounds on the untrusted query parameters are unchanged.
  assert.match(callbackRoute, /code\.length > 4096 \|\| !state \|\| state\.length > 1024/);
  // Private headers on every redirect.
  assert.match(callbackRoute, /"Cache-Control": "private, no-store, max-age=0",\s*"X-Robots-Tag": "noindex, nofollow, noarchive",\s*"Referrer-Policy": "no-referrer",/);
});

test("a successful callback lands on the unified queue with both cookies set", () => {
  assert.match(callbackRoute, /return callbackRedirect\(config, "\/admin\/queue", \[\s*clearSecureCookie\(GOOGLE_OIDC_TRANSACTION_COOKIE\),\s*secureCookie\(ADMIN_SESSION_COOKIE, session\.token, ADMIN_SESSION_TTL_SECONDS\),\s*\]\)/);
  assert.doesNotMatch(callbackRoute, /callbackRedirect\(config, "\/admin\/price-checks"/);
});

test("logout preserves origin checking, revocation, cookie clearing and private headers", () => {
  assert.doesNotMatch(logoutRoute, /isPriceCheckEnabled/);
  assert.doesNotMatch(logoutRoute, /status: 404/);
  assert.match(logoutRoute, /verifyAdminMutationOrigin\(request\)/);
  assert.match(logoutRoute, /await revokeAdminSession\(priceCheckDb, token, config\.sessionSecret\)/);
  assert.match(logoutRoute, /headers\.append\("Set-Cookie", clearSecureCookie\(ADMIN_SESSION_COOKIE\)\)/);
  assert.match(logoutRoute, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(logoutRoute, /status: 204/);
  assert.match(logoutRoute, /error: "Sign out could not be completed\."/);
});

/* ------------------------------------------------ staff allowlist unchanged */

test("the staff API uses the general guard with the same ADMIN-only capability", () => {
  assert.equal((staffApi.match(/requireStaffApi\("manage_staff"\)/g) ?? []).length, 3);
  assert.doesNotMatch(staffApi, /requireAdminApi/);
  // Mutations still origin-check; the read does not need to.
  assert.equal((staffApi.match(/verifyAdminMutationOrigin\(request\)/g) ?? []).length, 2);
  assert.match(staffApi, /accessErrorResponse\(access\.status\)/);
  assert.equal((staffApi.match(/accessErrorResponse\(access\.status\)/g) ?? []).length, 3);
  // Role and action allowlists are untouched.
  assert.match(staffApi, /staffRoles\.includes\(role as typeof staffRoles\[number\]\)/);
  assert.match(staffApi, /\["role", "disable", "enable", "revoke"\]\.includes\(String\(action\)\)/);
  assert.match(staffApi, /repository\.updateStaff\(priceCheckDb, \{ id, action/);
  assert.match(staffApi, /repository\.createPendingStaff\(priceCheckDb, \{ email, role/);
});

test("the staff page keeps its ADMIN-only redirect on the general guard", () => {
  const page = generalSurfaces["app/admin/staff/page.tsx"];
  assert.match(page, /const access = await getAdminAccess\(\)/);
  assert.match(page, /if \(access\.user\.role !== "ADMIN"\) redirect\("\/admin\/access-denied"\)/);
  assert.match(page, /redirect\("\/admin\/login"\)/);
  assert.match(page, /if \(access\.status !== "authorized"\) return <AdminAccessDenied unavailable \/>/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /repository\.listStaff\(priceCheckDb\)/);
});

test("the operations guide is general staff navigation with the same authorization shape", () => {
  const page = generalSurfaces["app/admin/help/page.tsx"];
  assert.match(page, /const access = await getAdminAccess\(\)/);
  assert.match(page, /redirect\("\/admin\/login"\)/);
  assert.match(page, /redirect\("\/admin\/access-denied"\)/);
  assert.match(page, /if \(access\.status !== "authorized"\) return <AdminAccessDenied unavailable \/>/);
  // Content is unchanged: the anchors and the status guidance table remain.
  for (const anchor of ["#workflow", "#page-map", "#roles", "#rules", "#extraction", "#comparables", "#confidence", "#result", "#troubleshooting"]) {
    assert.ok(page.includes(anchor), `help page should still link ${anchor}`);
  }
  assert.match(page, /getPriceCheckWorkflowGuidance\(status, true\)\.nextAction/);
  assert.match(page, /<AdminChrome user=\{access\.user\} active="help">/);
});

/* -------------------------------- Price Check operational surfaces unchanged */

test("Price Check pages remain behind the Price Check access guard", () => {
  for (const [name, source] of Object.entries(priceCheckGated)) {
    assert.match(source, /const access = await getPriceCheckAdminAccess\(\)/, `${name} must keep its Price Check guard`);
    assert.match(source, /if \(access\.status === "disabled"\) notFound\(\)/, `${name} must still 404 when the flag is off`);
  }
});

test("every Price Check operational API remains behind requireAdminApi", () => {
  const routes = [
    ["app", "api", "admin", "price-checks", "[id]", "status", "route.ts"],
    ["app", "api", "admin", "price-checks", "[id]", "assignment", "route.ts"],
    ["app", "api", "admin", "price-checks", "[id]", "revision", "route.ts"],
    ["app", "api", "admin", "price-checks", "[id]", "analysis", "route.ts"],
    ["app", "api", "admin", "price-checks", "[id]", "information-request", "route.ts"],
    ["app", "api", "admin", "price-checks", "[id]", "result", "route.ts"],
    ["app", "api", "admin", "price-checks", "[id]", "result", "approve", "route.ts"],
    ["app", "api", "admin", "price-checks", "[id]", "result", "delivery", "route.ts"],
    ["app", "api", "admin", "price-checks", "[id]", "attachments", "[attachmentId]", "download", "route.ts"],
    ["app", "api", "admin", "observations", "route.ts"],
    ["app", "api", "admin", "part-relationships", "route.ts"],
  ];
  for (const parts of routes) {
    const source = read(...parts);
    const name = parts.join("/");
    assert.match(source, /requireAdminApi\("/, `${name} must keep requireAdminApi`);
    assert.doesNotMatch(source, /requireStaffApi/, `${name} must not be relaxed to the general guard`);
  }
});

test("the two access guards stay distinct in the auth module", () => {
  const auth = read("lib", "price-check", "admin", "auth.ts");
  assert.match(auth, /export async function getPriceCheckAdminAccess\(\): Promise<AdminAccess> \{\s*if \(!isPriceCheckEnabled\(\)\) return \{ status: "disabled" \};\s*return getAdminAccess\(\);/);
  assert.match(auth, /export async function requireAdminApi\(capability: AdminCapability\) \{\s*const access = await getPriceCheckAdminAccess\(\);/);
  assert.match(auth, /export async function requireStaffApi\(capability: AdminCapability\) \{\s*const access = await getAdminAccess\(\);/);
});
