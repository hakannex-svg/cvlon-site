import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  BUY_REQUEST_SOURCE_PAGE,
  BUY_REQUEST_VERIFY_API_PATH,
  BUY_REQUEST_VERIFY_FRAGMENT_KEY,
  BUY_REQUEST_VERIFY_PATH,
  MARKETPLACE_HUB_PAGE,
  buyRequestConditionCodes,
  buyRequestFulfillmentPreferences,
  buyRequestUrgencies,
} from "../lib/marketplace/contract.ts";
import {
  buyRequestVerificationUrl,
  deriveVerificationToken,
  newVerificationNonce,
} from "../lib/marketplace/verification.ts";
import { buyRequestVerifyEmail } from "../lib/marketplace/email/buy-request-templates.ts";
import { isMarketplaceEnabled } from "../lib/marketplace/feature.ts";
import { isPriceCheckEnabled } from "../lib/price-check/feature.ts";
import { isPrivateAnalyticsRoute } from "../lib/analytics-private-routes.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
/** JSX wraps prose across lines; compliance cares about the rendered sentence. */
const text = (source) => source.replace(/\s+/g, " ");

const verifyRoute = read("app", "api", "marketplace", "buy-requests", "verify", "route.ts");
const submitRoute = read("app", "api", "marketplace", "buy-requests", "route.ts");
const verifyComponent = read("components", "marketplace", "BuyRequestVerification.tsx");
const verifyPage = read("app", "buy-sell-aircraft-parts", "verify", "page.tsx");
const hubPage = read("app", "buy-sell-aircraft-parts", "page.tsx");
const hubView = read("components", "marketplace", "MarketplaceHubView.tsx");
const buyPage = read("app", "buy-sell-aircraft-parts", "buy", "page.tsx");
const buyForm = read("components", "marketplace", "BuyRequestForm.tsx");
const TOKEN_KEY = "civilon-marketplace-verify-token-key-for-tests";

/**
 * Every trackCivilonEvent(...) call, matched with balanced parentheses.
 *
 * A non-greedy `\(...\);` regex stops at the first ");", which for a call
 * wrapped in an arrow handler never arrives — the match then runs on through
 * whatever JSX follows and reports its prose as if it were a payload key. The
 * Sell suite already reads its calls this way; this is the same reader.
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

/* -------------------------------------------------------------------------
 * Redemption is POST-only and the credential never reaches the server as a URL
 * ---------------------------------------------------------------------- */

test("the verification endpoint redeems only on POST and refuses GET", () => {
  assert.match(verifyRoute, /export async function POST\(/);
  assert.match(verifyRoute, /export async function GET\(/);

  // The GET handler is the tail of the file and must contain nothing but a 405.
  const getHandler = verifyRoute.slice(verifyRoute.indexOf("export async function GET("));
  assert.match(getHandler, /status: 405/);
  assert.match(getHandler, /Allow: "POST"/);
  assert.doesNotMatch(getHandler, /verifyBuyRequestContact|redeem|priceCheckDb/i);

  // Only the POST path performs redemption.
  const postHandler = verifyRoute.slice(
    verifyRoute.indexOf("export async function POST("),
    verifyRoute.indexOf("export async function GET("),
  );
  assert.match(postHandler, /verifyBuyRequestContact/);
});

test("the endpoint never reads a credential from the URL", () => {
  assert.doesNotMatch(verifyRoute, /searchParams/, "a credential must not come from the query string");
  assert.doesNotMatch(verifyRoute, /new URL\(request\.url\)/);
  assert.match(verifyRoute, /JSON\.parse\(rawBody\)/);
  // Exactly one key, and it must be a string: no smuggling extra fields.
  assert.match(verifyRoute, /Object\.keys\(body\)\.length !== 1/);
  assert.match(verifyRoute, /typeof body\.token !== "string"/);
});

test("the endpoint stays gated, origin-bounded, rate limited and uniform", () => {
  assert.match(verifyRoute, /isMarketplaceEnabled\(\)/);
  assert.match(verifyRoute, /isApprovedSubmissionHost/);
  assert.match(verifyRoute, /sec-fetch-site/);
  assert.match(verifyRoute, /consumeMarketplaceAttempt/);
  assert.match(verifyRoute, /BUY_REQUEST_VERIFY_MAX_BODY_BYTES/);
  assert.match(verifyRoute, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(verifyRoute, /"X-Robots-Tag": "noindex, nofollow, noarchive"/);
  assert.match(verifyRoute, /"Referrer-Policy": "no-referrer"/);
  // One success shape, one failure shape, both HTTP 200.
  assert.equal(verifyRoute.match(/status: 200/g).length, 1);
  assert.doesNotMatch(verifyRoute, /already_verified/, "a repeat must not be distinguishable to the caller");
  // No account, session or cookie is created by confirming an email address.
  assert.doesNotMatch(verifyRoute, /cookies?\.set|Set-Cookie/i);
});

test("the emailed link carries the credential in the fragment, never the query", () => {
  const token = deriveVerificationToken(TOKEN_KEY, newVerificationNonce());
  const url = buyRequestVerificationUrl("https://cvlon.com", token);

  assert.equal(url, `https://cvlon.com${BUY_REQUEST_VERIFY_PATH}#${BUY_REQUEST_VERIFY_FRAGMENT_KEY}=${encodeURIComponent(token)}`);
  assert.equal(url.includes("?"), false, "no query string at all");
  assert.ok(url.includes("#token="));
  // The path a server would see stops at the fragment.
  const parsed = new URL(url);
  assert.equal(parsed.pathname, BUY_REQUEST_VERIFY_PATH);
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash.includes(token), true);
  assert.equal(`${parsed.origin}${parsed.pathname}${parsed.search}`.includes(token), false);
  // The link points at the page, not at the redeem endpoint a scanner could hit.
  assert.equal(url.includes(BUY_REQUEST_VERIFY_API_PATH), false);

  const email = buyRequestVerifyEmail({
    from: "Civilon Parts <parts@cvlon.com>",
    to: "buyer@example.com",
    reference: "BR-ABCDEFGHJK",
    verificationUrl: url,
    expiresAt: new Date("2026-08-24T12:00:00Z"),
  });
  for (const body of [email.textBody, email.htmlBody]) {
    assert.ok(body.includes("#token="));
    assert.equal(/verify\?token=/.test(body), false);
    assert.equal(body.includes(BUY_REQUEST_VERIFY_API_PATH), false);
  }
});

/* -------------------------------------------------------------------------
 * The verification page cannot be activated by a scanner
 * ---------------------------------------------------------------------- */

test("nothing is submitted on load; confirmation requires an explicit click", () => {
  const effect = verifyComponent.slice(
    verifyComponent.indexOf("useEffect(() => {"),
    verifyComponent.indexOf("async function confirm()"),
  );
  assert.doesNotMatch(effect, /fetch\(/, "arriving on the page must never redeem the credential");
  assert.doesNotMatch(effect, /confirm\(\)/, "the effect must not call the confirm handler");

  // Redemption is reachable only from a button press.
  assert.match(verifyComponent, /onClick=\{confirm\}/);
  assert.match(verifyComponent, /Confirm email/);
  assert.match(verifyComponent, /disabled=\{stage === "confirming"\}/);
  assert.equal(verifyComponent.match(/fetch\(/g).length, 1);
  assert.match(verifyComponent, /method: "POST"/);
});

test("the fragment is erased on arrival and the credential is dropped after use", () => {
  assert.match(verifyComponent, /window\.history\.replaceState\(null, "", BUY_REQUEST_VERIFY_PATH\)/);
  // Erasure happens before anything else can act on the value.
  const effect = verifyComponent.slice(
    verifyComponent.indexOf("useEffect(() => {"),
    verifyComponent.indexOf("async function confirm()"),
  );
  assert.ok(
    effect.indexOf("replaceState") < effect.indexOf("setStage"),
    "the fragment must be cleared before the component renders a state that depends on it",
  );
  // The credential lives in a ref, never in rendered state, and is discarded.
  assert.match(verifyComponent, /const token = useRef\(""\)/);
  assert.doesNotMatch(verifyComponent, /useState.*token/i);
  assert.doesNotMatch(verifyComponent, /\{token\.current\}/, "the credential is never rendered");
});

test("fragment initialization is guarded so a repeated effect cannot strand a valid link", () => {
  const effect = verifyComponent.slice(
    verifyComponent.indexOf("useEffect(() => {"),
    verifyComponent.indexOf("async function confirm()"),
  );

  assert.match(verifyComponent, /const initialized = useRef\(false\)/);
  assert.match(effect, /if \(initialized\.current\) return;/);
  assert.match(effect, /initialized\.current = true;/);

  // The guard must be both checked and set before anything destructive happens,
  // otherwise a second setup would still consume or overwrite the credential.
  const guardCheck = effect.indexOf("if (initialized.current) return;");
  const guardSet = effect.indexOf("initialized.current = true;");
  const read = effect.indexOf("window.location.hash");
  const clear = effect.indexOf("replaceState");
  const assign = effect.indexOf("token.current = value");
  const stage = effect.indexOf("setStage(");
  for (const [name, index] of [["read", read], ["clear", clear], ["assign", assign], ["stage", stage]]) {
    assert.ok(index > -1, `expected a ${name} step in the effect`);
    assert.ok(guardCheck < index, `the guard must be checked before the ${name} step`);
    assert.ok(guardSet < index, `the guard must be set before the ${name} step`);
  }
  // Ordering within the run is unchanged: capture, clear, then reveal.
  assert.ok(read < clear && clear < assign && assign < stage);

  // A later execution returns before reaching any of them, so nothing after the
  // guard can be re-run: exactly one assignment and one stage decision exist.
  assert.equal(effect.match(/token\.current = /g).length, 1);
  assert.equal(effect.match(/setStage\(/g).length, 1);
  const afterGuard = effect.slice(effect.indexOf("initialized.current = true;"));
  assert.equal(afterGuard.match(/return;/g), null, "only the guard may short-circuit the effect");
});

test("a transient network failure keeps the credential retryable without exposing it", () => {
  const confirmBody = verifyComponent.slice(
    verifyComponent.indexOf("async function confirm()"),
    verifyComponent.indexOf('if (stage === "reading")'),
  );
  const catchBranch = confirmBody.slice(confirmBody.indexOf("} catch {"));
  const answered = confirmBody.slice(0, confirmBody.indexOf("} catch {"));

  // A definitive server answer always discards the credential.
  assert.match(answered, /token\.current = "";/);
  assert.ok(
    answered.indexOf('token.current = "";') < answered.indexOf("if (result.ok)"),
    "the credential is dropped before either definitive outcome is rendered",
  );

  // A transport failure is not a definitive answer, so the credential survives
  // in memory only — never written back to the URL, never rendered.
  assert.doesNotMatch(catchBranch, /token\.current = ""/, "a transient failure must not discard a usable credential");
  assert.doesNotMatch(catchBranch, /replaceState|location\.hash|history\./, "the credential must never return to the URL");
  assert.doesNotMatch(catchBranch, /setStage\("unavailable"\)/, "a network blip is not an unusable link");
  assert.match(catchBranch, /setRetryable\(true\)/);
  assert.match(catchBranch, /setStage\("ready"\)/);

  // The retry notice states the position without printing the credential.
  assert.match(verifyComponent, /\{retryable && \(/);
  assert.match(text(verifyComponent), /your link is still valid/i);
  assert.doesNotMatch(verifyComponent, /\{token\.current\}/);
});

test("the verification page is private, gated and free of navigation", () => {
  assert.match(verifyPage, /isMarketplaceEnabled\(\)/);
  assert.match(verifyPage, /notFound\(\)/);
  assert.match(verifyPage, /robots: \{ index: false, follow: false, nocache: true \}/);
  assert.match(verifyPage, /referrer: "no-referrer"/);
  // Indexing is refused outright, never delegated to the site-wide flag.
  assert.doesNotMatch(verifyPage, /NEXT_PUBLIC_ALLOW_INDEXING/);
  assert.doesNotMatch(verifyPage, /pageMetadata/);
});

/* -------------------------------------------------------------------------
 * Buy Request form
 * ---------------------------------------------------------------------- */

test("the form ships the documented defaults and the alternative to a part number", () => {
  assert.match(buyForm, /quantity: "1"/);
  assert.match(buyForm, /acceptableCondition: "NOT_SURE"/);
  assert.match(buyForm, /urgency: "not_sure"/);
  assert.match(buyForm, /fulfillmentPreference: "not_sure"/);
  assert.match(buyForm, /I don&apos;t know the exact part number/);
  assert.match(buyForm, /describeInstead/);
  assert.match(buyForm, /id="buy-request-description"/);

  // Every enum in the contract is offered, so the UI cannot drift from the API.
  for (const code of buyRequestConditionCodes) assert.ok(buyForm.includes(`${code}:`), code);
  for (const code of buyRequestUrgencies) assert.ok(buyForm.includes(`${code}:`), code);
  for (const code of buyRequestFulfillmentPreferences) assert.ok(buyForm.includes(`${code}:`), code);
});

test("phone is revealed and required only for AOG or critical urgency", () => {
  assert.match(buyForm, /const phoneRequired = isPhoneRequiredUrgency\(values\.urgency\)/);
  assert.match(buyForm, /\{\(phoneRequired \|\| phoneShown\) && \(/);
  assert.match(buyForm, /if \(phoneRequired && values\.phone\.replace\(\/\\D\/g, ""\)\.length < 7\)/);
  assert.match(buyForm, /required=\{phoneRequired\}/);
});

test("the form keeps its honeypot, idempotency key, attribution and error handling", () => {
  assert.match(buyForm, /className="pc-honeypot"/);
  assert.match(buyForm, /id="buy-request-website"/);
  assert.match(buyForm, /window\.crypto\.randomUUID\(\)/);
  assert.match(buyForm, /utmSource: value\("utm_source"\)/);
  assert.match(buyForm, /role="alert"/, "an accessible error summary");
  assert.match(buyForm, /aria-invalid/);
  assert.match(buyForm, /aria-describedby/);
  assert.match(buyForm, /result\.fieldErrors/, "server field errors are surfaced inline");
  assert.match(buyForm, /if \(first && disclosureFields\.has\(first\)\) setDetailsOpen\(true\)/);
  assert.match(buyForm, /disabled=\{submitting\}/);
  assert.match(buyForm, /noValidate/);
});

test("the buy page renders exactly one form and one submit control", () => {
  assert.equal(buyForm.match(/<form\b/g).length, 1);
  assert.equal(buyForm.match(/type="submit"/g).length, 1);
  assert.equal(buyPage.match(/<form\b/g), null, "the page delegates the form to one component");
  assert.equal(buyPage.match(/<BuyRequestForm \/>/g).length, 1);
});

test("the success view shows only a reference and a check-email instruction", () => {
  const success = text(buyForm.slice(buyForm.indexOf("if (reference) {"), buyForm.indexOf("const errorSummary")));
  assert.match(success, /Check your email/);
  assert.match(success, /{reference}/);
  assert.match(success, /subject to confirmation/);
  assert.match(success, /documentation varies by part and source/i);
  // No availability, stock, price figure, estimate or quotation claim.
  for (const claim of [/in stock/i, /available now/i, /we found/i, /estimated? price/i, /price range/i, /quotation attached/i, /\$\d/]) {
    assert.equal(claim.test(success), false, `success view must not claim ${claim}`);
  }
});

/* -------------------------------------------------------------------------
 * Gating, sitemap, analytics
 * ---------------------------------------------------------------------- */

test("marketplace gating is independent of Price Check gating", () => {
  assert.equal(isMarketplaceEnabled({ NEXT_PUBLIC_MARKETPLACE_ENABLED: "true" }), true);
  for (const value of [undefined, "", "false", "1", "TRUE", "yes"]) {
    assert.equal(isMarketplaceEnabled({ NEXT_PUBLIC_MARKETPLACE_ENABLED: value }), false, String(value));
  }
  // Enabling one workflow must not enable the other.
  assert.equal(isMarketplaceEnabled({ NEXT_PUBLIC_PRICE_CHECK_ENABLED: "true" }), false);
  const priceCheckFlag = process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED;
  const marketplaceFlag = process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED;
  try {
    process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED = "false";
    process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED = "true";
    assert.equal(isPriceCheckEnabled(), false, "the marketplace flag must not enable Price Check");
    assert.equal(isMarketplaceEnabled(), true);
  } finally {
    if (priceCheckFlag === undefined) delete process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED;
    else process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED = priceCheckFlag;
    if (marketplaceFlag === undefined) delete process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED;
    else process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED = marketplaceFlag;
  }
});

test("every public marketplace surface is gated and the private one refuses when disabled", () => {
  for (const [name, source] of [["hub", hubPage], ["buy", buyPage], ["verify", verifyPage]]) {
    assert.match(source, /isMarketplaceEnabled\(\)/, name);
    assert.match(source, /notFound\(\)/, name);
    assert.doesNotMatch(source, /isPriceCheckEnabled\(\)\)?\s*notFound/, `${name} must not be gated on the Price Check flag`);
  }
  // The hub shows a Price Check card when that flag is on, so it reads the flag
  // — but its own availability still turns on the marketplace flag alone.
  assert.match(hubPage, /if \(!isMarketplaceEnabled\(\)\) notFound\(\);/);
  assert.match(hubPage, /priceCheckEnabled=\{isPriceCheckEnabled\(\)\}/);
  for (const [name, source] of [["buy", buyPage], ["verify", verifyPage]]) {
    assert.doesNotMatch(source, /isPriceCheckEnabled/, `${name} must not depend on the Price Check flag`);
  }
});

test("navigation, footer and sitemap expose the marketplace only when it is enabled", () => {
  const header = read("components", "SiteHeader.tsx");
  const footer = read("components", "SiteFooter.tsx");
  const sitemap = read("app", "sitemap.ts");

  assert.match(header, /marketplaceEnabled \? \[\{ label: PUBLIC_CTA\.buy, href: "\/buy-sell-aircraft-parts\/buy" \}\] : \[\]/);
  assert.match(header, /sellSubmissionEnabled \? \[\{ label: PUBLIC_CTA\.sell, href: "\/buy-sell-aircraft-parts\/sell" \}\] : \[\]/);
  assert.match(header, /priceCheckEnabled \? \[\{ label: "Aircraft Part Price Check"/);
  assert.match(footer, /\{marketplaceEnabled && <a href="\/buy-sell-aircraft-parts\/buy">\{PUBLIC_CTA\.buy\}<\/a>\}/);
  assert.match(footer, /\{sellSubmissionEnabled && <a href="\/buy-sell-aircraft-parts\/sell">\{PUBLIC_CTA\.sell\}<\/a>\}/);
  assert.match(footer, /\{priceCheckEnabled && <a href="\/price-check">/);
  assert.match(sitemap, /isMarketplaceEnabled\(\) \? \["\/buy-sell-aircraft-parts", "\/buy-sell-aircraft-parts\/buy"\] : \[\]/);

  // The private confirmation surface is in none of them.
  for (const [name, source] of [["header", header], ["footer", footer], ["sitemap", sitemap]]) {
    assert.equal(source.includes(BUY_REQUEST_VERIFY_PATH), false, `${name} must not list the verification page`);
    assert.equal(source.includes("/verify"), false, name);
  }
});

test("the verification surface is excluded from the shared analytics private-route list", () => {
  // The two hand-maintained lists became one shared helper, so the exclusion is
  // asserted through the helper and each surface is asserted to consult it.
  assert.equal(isPrivateAnalyticsRoute(BUY_REQUEST_VERIFY_PATH), true);
  assert.equal(isPrivateAnalyticsRoute(`${BUY_REQUEST_VERIFY_PATH}/anything`), true);
  // The existing Price Check and admin exclusions are unchanged.
  assert.equal(isPrivateAnalyticsRoute("/price-check/result"), true);
  assert.equal(isPrivateAnalyticsRoute("/admin/queue"), true);
  // And the public parents stay public.
  assert.equal(isPrivateAnalyticsRoute(MARKETPLACE_HUB_PAGE), false);
  assert.equal(isPrivateAnalyticsRoute(BUY_REQUEST_SOURCE_PAGE), false);
  for (const file of ["AnalyticsBootstrap.tsx", "ConsentPreferences.tsx"]) {
    const source = read("components", file);
    assert.ok(source.includes("isPrivateAnalyticsRoute(window.location.pathname)"), file);
    assert.ok(source.includes('from "@/lib/analytics-private-routes"'), file);
  }
});

test("analytics events carry only page and CTA context", () => {
  const calls = [hubView, buyForm, verifyComponent].flatMap(analyticsCalls);
  assert.ok(calls.length >= 5, `expected the documented events, found ${calls.length}`);

  for (const call of calls) {
    const keys = call.match(/(\w+):/g) ?? [];
    for (const key of keys) {
      assert.ok(
        ["source_page:", "cta_location:"].includes(key),
        `analytics payloads may only carry source_page and cta_location, found ${key}`,
      );
    }
    for (const forbidden of ["reference", "token", "values.", "businessEmail", "partNumber", "phone", "quantity", "price"]) {
      assert.equal(call.includes(forbidden), false, `${forbidden} must never be sent to analytics`);
    }
  }

  const names = calls.map((call) => call.match(/trackCivilonEvent\("([a-z_]+)"/)?.[1]);
  for (const expected of ["buy_sell_hub_view", "buy_request_view", "buy_request_start", "buy_request_submit", "buy_request_verification_confirmed"]) {
    assert.ok(names.includes(expected), expected);
  }
  // Only approved source pages are ever reported.
  const analytics = read("lib", "analytics.ts");
  for (const name of names) assert.ok(analytics.includes(`"${name}"`), `${name} must be a declared event name`);
  for (const page of [MARKETPLACE_HUB_PAGE, BUY_REQUEST_SOURCE_PAGE, BUY_REQUEST_VERIFY_PATH]) {
    assert.ok(typeof page === "string" && page.startsWith("/buy-sell-aircraft-parts"));
  }
});

/* -------------------------------------------------------------------------
 * Compliance copy
 * ---------------------------------------------------------------------- */

const PROHIBITED_CLAIMS = [
  /Civilon[- ]certified/i,
  /certified parts/i,
  /we certify/i,
  /airworthiness (?:approval|approved by Civilon)/i,
  /guarantee(?:s|d)? (?:authenticity|fitness|quality|the specification)/i,
  /guaranteed (?:availability|delivery|price)/i,
  /in stock now/i,
  /distribute[sd]? (?:your|the) request/i,
  /supplier network/i,
  /marketplace of suppliers/i,
];

test("marketplace copy makes no prohibited certification, guarantee or availability claim", () => {
  const surfaces = { hubPage, hubView, buyPage, buyForm, verifyPage, verifyComponent };
  for (const [name, source] of Object.entries(surfaces)) {
    for (const claim of PROHIBITED_CLAIMS) {
      assert.equal(claim.test(text(source)), false, `${name} must not claim ${claim}`);
    }
  }
});

test("required qualifications are stated on the buy, hub and verification surfaces", () => {
  assert.match(text(buyForm), /subject to confirmation/i);
  assert.match(text(buyForm), /documentation varies by part and source/i);
  assert.match(text(hubPage), /subject to confirmation/i);
  assert.match(text(hubPage), /appropriately approved repair facilities/i);
  assert.match(text(verifyComponent), /subject to confirmation/i);
  assert.match(text(verifyComponent), /documentation varies by part and source/i);
  assert.match(text(verifyComponent), /appropriately approved repair facilities/i);
  assert.match(text(verifyPage), /subject to confirmation/i);

  // Civilon sells to the buyer and sources internally; that framing is explicit
  // and the supplier relationship is never exposed to the customer.
  assert.match(text(hubPage), /Civilon is the seller/i);
  assert.match(text(verifyComponent), /reviews and sources/i);
  for (const source of [hubPage, hubView, buyPage, buyForm, verifyPage, verifyComponent]) {
    assert.equal(/nonregistered supplier|supplier cost|supplier identity/i.test(text(source)), false);
  }
});

test("the Sell card is an honest preview with no submission path", () => {
  assert.match(hubView, /Controlled preview — coming next/);
  assert.match(hubView, /is not\s*\n?\s*open here yet|not open here yet/);
  assert.equal(hubView.match(/<form\b/g), null, "a preview must not present a form");
  assert.equal(/\/api\/marketplace\/sell|sell-submissions/.test(hubView), false, "no Sell endpoint exists in this slice");
  // Its only action routes to a human.
  assert.match(hubView, /href="\/contact-us"/);
});

test("the intake API contract is unchanged by the UI slice", () => {
  assert.match(submitRoute, /isMarketplaceEnabled\(\)/);
  assert.match(submitRoute, /honeypot/);
  assert.match(submitRoute, /validateBuyRequestSubmission/);
  assert.match(submitRoute, /consumeMarketplaceAttempt/);
  assert.match(buyForm, new RegExp(`BUY_REQUEST_SUBMIT_PATH`));
  assert.match(buyForm, /sourcePage: BUY_REQUEST_SOURCE_PAGE/);
});
