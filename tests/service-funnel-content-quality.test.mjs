import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Content guards for the service and funnel pages.
 *
 * These assert the rendered sentence rather than the JSX, because JSX wraps
 * prose across lines and a qualifier that reads correctly to a customer can
 * look like three fragments in source. They also count occurrences: the failure
 * mode these pages had was not a missing qualifier but the same qualifier
 * repeated in the body, the bullets and the card of one section, which reads as
 * hedging rather than as the single legal statement it is.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
const flat = (source) => source.replace(/\s+/g, " ");
/** Only what a visitor reads: metadata strings are not body copy. */
const body = (source) => flat(source.slice(source.indexOf("export default function")));
const count = (source, pattern) => (source.match(pattern) ?? []).length;

const home = read("app", "page.tsx");
const priceCheckPage = read("app", "price-check", "page.tsx");
const priceCheckForm = read("components", "PriceCheckForm.tsx");
const hubPage = read("app", "buy-sell-aircraft-parts", "page.tsx");
const hubView = read("components", "marketplace", "MarketplaceHubView.tsx");
const buyPage = read("app", "buy-sell-aircraft-parts", "buy", "page.tsx");
const buyForm = read("components", "marketplace", "BuyRequestForm.tsx");
const sellPage = read("app", "buy-sell-aircraft-parts", "sell", "page.tsx");
const sellForm = read("components", "marketplace", "SellSubmissionForm.tsx");
const aogPage = read("app", "aog-services", "page.tsx");
const repairPage = read("app", "repair-management", "page.tsx");
const partsPage = read("app", "parts", "page.tsx");
const qualityPage = read("app", "quality-assurance", "page.tsx");
const publicCta = read("lib", "public-cta.ts");

/** Every source in scope, named for the assertion message. */
const SCOPED = [
  ["price-check", priceCheckPage], ["price-check form", priceCheckForm],
  ["hub", hubPage], ["hub view", hubView],
  ["buy", buyPage], ["buy form", buyForm],
  ["sell", sellPage], ["sell form", sellForm],
  ["aog", aogPage], ["repair", repairPage],
  ["parts", partsPage], ["quality", qualityPage],
];

const SELLER_DISCRETION = "Every submission gets an internal review; offers are at Civilon’s discretion";

/* -------------------------------------------------------------- micro-fix */

test("the homepage sourcing qualifier uses the approved sentence", () => {
  assert.equal(
    count(home, /Each option is confirmed for availability, together with the documentation supplied with it\./g),
    1,
  );
  assert.doesNotMatch(home, /Each sourcing option is confirmed for availability and the documentation supplied with it\./);
});

/* ---------------------------------------------------------- action naming */

test("one buyer action and one seller action are used across the funnel", () => {
  assert.match(publicCta, /buy: "Request a Part"/);
  assert.match(publicCta, /sell: "Offer Parts"/);
  // Each surface that offers an action takes the label from the shared
  // constant, so the pair cannot drift page by page.
  for (const [name, source] of [["hub view", hubView], ["price-check", priceCheckPage]]) {
    assert.match(source, /PUBLIC_CTA\.buy/, `${name} must use the shared buyer label`);
    assert.match(source, /PUBLIC_CTA\.sell/, `${name} must use the shared seller label`);
  }
  for (const [name, source] of SCOPED) {
    for (const drift of [
      /Start a part search/i, /Start a Buy Request/i, /Create Buy Request/i,
      /Send an RFQ/i, /Submit a request for quote/i,
      /Sell to Civilon <?span|Sell Now/i, /Buy Now/i,
    ]) {
      assert.doesNotMatch(flat(source), drift, `${name} must not use a drifted action label`);
    }
  }
  // URLs are unchanged by the relabelling.
  assert.match(hubView, /href="\/buy-sell-aircraft-parts\/buy"/);
  assert.match(hubView, /href="\/buy-sell-aircraft-parts\/sell"/);
});

/* ------------------------------------------------------------------- AOG */

test("the AOG page states the approved proof line and promises no response time", () => {
  assert.equal(count(aogPage, /The AOG line is answered by a live person, 24\/7\/365/g), 1);
  for (const promise of [
    /immediate initial response/i,
    /within one hour/i,
    /response time/i,
    /within \d+\s*(?:minutes?|hours?|hrs?|business days?|days?)/i,
    /\bin under \d+/i,
    /we target an?\b/i,
  ]) {
    assert.doesNotMatch(flat(aogPage), promise, `the AOG page must not promise ${promise}`);
  }
  // The shipping qualifier survives the rewrite, in active voice.
  assert.match(flat(aogPage), /Civilon does not guarantee a shipping method or an arrival time\./);
});

test("no scoped page promises a response time", () => {
  for (const [name, source] of SCOPED) {
    assert.doesNotMatch(
      flat(source),
      /within \d+\s*(?:minutes?|hours?|hrs?|business days?)/i,
      `${name} must not promise a response time`,
    );
  }
});

/* ------------------------------------------------- qualifier consolidation */

test("each scoped section carries its qualifier once, not in every element", () => {
  // Price Check: the lead sentence sells, one qualifier line disclaims.
  assert.equal(count(body(priceCheckPage), /not an appraisal, an instant result, a price guarantee/g), 1);
  assert.match(priceCheckPage, /className="section-qualifier section-qualifier-dark">A Price Check is informational/);
  // Hub and Buy: one confirmation qualifier per page body.
  assert.equal(count(body(hubPage), /subject to confirmation/g), 1);
  assert.equal(count(body(buyPage), /subject to confirmation/g), 1);
  // Sell: one discretion statement, in the note next to the form.
  assert.equal(count(body(sellPage), new RegExp(SELLER_DISCRETION, "g")), 1);
  assert.equal(count(body(sellPage), /subject to confirmation/g), 1);
});

/* -------------------------------------------------------- seller wording */

test("the seller qualifier uses the approved discretion wording", () => {
  for (const [name, source] of [["sell page", sellPage], ["sell form", sellForm], ["price-check", priceCheckPage]]) {
    assert.match(flat(source), new RegExp(SELLER_DISCRETION), `${name} must state the discretion qualifier`);
  }
  for (const [name, source] of [["sell page", sellPage], ["sell form", sellForm], ["hub view", hubView], ["price-check", priceCheckPage]]) {
    assert.doesNotMatch(flat(source), /not obliged to buy/i, `${name} must not use the obligation phrasing`);
  }
});

/* ------------------------------------------------------ human-reviewed cap */

test("the exact phrase human-reviewed stays within two uses per rendered page", () => {
  const pages = [
    ["/price-check", [priceCheckPage, priceCheckForm]],
    ["/buy-sell-aircraft-parts", [hubPage, hubView]],
    ["/buy-sell-aircraft-parts/buy", [buyPage, buyForm]],
    ["/buy-sell-aircraft-parts/sell", [sellPage, sellForm]],
    ["/aog-services", [aogPage]],
    ["/repair-management", [repairPage]],
    ["/parts", [partsPage]],
    ["/quality-assurance", [qualityPage]],
  ];
  for (const [route, sources] of pages) {
    const uses = sources.reduce((total, source) => total + count(source, /human-reviewed/gi), 0);
    assert.ok(uses <= 2, `${route} uses "human-reviewed" ${uses} times`);
  }
  // The alternatives carry the same meaning where the phrase was dropped.
  assert.match(flat(priceCheckPage), /a Civilon analyst reviews them/i);
  assert.match(flat(priceCheckPage), /reviewed by our desk/i);
  assert.match(flat(hubView), /reviewed by our desk/i);
});

/* -------------------------------------------------------- prohibited claims */

const PROHIBITED = [
  /\bwe certify\b/i, /\bCivilon certifies\b/i, /\bCivilon[- ]certified\b/i, /\bcertified parts\b/i,
  /\bwe guarantee\b/i, /\bguaranteed (?:availability|delivery|price|authenticity|fitness)\b/i,
  /\bwe approve\b/i, /\bFAA[- ]approved\b/i, /\bEASA[- ]approved\b/i,
  /\bapproved for (?:installation|flight|service)\b/i,
  /\bAS9120\b/i, /\bISO 9001\b/i, /\bASA[- ](?:accredited|certified)\b/i, /\baccredited\b/i,
  /\bin stock now\b/i, /\bsearch our inventory\b/i, /\bmarketplace listing\b/i,
  /\b[\d,]+\+? (?:parts|line items|customers|operators served|suppliers) (?:in stock|served|shipped)\b/i,
  /\btestimonial/i, /\bwhat our customers say\b/i,
];

test("no scoped public surface makes a prohibited certification, guarantee or accreditation claim", () => {
  for (const [name, source] of SCOPED) {
    for (const claim of PROHIBITED) {
      assert.doesNotMatch(flat(source), claim, `${name} must not claim ${claim}`);
    }
  }
});

test("the approved supplier and repair qualifiers are the ones used", () => {
  assert.match(flat(partsPage), /approved and vetted suppliers/);
  assert.match(flat(partsPage), /appropriately approved repair facilities where required/);
  assert.match(flat(hubPage), /appropriately approved repair facilities/);
  assert.match(flat(repairPage), /[Aa]ppropriately approved (?:third-party )?repair facilit/);
});

/* --------------------------------------------------- positioning and docs */

test("the positioning spine is stated where it is contextually useful", () => {
  assert.match(flat(hubPage), /Civilon is the seller/);
  assert.match(flat(buyPage), /Civilon is the seller/);
  assert.match(flat(priceCheckPage), /Civilon\s+is the seller/);
  // Nothing is publicly listed, on both sides.
  assert.match(flat(hubPage), /nothing on either side is published or listed/i);
  assert.match(flat(buyPage), /never published or listed/i);
  assert.match(flat(sellPage), /nothing you send is published, listed, or shown to a buyer/i);
  assert.match(flat(partsPage), /Nothing here is a public listing\./);
});

test("documentation statements stay aviation-specific and conditional", () => {
  assert.match(flat(qualityPage), /FAA 8130-3 where applicable/);
  assert.match(flat(qualityPage), /EASA Form 1 or dual release where applicable/);
  assert.match(flat(qualityPage), /Civilon identifies what is available with each quotation\./);
  assert.match(flat(partsPage), /Documentation varies by part condition and source\./);
  assert.match(flat(hubPage), /documentation varies by part and source/i);
  assert.match(flat(sellPage), /Documentation varies by part and source/);
});

/* -------------------------------------------------------- active voice */

test("the rewritten service copy reads in active voice", () => {
  assert.match(flat(partsPage), /Civilon works a requirement through selected stock/);
  assert.match(flat(partsPage), /Civilon reviews trace-to-source and the available supporting records/);
  assert.match(flat(repairPage), /The selected third-party facility performs the physical work/);
  assert.match(flat(repairPage), /Civilon reviews release-document and return requirements before shipment/);
  for (const [name, source] of [["parts", partsPage], ["repair", repairPage], ["quality", qualityPage]]) {
    assert.doesNotMatch(flat(source), /Requirements may be reviewed through/, name);
    assert.doesNotMatch(flat(source), /Document availability is identified/, name);
  }
});
