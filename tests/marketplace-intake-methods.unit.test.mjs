import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* ---------------------------------------------------------------------------
 * Public intake method handling.
 *
 * The two public intake routes accept POST only. Every other method used to
 * fall through to the framework's generic 405, which carried no `Allow`, no
 * cache policy, no robots directive, no referrer policy and no JSON content
 * type — weaker than every other response those routes can produce.
 *
 * The route modules sit behind a `@/` path alias and cannot be imported here,
 * so these are source-level assertions on the wiring plus runtime assertions on
 * the shared handler the wiring points at. No HTTP request is made.
 * ------------------------------------------------------------------------- */

const {
  INTAKE_METHOD_NOT_ALLOWED_BODY,
  intakeHeadNotAllowed,
  intakeMethodNotAllowed,
} = await import("../lib/marketplace/intake-methods.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), "utf8");
}

const INTAKE_ROUTES = [
  "app/api/marketplace/buy-requests/route.ts",
  "app/api/marketplace/sell-submissions/route.ts",
];

const BODY_METHODS = ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"];

/* -- runtime: the refusal itself ------------------------------------------ */

test("the refusal is a generic JSON 405 that names nothing", async () => {
  const response = intakeMethodNotAllowed();

  assert.equal(response.status, 405);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);

  const body = await response.json();
  assert.deepEqual(body, { ok: false, error: "Method not allowed." });
  assert.deepEqual(body, INTAKE_METHOD_NOT_ALLOWED_BODY);
  // Two keys and no more: nothing about the route, the record, the feature
  // flag or the configuration may ride along in a refusal.
  assert.deepEqual(Object.keys(body).sort(), ["error", "ok"]);
});

test("the refusal carries Allow: POST and nothing wider", () => {
  const headers = intakeMethodNotAllowed().headers;

  assert.equal(headers.get("allow"), "POST");
  // A caller must not be able to read a second permitted method out of this.
  assert.doesNotMatch(headers.get("allow") ?? "", /GET|HEAD|PUT|PATCH|DELETE|OPTIONS/);
});

test("the refusal is private, unindexable and referrer-free", () => {
  const headers = intakeMethodNotAllowed().headers;

  assert.equal(headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal(headers.get("referrer-policy"), "no-referrer");
});

test("the refusal is stricter than the intake routes' own success headers", () => {
  const headers = intakeMethodNotAllowed().headers;

  // The success path sets a bare `no-store` and omits `noarchive`. A refusal
  // may match or exceed that; it may never fall short.
  assert.match(headers.get("cache-control") ?? "", /\bprivate\b/);
  assert.match(headers.get("cache-control") ?? "", /\bno-store\b/);
  assert.match(headers.get("x-robots-tag") ?? "", /\bnoindex\b/);
  assert.match(headers.get("x-robots-tag") ?? "", /\bnofollow\b/);
  assert.match(headers.get("x-robots-tag") ?? "", /\bnoarchive\b/);
});

test("the refusal grants no CORS, so a cross-origin preflight fails", () => {
  const headers = intakeMethodNotAllowed().headers;

  for (const name of [
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-allow-credentials",
    "access-control-max-age",
  ]) {
    assert.equal(headers.get(name), null, `${name} must be absent`);
  }
  // OPTIONS is refused rather than answered, which is what makes a preflight
  // fail rather than succeed.
  assert.equal(intakeMethodNotAllowed().status, 405);
});

test("the HEAD refusal repeats the status and headers with no body", async () => {
  const head = intakeHeadNotAllowed();
  const withBody = intakeMethodNotAllowed();

  assert.equal(head.status, 405);
  assert.equal(head.body, null, "a HEAD response must not carry a body");
  assert.equal(await head.text(), "");

  for (const name of ["allow", "cache-control", "x-robots-tag", "referrer-policy", "content-type"]) {
    assert.equal(head.headers.get(name), withBody.headers.get(name), `${name} must match the JSON refusal`);
  }
});

test("the refusal sets no cookie and mints no session", () => {
  for (const response of [intakeMethodNotAllowed(), intakeHeadNotAllowed()]) {
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("the shared module is inert: no database, storage, flag or request access", () => {
  const text = source("lib/marketplace/intake-methods.ts");

  assert.equal(/^import /m.test(text), false, "the refusal must depend on nothing");
  for (
    const forbidden of [
      /priceCheckDb/,
      /drizzle/,
      /S3/,
      /process\.env/,
      /isMarketplaceEnabled/,
      /isSellSubmissionEnabled/,
    ]
  ) {
    assert.equal(forbidden.test(text), false, `intake-methods.ts must not reference ${forbidden}`);
  }
});

/* -- source: the wiring on both routes ------------------------------------ */

test("both intake routes export every non-POST method as the shared refusal", () => {
  for (const path of INTAKE_ROUTES) {
    const text = source(path);

    assert.match(text, /from "@\/lib\/marketplace\/intake-methods"/, `${path} imports the shared refusal`);
    for (const method of BODY_METHODS) {
      assert.match(
        text,
        new RegExp(`^export const ${method} = intakeMethodNotAllowed;$`, "m"),
        `${path} must export ${method} as the shared refusal`,
      );
    }
    assert.match(
      text,
      /^export const HEAD = intakeHeadNotAllowed;$/m,
      `${path} must export HEAD as the bodyless refusal`,
    );
  }
});

test("neither intake route gained a read, list or search surface", () => {
  for (const path of INTAKE_ROUTES) {
    const text = source(path);

    // The refusals are constant aliases, never handlers with a body of their
    // own — an `async function GET` here would be a place for a read to grow.
    assert.equal(
      /export (async function|function) (GET|HEAD|PUT|PATCH|DELETE|OPTIONS)/.test(text),
      false,
      `${path} must not implement a non-POST handler`,
    );
    for (const forbidden of [/\.select\(/, /listPublic/i, /searchInventory/i, /publicListing/i, /findMany/]) {
      assert.equal(forbidden.test(text), false, `${path} must not carry ${forbidden}`);
    }
  }
});

test("neither refusal reports feature configuration", () => {
  for (const path of INTAKE_ROUTES) {
    const text = source(path);
    const tail = text.slice(text.indexOf("export const GET"));

    // The gate belongs to POST. A method refusal that consulted it would tell
    // an unauthenticated caller whether the marketplace is switched on.
    assert.equal(/isMarketplaceEnabled|isSellSubmissionEnabled/.test(tail), false, path);
    assert.equal(/NEXT_PUBLIC_|process\.env/.test(tail), false, path);
  }
});

/* -- source: POST is untouched -------------------------------------------- */

test("the Buy POST handler keeps its gate, bounds, honeypot and validation", () => {
  const text = source("app/api/marketplace/buy-requests/route.ts");

  assert.match(text, /^export async function POST\(request: Request\) \{$/m);
  assert.match(text, /isMarketplaceEnabled\(\)/);
  assert.match(text, /originAllowed\(request\)/);
  assert.match(text, /BUY_REQUEST_MAX_BODY_BYTES/);
  assert.match(text, /consumeMarketplaceAttempt/);
  assert.match(text, /honeypot/);
  assert.match(text, /validateBuyRequestSubmission/);
  assert.match(text, /submitBuyRequest/);
  assert.match(
    text,
    /return json\(\{ ok: true, reference: result\.reference \}, result\.created \? 201 : 200\);/,
    "the success shape is a bare public reference",
  );
  assert.doesNotMatch(text, /cookies?\.set|Set-Cookie/i);
});

test("the Sell POST handler keeps its gate, bounds and validation", () => {
  const text = source("app/api/marketplace/sell-submissions/route.ts");

  assert.match(text, /^export async function POST\(request: Request\) \{$/m);
  assert.match(text, /isSellSubmissionEnabled\(\)/);
  assert.match(text, /SELL_SUBMISSION_MAX_BODY_BYTES/);
  assert.match(text, /consumeMarketplaceAttempt/);
  assert.match(text, /validateSellSubmission/);
  assert.match(text, /submitSellSubmission/);
});

test("both routes keep exactly one POST handler", () => {
  for (const path of INTAKE_ROUTES) {
    const text = source(path);
    const posts = text.match(/^export (async function|const) POST\b/gm) ?? [];
    assert.equal(posts.length, 1, `${path} must export POST once`);
  }
});
