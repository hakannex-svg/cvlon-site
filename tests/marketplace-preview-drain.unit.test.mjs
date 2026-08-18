import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MARKETPLACE_PREVIEW_DRAIN_LIMIT,
  MARKETPLACE_PREVIEW_NOTIFICATIONS_FLAG,
  MARKETPLACE_PREVIEW_ORIGIN_VAR,
  isMarketplacePreviewDrainEnabled,
} from "../lib/marketplace/notifications/preview-drain.ts";
import {
  civilonNotificationHandlers,
  marketplaceNotificationHandlers,
  registeredNotificationTypes,
} from "../lib/notifications/registry.ts";
import { adminRoles, marketplaceCapabilities, roleCan } from "../lib/price-check/admin/policy.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const route = read("app", "api", "admin", "marketplace", "notifications", "process", "route.ts");
const drain = read("lib", "marketplace", "notifications", "preview-drain.ts");
const scheduled = read("netlify", "functions", "process-price-check-notifications.ts");
const envExample = read(".env.example");

/**
 * Comment-free source. The forbidden-identifier checks below are about what the
 * route *does*, and its own doc comment legitimately uses words like
 * "recipient" and "token" to explain what it withholds.
 */
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ------------------------------------------------------- handler containment */

test("the marketplace handler list owns the four Buy/Sell types and nothing else", () => {
  const types = marketplaceNotificationHandlers.map((handler) => handler.messageType).sort();
  assert.deepEqual(types, [
    "BUY_REQUEST_INTERNAL_RECEIVED",
    "BUY_REQUEST_VERIFY_EMAIL",
    "SELL_SUBMISSION_INTERNAL_RECEIVED",
    "SELL_SUBMISSION_VERIFY_EMAIL",
  ]);
  assert.equal(types.includes("RESULT_READY"), false);

  // Every marketplace handler is a marketplace handler.
  for (const handler of marketplaceNotificationHandlers) {
    assert.equal(handler.workflow, "marketplace");
    assert.ok(["buy_request", "sell_submission"].includes(handler.aggregateType));
  }
});

test("the shared registry still owns Price Check, so the marketplace drain reserves it", () => {
  const shared = civilonNotificationHandlers.map((handler) => handler.messageType);
  assert.ok(shared.includes("RESULT_READY"));
  // Reserved types are what the orphan-reaping pass excludes. RESULT_READY must
  // be in that set, or a marketplace drain could dead-letter a Price Check row.
  assert.ok(registeredNotificationTypes().includes("RESULT_READY"));
  for (const handler of marketplaceNotificationHandlers) {
    assert.ok(shared.includes(handler.messageType));
  }
  // The shared list is exactly Price Check plus the marketplace list.
  assert.equal(shared.length, marketplaceNotificationHandlers.length + 1);
});

/* --------------------------------------------------------------- preview gate */

test("the preview drain gate requires all three conditions and fails closed", () => {
  const open = {
    CONTEXT: "deploy-preview",
    [MARKETPLACE_PREVIEW_NOTIFICATIONS_FLAG]: "true",
    NEXT_PUBLIC_MARKETPLACE_ENABLED: "true",
  };
  assert.equal(isMarketplacePreviewDrainEnabled(open), true);
  assert.equal(isMarketplacePreviewDrainEnabled({ ...open, CONTEXT: "branch-deploy" }), true);
  assert.equal(isMarketplacePreviewDrainEnabled({ ...open, CONTEXT: "production" }), false);

  // With no CONTEXT and no explicit preview origin there is no proof of
  // non-production, so the gate stays shut — an omitted variable never opens it.
  const withoutContext = { ...open };
  delete withoutContext.CONTEXT;
  assert.equal(isMarketplacePreviewDrainEnabled(withoutContext), false);
  assert.equal(isMarketplacePreviewDrainEnabled({ ...open, CONTEXT: "" }), false);
  assert.equal(isMarketplacePreviewDrainEnabled({ ...open, CONTEXT: "   " }), false);

  // The flag is the literal "true" and nothing else.
  for (const value of [undefined, "", "false", "TRUE", "1", "yes"]) {
    assert.equal(
      isMarketplacePreviewDrainEnabled({ ...open, [MARKETPLACE_PREVIEW_NOTIFICATIONS_FLAG]: value }),
      false,
      `the flag must not open on ${JSON.stringify(value)}`,
    );
  }

  // Marketplace intake itself must be on.
  assert.equal(
    isMarketplacePreviewDrainEnabled({ ...open, NEXT_PUBLIC_MARKETPLACE_ENABLED: "false" }),
    false,
  );
  assert.equal(isMarketplacePreviewDrainEnabled({}), false);
});

/**
 * Netlify's serverless runtime carries no CONTEXT, so the live preview takes
 * this path exclusively. It is the one the architectural law is about: the
 * substitute proof of non-production must be at least as hard to satisfy by
 * accident as the CONTEXT it replaces.
 */
test("without CONTEXT the gate demands an explicit Civilon deploy-preview origin", () => {
  const base = {
    [MARKETPLACE_PREVIEW_NOTIFICATIONS_FLAG]: "true",
    NEXT_PUBLIC_MARKETPLACE_ENABLED: "true",
  };
  const withOrigin = (origin) => ({ ...base, [MARKETPLACE_PREVIEW_ORIGIN_VAR]: origin });

  // The live shape: branch-scoped origin, no CONTEXT in the function runtime.
  assert.equal(
    isMarketplacePreviewDrainEnabled(withOrigin("https://deploy-preview-20--cvlon.netlify.app")),
    true,
  );
  // A trailing path, or whitespace around the value, does not defeat the check.
  assert.equal(isMarketplacePreviewDrainEnabled(withOrigin("https://deploy-preview-20--cvlon.netlify.app/")), true);
  assert.equal(isMarketplacePreviewDrainEnabled(withOrigin("  https://deploy-preview-20--cvlon.netlify.app  ")), true);

  // Everything that is production, is not Civilon, or is not a URL at all.
  for (const origin of [
    undefined,
    "",
    "   ",
    "https://cvlon.com",
    "https://www.cvlon.com",
    "https://cvlon.netlify.app",
    "http://deploy-preview-20--cvlon.netlify.app",
    "https://--cvlon.netlify.app",
    // A branch-deploy alias is not a Deploy Preview: it names a branch, not a
    // pull request, so it is not the identity this endpoint is scoped to.
    "https://codex-civilon-fast-track-phase-1--cvlon.netlify.app",
    "https://deploy-preview-0--cvlon.netlify.app",
    "https://deploy-preview-x--cvlon.netlify.app",
    "https://deploy-preview-20--attacker.netlify.app",
    "https://attacker.netlify.app",
    "https://deploy-preview-20--cvlon.netlify.app.attacker.example",
    "deploy-preview-20--cvlon.netlify.app",
    "not-a-url",
    "//deploy-preview-20--cvlon.netlify.app",
  ]) {
    assert.equal(
      isMarketplacePreviewDrainEnabled(withOrigin(origin)),
      false,
      `the gate must not open on ${JSON.stringify(origin)}`,
    );
  }

  // An explicit production CONTEXT still wins over a valid preview origin: the
  // origin is a fallback for an unavailable CONTEXT, never an override of one.
  assert.equal(
    isMarketplacePreviewDrainEnabled({
      ...withOrigin("https://deploy-preview-20--cvlon.netlify.app"),
      CONTEXT: "production",
    }),
    false,
  );

  // The other two conditions are unchanged by the new path.
  for (const override of [
    { [MARKETPLACE_PREVIEW_NOTIFICATIONS_FLAG]: "false" },
    { [MARKETPLACE_PREVIEW_NOTIFICATIONS_FLAG]: undefined },
    { NEXT_PUBLIC_MARKETPLACE_ENABLED: "false" },
    { NEXT_PUBLIC_MARKETPLACE_ENABLED: undefined },
  ]) {
    assert.equal(
      isMarketplacePreviewDrainEnabled({
        ...withOrigin("https://deploy-preview-20--cvlon.netlify.app"),
        ...override,
      }),
      false,
      `a valid preview origin must not substitute for ${Object.keys(override)[0]}`,
    );
  }
});

test("the drain ceiling is ten and is a hard cap, not a default", () => {
  assert.equal(MARKETPLACE_PREVIEW_DRAIN_LIMIT, 10);
  // The clamp is in the module, not only in the caller.
  assert.match(drain, /Math\.min\(options\.limit \?\? MARKETPLACE_PREVIEW_DRAIN_LIMIT, MARKETPLACE_PREVIEW_DRAIN_LIMIT\)/);
});

/* ------------------------------------------------------------------ authority */

test("processing notifications is an ADMIN-only capability", () => {
  assert.ok(marketplaceCapabilities.includes("process_marketplace_notifications"));
  for (const role of adminRoles) {
    assert.equal(
      roleCan(role, "process_marketplace_notifications"),
      role === "ADMIN",
      `${role} must ${role === "ADMIN" ? "hold" : "not hold"} process_marketplace_notifications`,
    );
  }
  // It is a genuinely new authority, not an alias of an existing one.
  assert.equal(roleCan("REVIEWER", "process_marketplace_notifications"), false);
  assert.equal(roleCan("AUDITOR", "process_marketplace_notifications"), false);
});

/* --------------------------------------------------------------------- route */

test("the process route is POST-only, staff-gated, origin-checked and preview-gated", () => {
  assert.match(route, /requireStaffApi\("process_marketplace_notifications"\)/);
  assert.match(route, /verifyAdminMutationOrigin\(request\)/);
  assert.match(route, /isMarketplacePreviewDrainEnabled\(\)/);

  // Authorization is decided before configuration is consulted, so the 404 can
  // never double as a configuration probe for an anonymous caller.
  assert.ok(
    route.indexOf("requireStaffApi") < route.indexOf("isMarketplacePreviewDrainEnabled()"),
    "the capability check must run before the preview gate",
  );

  // A closed gate is a 404, not a 503 and not a hint.
  assert.match(route, /error: "Not found\." \}, 404/);

  // Every non-POST verb is refused with an allowlist.
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    assert.match(
      route,
      new RegExp(`export const ${method} = methodNotAllowed;`),
      `${method} must be refused`,
    );
  }
  assert.equal(/export (async )?function GET/.test(route), false, "there is no readable GET handler");
  assert.match(route, /headers\.set\("Allow", "POST"\)/);

  // Private headers on every answer, including the refusals.
  for (const header of [
    /Cache-Control", "private, no-store, max-age=0"/,
    /X-Robots-Tag", "noindex, nofollow, noarchive"/,
    /Referrer-Policy", "no-referrer"/,
    /Vary", "Cookie"/,
  ]) {
    assert.match(route, header);
  }
});

test("the route answers with counts and never narrates a failure or a recipient", () => {
  // The success body is the drain summary spread verbatim; the summary type is
  // counts only, and the integration suite proves that at runtime.
  assert.match(route, /privateJson\(\{ ok: true, \.\.\.summary \}\)/);

  const code = stripComments(route);
  for (const forbidden of [
    /notificationId/,
    /providerMessageId/,
    /aggregateId/,
    /recipient/i,
    /businessEmail/,
    /token/i,
    /error instanceof Error/,
    /error\.message/,
    /console\.(log|error|warn)/,
  ]) {
    assert.equal(forbidden.test(code), false, `the route must not carry ${forbidden}`);
  }
});

/* ------------------------------------------- the production schedule is intact */

test("the scheduled production drain still refuses every non-production context", () => {
  // Unchanged shape: an explicit non-production CONTEXT returns 204 before any
  // work, so adding the manual route did not open an automatic preview run.
  assert.match(scheduled, /process\.env\.CONTEXT && process\.env\.CONTEXT !== "production"/);
  assert.match(scheduled, /return new Response\(null, \{ status: 204 \}\)/);
  // The manual preview flag has no influence over the schedule.
  assert.equal(scheduled.includes("MARKETPLACE_PREVIEW_NOTIFICATIONS_ENABLED"), false);
  assert.equal(scheduled.includes("preview-drain"), false);
});

test("the preview flag is documented and ships disabled", () => {
  assert.match(envExample, /^MARKETPLACE_PREVIEW_NOTIFICATIONS_ENABLED=false$/m);
  assert.match(envExample, /ADMIN/);
  // The preview origin ships blank, so a deploy that copies the example cannot
  // inherit an address for a preview it is not.
  assert.match(envExample, /^MARKETPLACE_PREVIEW_ORIGIN=$/m);
  assert.match(envExample, /branch-scoped/);
});
