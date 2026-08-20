import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MARKETPLACE_UPLOAD_AUTHORIZE_PATH,
  SELL_SUBMISSION_SOURCE_PAGE,
  SELL_SUBMISSION_SUBMIT_PATH,
  SELL_SUBMISSION_VERIFY_API_PATH,
  SELL_SUBMISSION_VERIFY_FRAGMENT_KEY,
  SELL_SUBMISSION_VERIFY_PATH,
  sellSubmissionConditionCodes,
  sellSubmissionCurrencyCodes,
  sellSubmissionKinds,
} from "../lib/marketplace/sell-contract.ts";
import { validateSellSubmission } from "../lib/marketplace/sell-validation.ts";
import { isMarketplaceEnabled, isSellSubmissionEnabled } from "../lib/marketplace/feature.ts";
import { isPrivateAnalyticsRoute } from "../lib/analytics-private-routes.ts";
import {
  SELL_UPLOAD_MAX_BYTES,
  SELL_UPLOAD_MAX_FILES,
  SELL_UPLOAD_MAX_PHOTO_BYTES,
  SELL_UPLOAD_MAX_TOTAL_BYTES,
  formatSellUploadSize,
  resolveSellUploadMime,
  sellUploadCeiling,
  sellUploadOptions,
} from "../lib/marketplace/sell-upload-options.ts";
import {
  MARKETPLACE_UPLOAD_MAX_FILES,
  marketplaceMimeForPurpose,
  marketplaceUploadPurposes,
} from "../lib/marketplace/uploads/constants.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
/** JSX wraps prose across lines; compliance cares about the rendered sentence. */
const flat = (source) => source.replace(/\s+/g, " ");

/**
 * Source with comments stripped. A prohibited word inside a code comment that
 * explains why the word is prohibited is not a claim made to a seller, so the
 * compliance scans read only what can actually render.
 */
const copy = (source) => flat(
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " "),
);

/**
 * Every trackCivilonEvent(...) call, matched with balanced parentheses.
 *
 * A non-greedy `\(...\);` regex stops at the first ");", which for a call
 * wrapped in an arrow handler swallows unrelated code and reports whatever
 * identifiers happen to follow as if they were analytics payload keys.
 */
function analyticsCalls(source) {
  const calls = [];
  const marker = "trackCivilonEvent";
  for (let index = source.indexOf(marker); index >= 0; index = source.indexOf(marker, index + 1)) {
    if (source[index + marker.length] !== "(") continue;
    let depth = 0;
    for (let cursor = index + marker.length; cursor < source.length; cursor += 1) {
      if (source[cursor] === "(") depth += 1;
      else if (source[cursor] === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(source.slice(index, cursor + 1));
          break;
        }
      }
    }
  }
  return calls;
}

const sellForm = read("components", "marketplace", "SellSubmissionForm.tsx");
const sellUploads = read("components", "marketplace", "SellSubmissionUploads.tsx");
const sellVerifyComponent = read("components", "marketplace", "SellSubmissionVerification.tsx");
const sellPage = read("app", "buy-sell-aircraft-parts", "sell", "page.tsx");
const sellVerifyPage = read("app", "buy-sell-aircraft-parts", "sell", "verify", "page.tsx");
const hubView = read("components", "marketplace", "MarketplaceHubView.tsx");
const hubPage = read("app", "buy-sell-aircraft-parts", "page.tsx");
const sitemap = read("app", "sitemap.ts");
const buyForm = read("components", "marketplace", "BuyRequestForm.tsx");
const buyVerifyComponent = read("components", "marketplace", "BuyRequestVerification.tsx");

/* ------------------------------------------------------------------ gating */

test("the Sell surfaces are gated on the Sell flag, not just the marketplace flag", () => {
  for (const [name, source] of [["sell", sellPage], ["sell verify", sellVerifyPage]]) {
    assert.match(source, /isSellSubmissionEnabled\(\)/, name);
    assert.match(source, /notFound\(\)/, name);
    assert.doesNotMatch(source, /isPriceCheckEnabled/, `${name} must not depend on Price Check`);
    // The weaker marketplace-only gate must not be what guards these pages.
    assert.doesNotMatch(source, /if \(!isMarketplaceEnabled\(\)\) notFound\(\)/, name);
  }
  // And the flag itself is the conjunction, verified through the real function.
  assert.equal(isSellSubmissionEnabled({ NEXT_PUBLIC_MARKETPLACE_ENABLED: "true" }), false);
  assert.equal(isSellSubmissionEnabled({ NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED: "true" }), false);
  assert.equal(isSellSubmissionEnabled({
    NEXT_PUBLIC_MARKETPLACE_ENABLED: "true",
    NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED: "true",
  }), true);
  assert.equal(isMarketplaceEnabled({ NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED: "true" }), false);
});

test("the hub card opens only when the server resolves the Sell flag", () => {
  // The flag is resolved server-side and passed down; a client component reading
  // the env var itself would bake the card's state into the build.
  assert.match(hubPage, /<MarketplaceHubView sellEnabled=\{isSellSubmissionEnabled\(\)\} priceCheckEnabled=\{isPriceCheckEnabled\(\)\} \/>/);
  assert.match(hubView, /sellEnabled = false/, "the card must fail closed when nothing is passed");
  assert.match(hubView, /priceCheckEnabled = false/, "the third card must fail closed too");
  assert.match(hubView, /\{sellEnabled \? \(/);
  assert.doesNotMatch(hubView, /process\.env/);

  // Both branches exist: an open card with the intake link, and the preview.
  const [openBranch, previewBranch] = hubView.split("      ) : (");
  assert.match(openBranch, /href="\/buy-sell-aircraft-parts\/sell"/);
  assert.match(previewBranch, /Controlled preview/);
  assert.match(previewBranch, /href="\/contact-us"/);
  assert.doesNotMatch(previewBranch, /href="\/buy-sell-aircraft-parts\/sell"/,
    "the preview state must expose no submission path");
});

test("only the public Sell intake enters the sitemap, never the verification page", () => {
  assert.match(sitemap, /isSellSubmissionEnabled\(\) \? \["\/buy-sell-aircraft-parts\/sell"\] : \[\]/);
  assert.equal(sitemap.includes(SELL_SUBMISSION_VERIFY_PATH), false);
  assert.equal(sitemap.includes("/verify"), false);

  const header = read("components", "SiteHeader.tsx");
  const footer = read("components", "SiteFooter.tsx");
  for (const [name, source] of [["header", header], ["footer", footer]]) {
    assert.equal(source.includes(SELL_SUBMISSION_VERIFY_PATH), false, name);
    assert.equal(source.includes("/verify"), false, name);
  }
});

test("the Sell verification surface is excluded from the shared analytics private-route list", () => {
  // Both surfaces now read one shared helper instead of keeping a copy each.
  assert.equal(isPrivateAnalyticsRoute(SELL_SUBMISSION_VERIFY_PATH), true);
  assert.equal(isPrivateAnalyticsRoute(`${SELL_SUBMISSION_VERIFY_PATH}/anything`), true);
  // The Buy, Price Check and admin exclusions are unchanged.
  assert.equal(isPrivateAnalyticsRoute("/buy-sell-aircraft-parts/verify"), true);
  assert.equal(isPrivateAnalyticsRoute("/price-check/result"), true);
  assert.equal(isPrivateAnalyticsRoute("/admin/queue"), true);
  // The public Sell intake it hangs off is not made private by its children.
  assert.equal(isPrivateAnalyticsRoute(SELL_SUBMISSION_SOURCE_PAGE), false);
  for (const file of ["AnalyticsBootstrap.tsx", "ConsentPreferences.tsx"]) {
    const source = read("components", file);
    assert.ok(source.includes("isPrivateAnalyticsRoute(window.location.pathname)"), file);
    assert.ok(source.includes('from "@/lib/analytics-private-routes"'), file);
  }
});

/* ------------------------------------------------------- form / contract fit */

test("the form offers exactly the modes, conditions and currencies the contract accepts", () => {
  assert.deepEqual([...sellSubmissionKinds], ["single_part", "bulk_inventory"]);
  assert.match(sellForm, /update\("submissionKind", "single_part"\)/);
  assert.match(sellForm, /update\("submissionKind", "bulk_inventory"\)/);

  // Both selects are driven from the contract arrays, so a contract change can
  // never leave the UI offering a value the server would reject.
  assert.match(sellForm, /sellSubmissionConditionCodes\.map\(/);
  assert.match(sellForm, /sellSubmissionCurrencyCodes\.map\(/);
  for (const code of sellSubmissionConditionCodes) {
    assert.ok(sellForm.includes(`${code}:`), `condition ${code} needs a label`);
  }
  assert.equal(sellSubmissionConditionCodes.includes("ANY"), false, "ANY is a buyer concept");
  assert.deepEqual([...sellSubmissionCurrencyCodes], ["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "USD"]);
  assert.doesNotMatch(sellForm, /"(BTC|XBT|CNY|INR)"/, "no currency outside the contract allowlist");
});

test("quote-on-request is the default and a price is demanded only when chosen", () => {
  assert.match(sellForm, /quoteOnRequest: true/, "the initial value is quote on request");
  // The price fields do not exist until the seller opts out of quote-on-request.
  assert.match(sellForm, /\{!values\.quoteOnRequest && \(/);
  assert.match(sellForm, /if \(!values\.quoteOnRequest\) \{/);
  assert.match(flat(sellForm), /No price you give here is published or shown to a buyer/);

  // The rule the UI enforces is the rule the server enforces.
  const base = {
    idempotencyKey: "3f1a2b4c-5d6e-4f70-8123-456789abcdef",
    submissionKind: "single_part", partNumber: "101-384025-5",
    firstName: "Sam", lastName: "Okafor", companyName: "Example Component Supply",
    businessEmail: "sam.okafor@example.com", serviceAcknowledged: true,
    legalAcknowledged: true, sourcePage: SELL_SUBMISSION_SOURCE_PAGE,
  };
  assert.equal(validateSellSubmission(base).success, true, "no price is valid");
  assert.equal(validateSellSubmission({ ...base, quoteOnRequest: false }).success, false);
  assert.equal(
    validateSellSubmission({ ...base, quoteOnRequest: false, askingUnitPrice: "1200.00", currencyCode: "USD" }).success,
    true,
  );
});

test("bulk mode cannot carry single-part values, in the UI as well as on the server", () => {
  // The payload builder blanks every single-part field when the mode is bulk,
  // so a seller who fills them in and then switches modes sends nothing stale.
  for (const field of ["partNumber", "quantity", "conditionCode"]) {
    assert.match(
      sellForm,
      new RegExp(`${field}: isBulk \\? undefined`),
      `${field} must be dropped in bulk mode`,
    );
  }
  assert.match(sellForm, /quoteOnRequest: isBulk \? true : values\.quoteOnRequest/);
  assert.match(sellForm, /askingUnitPrice: isBulk \|\| values\.quoteOnRequest \? undefined/);
  assert.match(sellForm, /currencyCode: isBulk \|\| values\.quoteOnRequest \? undefined/);
  assert.match(sellForm, /estimatedLineItemCount: isBulk \? values\.estimatedLineItemCount/);
});

test("New Jersey shipping is tri-state and unknown is sent as null, never invented", () => {
  assert.match(sellForm, /canShipToNewJersey: "unknown"/, "the default is unanswered");
  assert.match(
    sellForm,
    /canShipToNewJersey: values\.canShipToNewJersey === "unknown"\s*\?\s*null/,
    "unknown must reach the server as null, not as false",
  );
  assert.match(flat(sellForm), /Can you ship to our New Jersey facility\?/);
  assert.match(flat(sellForm), /Not sure is fine\. Civilon decides routing later/);
  assert.ok(sellForm.includes("id={`sell-submission-ship-${value}`}"));
  for (const pair of ['["unknown", "Not sure yet"]', '["yes", "Yes"]', '["no", "No"]']) {
    assert.ok(flat(sellForm).includes(pair), pair);
  }
});

test("the required set is contact, country and both acknowledgements — and nothing more", () => {
  for (const rule of [
    /if \(!values\.firstName\.trim\(\)\) next\.firstName/,
    /if \(!values\.lastName\.trim\(\)\) next\.lastName/,
    /if \(!values\.companyName\.trim\(\)\) next\.companyName/,
    /next\.businessEmail = "Enter a valid business email address\."/,
    /next\.locationCountry = "Use a two-letter country code/,
    /next\.serviceAcknowledged =/,
    /next\.legalAcknowledged =/,
  ]) {
    assert.match(sellForm, rule);
  }
  // Phone, city, state, postal code, quantity and condition are all optional.
  assert.match(sellForm, /Phone \(optional\)/);
  assert.match(sellForm, /City \(optional\)/);
  assert.match(sellForm, /State or region \(optional\)/);
  assert.match(sellForm, /Quantity \(optional\)/);
  assert.match(sellForm, /Condition \(optional\)/);
  assert.doesNotMatch(sellForm, /next\.phone =/, "a seller offer is never urgent by construction");
});

test("progressive disclosure is used, and there is no wizard or signup", () => {
  const disclosures = sellForm.match(/<details/g) ?? [];
  assert.equal(disclosures.length, 2, "optional detail and files sit behind two disclosures");
  assert.match(sellForm, /disclosureFields\.has\(first\)\) setDetailsOpen\(true\)/,
    "an error inside a disclosure must open it before focus moves");
  assert.match(sellForm, /if \(first === "attachmentHandles"\) setFilesOpen\(true\)/);

  // "password-protected" describes a file the uploader refuses, so the signup
  // scan looks for a password the seller would be asked to choose.
  for (const forbidden of [
    /step \d of/i, /\bwizard\b/i, /sign ?up/i, /create an account/i,
    /choose a password/i, /your password/i, /\bpassword:/i,
  ]) {
    assert.doesNotMatch(copy(sellForm), forbidden, String(forbidden));
    assert.doesNotMatch(copy(sellPage), forbidden, String(forbidden));
  }
  assert.match(flat(sellForm), /No account and no sign-in/);
  // Exactly one form and one submit control.
  assert.equal((sellForm.match(/<form/g) ?? []).length, 1);
  assert.equal((sellForm.match(/type="submit"/g) ?? []).length, 1);
});

test("the form keeps the honeypot, idempotency key, attribution and error handling", () => {
  assert.match(sellForm, /pc-honeypot/);
  assert.match(sellForm, /sell-submission-website/);
  assert.match(sellForm, /idempotencyKey\.current = window\.crypto\.randomUUID\(\)/);
  assert.match(sellForm, /function attribution\(\)/);
  assert.match(sellForm, /utm_source/);
  assert.match(sellForm, /role="alert"/);
  assert.match(sellForm, new RegExp(`fetch\\(${"SELL_SUBMISSION_SUBMIT_PATH"}`));
  assert.equal(SELL_SUBMISSION_SUBMIT_PATH, "/api/marketplace/sell-submissions");
  // A transport failure must not look like a validation failure.
  assert.match(sellForm, /Submissions are temporarily unavailable/);
});

/* ------------------------------------------------------------------ uploads */

test("the upload UI offers every schema purpose with only server-accepted formats", () => {
  assert.deepEqual(
    [...sellUploadOptions.map((entry) => entry.value)].sort(),
    [...marketplaceUploadPurposes].sort(),
    "the UI must offer exactly the purposes the schema defines",
  );
  // Each purpose's client-side allowlist is a subset of the server's, so the UI
  // can never invite a pairing the authorize endpoint would refuse.
  for (const entry of sellUploadOptions) {
    const serverMimes = marketplaceMimeForPurpose[entry.value];
    for (const mime of entry.mimes) {
      assert.ok(serverMimes.includes(mime), `${entry.value} must not offer ${mime}`);
    }
    assert.deepEqual([...entry.mimes].sort(), [...serverMimes].sort(), entry.value);
  }
  // Spreadsheets belong to the inventory purpose alone.
  const spreadsheetPurposes = sellUploadOptions.filter((entry) => entry.mimes.includes("text/csv"));
  assert.deepEqual(spreadsheetPurposes.map((entry) => entry.value), ["INVENTORY_SPREADSHEET"]);
});

test("the upload UI states the accepted formats and the real limits", () => {
  const rendered = flat(sellUploads);
  assert.match(rendered, /Accepted: JPG, PNG, WebP, PDF, CSV and macro-free XLSX/);
  assert.ok(rendered.includes("files, 50 MB each (25 MB per photo), 200 MB in total"));
  // The spreadsheet hint lives with the shared option list, which is what the
  // component renders, so the assertion follows it there.
  const inventory = sellUploadOptions.find((entry) => entry.value === "INVENTORY_SPREADSHEET");
  assert.match(inventory.hint, /Macro-enabled and password-protected files are not accepted/);
  assert.match(sellUploads, /\{selected\.hint\}/, "the hint is actually rendered");
  assert.match(rendered, /Every file is scanned before Civilon staff can open it/);

  // The constants the UI enforces are the constants the server enforces.
  assert.equal(SELL_UPLOAD_MAX_FILES, MARKETPLACE_UPLOAD_MAX_FILES);
  assert.equal(SELL_UPLOAD_MAX_FILES, 12);
  assert.equal(SELL_UPLOAD_MAX_BYTES, 50 * 1024 * 1024);
  assert.equal(SELL_UPLOAD_MAX_PHOTO_BYTES, 25 * 1024 * 1024);
  assert.equal(SELL_UPLOAD_MAX_TOTAL_BYTES, 200 * 1024 * 1024);
  assert.equal(sellUploadCeiling("image/png"), SELL_UPLOAD_MAX_PHOTO_BYTES);
  assert.equal(sellUploadCeiling("application/pdf"), SELL_UPLOAD_MAX_BYTES);
  assert.equal(resolveSellUploadMime("list.csv"), "text/csv");
  assert.equal(resolveSellUploadMime("payload.exe"), null);
  assert.equal(formatSellUploadSize(0), "0 KB");
  assert.equal(formatSellUploadSize(97), "1 KB");
});

test("uploads authorize server-side and post only server-issued presigned fields", () => {
  assert.equal(MARKETPLACE_UPLOAD_AUTHORIZE_PATH, "/api/marketplace/uploads/authorize");
  assert.match(sellUploads, new RegExp(`fetch\\(${"MARKETPLACE_UPLOAD_AUTHORIZE_PATH"}`));
  assert.match(sellUploads, /method: "POST"/);
  // The declaration is exactly the four fields the endpoint allows.
  const body = sellUploads.slice(sellUploads.indexOf("body: JSON.stringify({"));
  const declaration = body.slice(0, body.indexOf("}),"));
  // `mime` is shorthand, so keys are collected as identifiers-before-comma too.
  const declaredKeys = (declaration.match(/^\s+(\w+)[,:]/gm) ?? [])
    .map((entry) => entry.trim().replace(/[,:]$/, ""));
  assert.deepEqual(
    declaredKeys,
    ["filename", "mime", "size", "purpose"],
    "the endpoint's four-field allowlist is exactly what the browser sends",
  );
  // The presigned form is replayed verbatim; only the file is appended.
  assert.match(sellUploads, /for \(const \[name, value\] of Object\.entries\(authorized\.upload\.fields\)\)/);
  assert.match(sellUploads, /form\.append\("file", file\)/);
  assert.match(sellUploads, /fetch\(authorized\.upload\.url, \{ method: "POST", body: form \}\)/);

  // The browser never sees or sends a bucket, key or credential of its own.
  for (const forbidden of [/@aws-sdk/, /secretAccessKey/, /objectKey/, /Bucket/, /tokenHash/, /signature/i]) {
    assert.doesNotMatch(sellUploads, forbidden, String(forbidden));
  }
  // And it never asks the server to trust it about the session.
  assert.doesNotMatch(sellUploads, /uploadSessionToken|uploadSessionId/);
  assert.match(sellUploads, /credentials: "same-origin"/);
});

test("only completed handles reach the submission, and uploads never block sending", () => {
  assert.match(
    sellForm,
    /uploads\.filter\(\(item\) => item\.status === "ready"\)\.map\(\(item\) => item\.handle\)/,
    "an in-flight or failed upload must not contribute a handle",
  );
  assert.match(sellForm, /attachmentHandles: attached/);
  // No filename, size, purpose or key is ever put in the submission body.
  const payloadBlock = sellForm.slice(sellForm.indexOf("function payload()"), sellForm.indexOf("async function submit"));
  for (const forbidden of [/filename/, /objectKey/, /\.size/, /item\.file/]) {
    assert.doesNotMatch(payloadBlock, forbidden, String(forbidden));
  }
  // The submit control is never disabled by upload state.
  assert.match(sellForm, /<button type="submit" className="pc-next" disabled=\{submitting\}>/);
  assert.match(flat(sellForm), /Files are optional—you can send this with none attached/);
  assert.match(flat(sellUploads), /You can send your submission with or without files/);
  assert.match(flat(sellUploads), /Files are optional/);
});

test("per-file status, remove and retry exist, and no live capture is requested", () => {
  for (const status of ["authorizing", "uploading", "ready", "failed"]) {
    assert.ok(sellUploads.includes(`"${status}"`), status);
  }
  assert.match(sellUploads, /Preparing…/);
  assert.match(sellUploads, /Uploading…/);
  assert.match(sellUploads, /function remove\(localId/);
  assert.match(sellUploads, /function retry\(localId/);
  assert.ok(flat(sellUploads).includes("> Retry </button>"));
  assert.ok(flat(sellUploads).includes("> Remove </button>"));

  // Previously taken files only: no camera, geolocation, video, KYC or AI.
  for (const forbidden of [
    /capture=/i, /getUserMedia/i, /MediaDevices/i,
    /geolocation/i, /latitude|longitude/i, /\bGPS\b/,
    /video\//i, /\bKYC\b/i, /OpenAI|\bOCR\b/i,
  ]) {
    assert.doesNotMatch(sellUploads, forbidden, String(forbidden));
    assert.doesNotMatch(sellForm, forbidden, String(forbidden));
  }
  assert.match(flat(sellUploads), /Use files you already have—no camera, location or live capture/);
});

/* ------------------------------------------------------------- verification */

test("Sell verification reuses the scanner-safe pattern against its own endpoint", () => {
  // Nothing is submitted on load; confirmation requires an explicit click.
  assert.match(sellVerifyComponent, /onClick=\{confirm\}/);
  const mountEffect = sellVerifyComponent.slice(
    sellVerifyComponent.indexOf("useEffect(() => {"),
    sellVerifyComponent.indexOf("async function confirm()"),
  );
  assert.doesNotMatch(mountEffect, /fetch\(/, "the mount effect must never redeem");

  // The credential arrives in a fragment and is erased before anything else.
  assert.match(sellVerifyComponent, /window\.location\.hash/);
  assert.match(
    sellVerifyComponent,
    new RegExp(`window\\.history\\.replaceState\\(null, "", ${"SELL_SUBMISSION_VERIFY_PATH"}\\)`),
  );
  assert.equal(SELL_SUBMISSION_VERIFY_FRAGMENT_KEY, "token");
  assert.equal(SELL_SUBMISSION_VERIFY_PATH, "/buy-sell-aircraft-parts/sell/verify");
  assert.doesNotMatch(sellVerifyComponent, /searchParams|location\.search/, "never a query string");

  // POST JSON only, to the Sell endpoint — never the Buy one.
  assert.match(sellVerifyComponent, new RegExp(`fetch\\(${"SELL_SUBMISSION_VERIFY_API_PATH"}`));
  assert.match(sellVerifyComponent, /method: "POST"/);
  assert.match(sellVerifyComponent, /"Content-Type": "application\/json"/);
  assert.equal(SELL_SUBMISSION_VERIFY_API_PATH, "/api/marketplace/sell-submissions/verify");
  assert.equal(sellVerifyComponent.includes("BUY_REQUEST"), false, "aggregates never share a credential path");
  assert.equal(sellForm.includes("BUY_REQUEST"), false);
});

test("initialization is StrictMode-safe and a network failure stays retryable", () => {
  // The guard is set before the destructive read, so a second effect run cannot
  // overwrite a captured credential with an already-cleared fragment.
  const effect = sellVerifyComponent.slice(
    sellVerifyComponent.indexOf("useEffect(() => {"),
    sellVerifyComponent.indexOf("async function confirm()"),
  );
  const guardAt = effect.indexOf("if (initialized.current) return;");
  const setAt = effect.indexOf("initialized.current = true;");
  const readAt = effect.indexOf("window.location.hash");
  assert.ok(guardAt >= 0 && setAt > guardAt && readAt > setAt, "guard, then set, then read");

  // On a server answer the credential is dropped; on a transport failure it is
  // kept in memory for another press and never written back to the URL.
  assert.match(sellVerifyComponent, /token\.current = "";/);
  assert.match(sellVerifyComponent, /setRetryable\(true\);\s*\n\s*setStage\("ready"\);/);
  assert.match(flat(sellVerifyComponent), /your link is still valid/);
  const catchBlock = sellVerifyComponent.slice(sellVerifyComponent.lastIndexOf("} catch {"));
  assert.doesNotMatch(catchBlock, /replaceState|token\.current =/);
});

test("the verification page is private, gated and free of navigation", () => {
  assert.match(sellVerifyPage, /index: false, follow: false, nocache: true/);
  assert.match(sellVerifyPage, /referrer: "no-referrer"/);
  assert.match(sellVerifyPage, /openGraph: null/);
  assert.match(sellVerifyPage, /dynamic = "force-dynamic"/);
  assert.doesNotMatch(sellVerifyPage, /Breadcrumbs/);
  assert.doesNotMatch(sellVerifyPage, /pageMetadata/);
});

/* ---------------------------------------------------------------- analytics */

test("Sell analytics events carry only page and CTA context and no submission data", () => {
  const calls = [sellForm, sellUploads, sellVerifyComponent, hubView].flatMap(analyticsCalls);
  assert.ok(calls.length >= 7, `expected the documented events, found ${calls.length}`);

  for (const call of calls) {
    for (const key of call.match(/(\w+):/g) ?? []) {
      assert.ok(
        ["source_page:", "cta_location:"].includes(key),
        `analytics payloads may only carry source_page and cta_location, found ${key} in ${call}`,
      );
    }
    for (const forbidden of [/filename/i, /handle/i, /partNumber/i, /businessEmail/i, /description/i, /price/i, /size/i]) {
      assert.doesNotMatch(call, forbidden, `${forbidden} must never reach analytics`);
    }
  }

  // Every event name used is on the shared allowlist, which is a closed union.
  const analytics = read("lib", "analytics.ts");
  for (const name of [
    "sell_submission_view", "sell_submission_start", "sell_submission_upload_started",
    "sell_submission_upload_completed", "sell_submission_submit",
    "sell_submission_verification_confirmed",
  ]) {
    assert.ok(analytics.includes(`| "${name}"`), `${name} must be on the allowlist`);
    assert.ok(
      [sellForm, sellUploads, sellVerifyComponent, hubView].some((source) => source.includes(name)),
      `${name} must actually be emitted`,
    );
  }
  assert.doesNotMatch(analytics, /\.\.\.context/, "the payload builder stays a closed allowlist");
});

/* --------------------------------------------------------------- compliance */

test("no Sell surface promises a purchase, price, timing, listing or approval", () => {
  const surfaces = [
    ["form", sellForm], ["uploads", sellUploads], ["verify", sellVerifyComponent],
    ["sell page", sellPage], ["verify page", sellVerifyPage], ["hub view", hubView],
  ];
  for (const [name, source] of surfaces) {
    const rendered = copy(source);
    for (const forbidden of [
      // Only an affirmative claim is prohibited. The required disclaimer
      // necessarily contains "guarantee" in its negative form, and a separate
      // test asserts that sentence is present on every surface.
      /\bwe will buy\b/i, /\bwe guarantee\b/i, /\bguaranteed\b/i,
      /\bcertified\b/i, /\bcertifies\b/i,
      /\bairworthiness[- ]approved\b/i, /\bFAA[- ]approved\b/i, /\bEASA[- ]approved\b/i,
      /\bwe approve\b/i, /\bapproved for (installation|flight|service)\b/i,
      /\bwithin \d+ (hours|days|business days)\b/i, /\bresponse time\b/i,
      // "not published or listed" is required copy, so only an affirmative
      // publication claim is prohibited.
      /\bwe pay\b/i, /\bbest price\b/i, /\blist your\b/i,
      /\bwe publish\b/i, /\bwill be published\b/i, /\bpublished on\b/i,
      /\bmarketplace listing\b/i, /\bsearch our inventory\b/i,
    ]) {
      assert.doesNotMatch(rendered, forbidden, `${name}: ${forbidden}`);
    }
  }
});

test("the required qualifications appear on every Sell surface a seller reads", () => {
  assert.match(flat(sellPage), /documentation varies by part and source/i);
  // The discretion qualifier carries the same substance as the older "not
  // obliged to buy" sentence, in the wording approved for public pages.
  assert.match(flat(sellPage), /Every submission gets an internal review; offers are at Civilon’s discretion/);
  assert.doesNotMatch(flat(sellPage), /not obliged to buy/i);
  assert.match(
    flat(sellPage),
    /not certification, regulatory approval, airworthiness\s+approval, or a\s+guarantee of authenticity or fitness/i,
  );
  assert.match(flat(sellForm), /documentation varies by part and\s+source/i);
  assert.match(flat(sellForm), /Every submission gets an internal review; offers are at Civilon’s discretion/);
  assert.doesNotMatch(flat(sellForm), /not obliged to buy/i);
  assert.match(flat(sellForm), /subject to confirmation/i);
  assert.match(flat(sellVerifyPage), /not obliged to\s+buy/i);
  assert.match(flat(sellVerifyPage), /documentation varies by part and source/i);
  assert.match(flat(sellUploads), /not certification, regulatory approval, airworthiness/i);
});

test("the success screen shows a reference and a check-email instruction only", () => {
  const confirmation = sellForm.slice(sellForm.indexOf("if (reference) {"), sellForm.indexOf("const errorSummary"));
  const rendered = flat(confirmation);
  assert.match(rendered, /Submission received/);
  assert.match(rendered, /price-check-reference/);
  assert.match(rendered, /Check your email/);
  assert.match(rendered, /confirmation link/);
  assert.match(rendered, /a member of the team will contact you/i);
  assert.match(rendered, /Nothing here is published or listed/);
  assert.match(rendered, /subject to confirmation/);
  // No echo of anything the seller typed, and no promise about the outcome.
  for (const forbidden of [
    /values\./, /partNumber/, /businessEmail/, /askingUnitPrice/, /uploads/,
    /\bwill buy\b/i, /\bwill respond\b/i, /\boffer accepted\b/i,
  ]) {
    assert.doesNotMatch(confirmation, forbidden, String(forbidden));
  }
  assert.match(sellForm, /const \[reference, setReference\] = useState\(""\)/);
});

test("buyer and seller surfaces stay separated in both directions", () => {
  // No seller concept leaks into the Buy UI.
  for (const forbidden of [/sell_submission/i, /SellSubmission/, /askingUnitPrice/, /supplier/i]) {
    assert.doesNotMatch(buyForm, forbidden, `buy form: ${forbidden}`);
    assert.doesNotMatch(buyVerifyComponent, forbidden, `buy verify: ${forbidden}`);
  }
  // No buyer concept or public inventory surface leaks into the Sell UI.
  for (const forbidden of [
    /buy_request/i, /BuyRequest/, /acceptableCondition/, /urgency/i, /fulfillmentPreference/,
    /\blisting\b(?!s? is published|s? are published)/i, /searchInventory/i, /publicListing/i,
  ]) {
    assert.doesNotMatch(sellForm, forbidden, `sell form: ${forbidden}`);
    assert.doesNotMatch(sellUploads, forbidden, `sell uploads: ${forbidden}`);
  }
  // And no supplier-to-buyer messaging path exists on either side.
  for (const source of [sellForm, sellUploads, sellVerifyComponent, buyForm]) {
    assert.doesNotMatch(source, /messageBuyer|contactSupplier|chat/i);
  }
});

/* ------------------------------------------------- narrow 1E3 corrections */

test("the optional disclosure names only fields that actually exist", () => {
  // The free-text field is the description, which sits in the main body of the
  // form. Promising a separate "note" behind this toggle would send a seller
  // looking for a field that is deliberately not there.
  assert.match(sellForm, /<summary>Add phone or location details \(optional\)<\/summary>/);
  assert.equal(flat(sellForm).includes("city or note"), false);

  // Everything the summary now names is present inside the disclosure.
  const disclosure = sellForm.slice(
    sellForm.indexOf("Add phone or location details"),
    sellForm.indexOf("Attach files (optional)"),
  );
  for (const field of [
    "sell-submission-phone",
    "sell-submission-locationStateRegion",
    "sell-submission-locationCity",
    "sell-submission-locationPostalCode",
  ]) {
    assert.ok(disclosure.includes(field), field);
  }
  // And no note field is offered anywhere, since the schema has none.
  assert.equal(/id="sell-submission-note/.test(sellForm), false);
});

test("an unfinished upload is stated at the submit control without blocking sending", () => {
  // Anything not "ready" is counted, so a failed file is surfaced too.
  assert.match(
    sellForm,
    /const unfinishedUploads = uploads\.filter\(\(item\) => item\.status !== "ready"\)\.length;/,
  );
  assert.match(sellForm, /\{unfinishedUploads > 0 && \(/);

  // The warning sits inside the submit actions, next to the control it is about.
  const actions = sellForm.slice(sellForm.indexOf('<div className="pc-submit-actions">'));
  assert.ok(actions.includes("unfinishedUploads"), "the message is beside the submit button");
  assert.match(actions, /role="status" aria-live="polite"/);
  assert.match(flat(actions), /has not finished uploading/);
  assert.match(flat(actions), /Sending now submits without/);
  assert.match(flat(actions), /your offer is reviewed either way/);
  // Singular and plural are both handled rather than "1 files".
  assert.match(flat(actions), /1 file has not finished uploading/);
  assert.match(flat(actions), /\$\{unfinishedUploads\} files have not finished uploading/);

  // Submission is never gated on upload state: the only disabled condition is
  // the in-flight submit itself.
  assert.match(sellForm, /<button type="submit" className="pc-next" disabled=\{submitting\}>/);
  assert.equal(/disabled=\{[^}]*unfinishedUploads/.test(sellForm), false);
  assert.equal(/disabled=\{[^}]*uploads\./.test(sellForm), false);
  assert.equal(/if \(unfinishedUploads[^)]*\) return;/.test(sellForm), false);
  // And the fast path is unchanged.
  assert.match(flat(sellForm), /Files are optional—you can send this with none attached/);

  // The uploads panel says the same thing while files are in flight.
  assert.match(
    flat(sellUploads),
    /Only files that finish are attached—sending before then submits without them/,
  );

  // The warning is copy only: no filename, handle or content is in it, and it
  // emits no analytics event of its own.
  const warning = actions.slice(actions.indexOf("unfinishedUploads > 0"), actions.indexOf("Files are optional"));
  for (const forbidden of [/filename/i, /\.handle/, /item\.file/, /trackCivilonEvent/]) {
    assert.doesNotMatch(warning, forbidden, String(forbidden));
  }
});
