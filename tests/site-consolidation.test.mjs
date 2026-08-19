import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  PRIVATE_ANALYTICS_ROUTES,
  isPrivateAnalyticsRoute,
} from "../lib/analytics-private-routes.ts";
import {
  LEGACY_PART_SEARCH_ANCHOR,
  LEGACY_PART_SEARCH_HREF,
  partSearchHref,
} from "../lib/part-search-cta.ts";
import {
  BUY_REQUEST_SOURCE_PAGE,
  BUY_REQUEST_VERIFY_PATH,
  MARKETPLACE_HUB_PAGE,
  SELL_SUBMISSION_PAGE,
} from "../lib/marketplace/contract.ts";
import { SELL_SUBMISSION_VERIFY_PATH } from "../lib/marketplace/sell-contract.ts";
import { SELL_EVIDENCE_PAGE_PATH } from "../lib/marketplace/sell-evidence-contract.ts";
import { SELL_INVENTORY_FRESHNESS_PAGE_PATH } from "../lib/marketplace/sell-inventory-freshness-contract.ts";
import { BUYER_OFFER_PAGE_PATH } from "../lib/marketplace/buyer-offer-contract.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
/** JSX wraps prose across lines; behaviour cares about the rendered sentence. */
const text = (source) => source.replace(/\s+/g, " ");

const home = read("app", "page.tsx");
const header = read("components", "SiteHeader.tsx");
const footer = read("components", "SiteFooter.tsx");
const notFound = read("app", "not-found.tsx");
const interior = read("components", "Interior.tsx");
const partSearchSection = read("components", "PartSearchSection.tsx");
const buyRequestPanel = read("components", "BuyRequestPanel.tsx");
const publicChoices = read("components", "PublicChoices.tsx");
const hubPage = read("app", "buy-sell-aircraft-parts", "page.tsx");
const hubView = read("components", "marketplace", "MarketplaceHubView.tsx");
const priceCheckPage = read("app", "price-check", "page.tsx");
const resultPage = read("app", "price-check", "result", "page.tsx");
const bootstrap = read("components", "AnalyticsBootstrap.tsx");
const consent = read("components", "ConsentPreferences.tsx");

/* ------------------------------------------------- private-route exclusions */

test("the secure seller evidence and availability pages are private routes", () => {
  for (const route of [SELL_EVIDENCE_PAGE_PATH, SELL_INVENTORY_FRESHNESS_PAGE_PATH]) {
    assert.equal(isPrivateAnalyticsRoute(route), true, route);
    assert.equal(isPrivateAnalyticsRoute(`${route}/`), true, `${route}/`);
    assert.equal(isPrivateAnalyticsRoute(`${route}/anything`), true, `${route}/anything`);
  }
});

test("every known private surface is on the one shared list", () => {
  for (const route of [
    "/admin",
    "/price-check/result",
    BUY_REQUEST_VERIFY_PATH,
    BUYER_OFFER_PAGE_PATH,
    SELL_SUBMISSION_VERIFY_PATH,
    SELL_EVIDENCE_PAGE_PATH,
    SELL_INVENTORY_FRESHNESS_PAGE_PATH,
  ]) {
    assert.ok(PRIVATE_ANALYTICS_ROUTES.includes(route), `${route} must be on the shared list`);
    assert.equal(isPrivateAnalyticsRoute(route), true, route);
    assert.equal(isPrivateAnalyticsRoute(`${route}/child`), true, `${route}/child`);
  }
  // The list restates its route contracts rather than importing them, so it can
  // stay client-safe; nothing may be on it that no contract names.
  assert.equal(PRIVATE_ANALYTICS_ROUTES.length, 7);
});

test("public intake and hub routes stay eligible for analytics", () => {
  for (const route of [
    "/",
    "/parts",
    "/parts/avionics-instruments",
    "/aircraft",
    "/aircraft/beechcraft",
    "/about-us",
    "/contact-us",
    "/aog-services",
    "/price-check",
    MARKETPLACE_HUB_PAGE,
    BUY_REQUEST_SOURCE_PAGE,
    SELL_SUBMISSION_PAGE,
  ]) {
    assert.equal(isPrivateAnalyticsRoute(route), false, `${route} must remain public`);
  }
  // A private child never drags its public parent private, and a route that
  // merely shares a prefix string is not a child.
  assert.equal(isPrivateAnalyticsRoute("/buy-sell-aircraft-parts/selling"), false);
  assert.equal(isPrivateAnalyticsRoute("/administration"), false);
  assert.equal(isPrivateAnalyticsRoute("/price-check/results-guide"), false);
});

test("the bootstrap and the consent UI share one list and keep none of their own", () => {
  for (const [name, source] of [["bootstrap", bootstrap], ["consent", consent]]) {
    assert.match(source, /import \{ isPrivateAnalyticsRoute \} from "@\/lib\/analytics-private-routes";/, name);
    assert.match(source, /isPrivateAnalyticsRoute\(window\.location\.pathname\)/, name);
    // No second copy of the route strings can survive next to the shared call.
    assert.doesNotMatch(source, /path === "\/admin"/, name);
    assert.doesNotMatch(source, /path\.startsWith\(/, name);
  }
  // The consent UI returns before it republishes a stored preference, so a
  // previously granted consent cannot re-arm analytics on a private page.
  assert.match(consent, /if \(isPrivateAnalyticsRoute\(window\.location\.pathname\)\) return;\s*\n\s*const stored = window\.localStorage\.getItem\(STORAGE_KEY\);/);
});

/* --------------------------------------------- ordinary part-search routing */

test("an ordinary part search resolves to the Buy Request page when Buy intake is open", () => {
  const on = { NEXT_PUBLIC_MARKETPLACE_ENABLED: "true" };
  const off = { NEXT_PUBLIC_MARKETPLACE_ENABLED: "false" };
  assert.equal(partSearchHref(undefined, on), BUY_REQUEST_SOURCE_PAGE);
  assert.equal(partSearchHref(LEGACY_PART_SEARCH_ANCHOR, on), BUY_REQUEST_SOURCE_PAGE);
  // With the marketplace closed the Buy Request page answers 404, so the CTA
  // must fall back rather than point at a dead link.
  assert.equal(partSearchHref(undefined, off), LEGACY_PART_SEARCH_HREF);
  assert.equal(partSearchHref(LEGACY_PART_SEARCH_ANCHOR, off), LEGACY_PART_SEARCH_ANCHOR);
  assert.equal(partSearchHref(undefined, {}), LEGACY_PART_SEARCH_HREF);
});

test("global header, footer and 404 route their part-search CTA through the helper", () => {
  for (const [name, source] of [["header", header], ["footer", footer], ["not-found", notFound]]) {
    assert.match(source, /from "@\/lib\/part-search-cta"/, name);
    assert.match(source, /partSearchHref\(\)/, name);
    assert.doesNotMatch(source, /href="\/contact-us#rfq"/, `${name} must not hard-code the legacy anchor`);
  }
  // Both header CTAs — desktop bar and mobile menu — use the same resolution.
  assert.equal((header.match(/href=\{searchHref\}/g) ?? []).length, 2);
});

test("the homepage hero and sourcing CTAs point at the Buy Request flow", () => {
  assert.match(home, /const searchHref = partSearchHref\(LEGACY_PART_SEARCH_ANCHOR\);/);
  assert.equal((home.match(/href=\{searchHref\}/g) ?? []).length, 2);
  assert.doesNotMatch(home, /href="#rfq"/);
  // The legacy Netlify form is no longer the primary intake; it survives only
  // as the fallback for a build with the marketplace flag off.
  assert.match(home, /const buyRequestIntake = isMarketplaceEnabled\(\);/);
  assert.match(home, /buyRequestIntake\s*\n?\s*\? <BuyRequestPanel tone="dark" headingId="home-buy-request" \/>\s*\n?\s*: <RfqForm sourcePage="homepage" compactAog \/>/);
});

test("the compact homepage panel links into Buy Request and adds no second intake", () => {
  assert.match(buyRequestPanel, /href=\{BUY_REQUEST_SOURCE_PAGE\}/);
  assert.equal(buyRequestPanel.includes("<form"), false, "the panel is a link, never a second form");
  assert.doesNotMatch(buyRequestPanel, /trackCivilonEvent/);
  assert.match(text(buyRequestPanel), /subject to confirmation/i);
  assert.match(text(buyRequestPanel), /Documentation varies by part and source/i);
  // Urgent work still routes to the monitored desk rather than into Buy Request.
  assert.match(buyRequestPanel, /href="\/aog-services"/);
});

/* ------------------------------------------- legacy / service-form boundary */

test("ordinary sourcing pages route to Buy Request; service pages keep their own form", () => {
  for (const page of [
    ["app", "page.tsx"],
    ["app", "parts", "page.tsx"],
    ["app", "parts", "[category]", "page.tsx"],
    ["app", "aircraft", "page.tsx"],
    ["app", "aircraft", "[manufacturer]", "page.tsx"],
    ["app", "about-us", "page.tsx"],
    ["app", "contact-us", "page.tsx"],
  ]) {
    const source = read(...page);
    const name = page.join("/");
    if (name !== "app/page.tsx") assert.match(source, /<PartSearchSection\b/, name);
    assert.doesNotMatch(source, /<RfqSection\b/, `${name} must not keep the legacy section`);
  }

  // AOG, repair and documentation requests do not fit the Buy Request schema,
  // so those pages keep the legacy service-specific intake unchanged.
  for (const page of ["aog-services", "repair-management", "quality-assurance"]) {
    const source = read("app", page, "page.tsx");
    assert.match(source, /<RfqSection\b/, page);
  }
  assert.match(read("app", "aog-services", "page.tsx"), /defaultAog/);
  // And their heroes keep pointing at that form instead of leaving the page.
  for (const page of ["repair-management", "quality-assurance"]) {
    assert.match(read("app", page, "page.tsx"), /searchHref="#rfq"/, page);
  }
});

test("the routing section falls back to the legacy section and keeps the shared anchor", () => {
  assert.match(partSearchSection, /if \(!isMarketplaceEnabled\(\)\) return <RfqSection \{\.\.\.props\} \/>;/);
  // Every in-page "Start a part search" anchor on these pages targets id="rfq",
  // so both states must own it or the anchor resolves to nothing.
  assert.match(partSearchSection, /id="rfq"/);
  assert.match(interior, /id="rfq"/);
  assert.match(read("app", "aircraft", "page.tsx"), /href="#rfq"/);
});

/* ---------------------------------------------------- three public choices */

test("the homepage offers Price Check, Buy and Sell as three gated choices", () => {
  assert.match(home, /<PublicChoices \/>/);
  assert.match(publicChoices, /if \(isPriceCheckEnabled\(\)\) choices\.push\(/);
  assert.match(publicChoices, /if \(marketplaceEnabled\) choices\.push\(/);
  assert.match(publicChoices, /if \(isSellSubmissionEnabled\(\)\) choices\.push\(/);
  assert.match(publicChoices, /href: "\/price-check"/);
  assert.match(publicChoices, /href: BUY_REQUEST_SOURCE_PAGE/);
  assert.match(publicChoices, /href: SELL_SUBMISSION_PAGE/);
  // A card may never point at a route its own flag has not opened, and with
  // every flag off the section leaves no empty heading behind.
  assert.match(publicChoices, /if \(choices\.length === 0\) return null;/);
  // Each card is a heading plus one unambiguous link; no client analytics.
  assert.match(publicChoices, /<h3>\{choice\.title\}<\/h3>/);
  assert.doesNotMatch(publicChoices, /trackCivilonEvent|"use client"/);
});

test("the hub adds Price Check as a third card under its own flag", () => {
  assert.match(hubPage, /<MarketplaceHubView sellEnabled=\{isSellSubmissionEnabled\(\)\} priceCheckEnabled=\{isPriceCheckEnabled\(\)\} \/>/);
  assert.match(hubView, /priceCheckEnabled = false/, "the third card fails closed");
  assert.match(hubView, /\{priceCheckEnabled && \(/);
  assert.match(hubView, /href="\/price-check"/);
  // The Buy and Sell cards and their gates are untouched.
  assert.match(hubView, /href="\/buy-sell-aircraft-parts\/buy"/);
  assert.match(hubView, /\{sellEnabled \? \(/);
  assert.match(hubView, /Controlled preview — coming next/);
  // The Price Check card emits nothing: a click on it says nothing the hub view
  // event does not already record, and "price" has no place in an event payload.
  const priceCheckCard = hubView.slice(hubView.indexOf("{priceCheckEnabled && ("));
  assert.equal(priceCheckCard.includes("trackCivilonEvent"), false);
});

test("Price Check keeps its own explanation and offers buy and sell as adjacent paths", () => {
  // The existing proposition and human-review framing are unchanged.
  assert.match(priceCheckPage, /Before you approve the PO, check the market\./);
  assert.match(text(priceCheckPage), /not an appraisal, an instant result, a price guarantee/i);
  assert.match(priceCheckPage, /href=\{BUY_REQUEST_SOURCE_PAGE\}/);
  assert.match(priceCheckPage, /href=\{SELL_SUBMISSION_PAGE\}/);
  assert.match(priceCheckPage, /const buyEnabled = isMarketplaceEnabled\(\);/);
  assert.match(priceCheckPage, /const sellEnabled = isSellSubmissionEnabled\(\);/);
  assert.match(priceCheckPage, /\{\(buyEnabled \|\| sellEnabled\) && \(/);
  // Sellers are routed to Sell without Price Check being sold as a valuation.
  assert.match(text(priceCheckPage), /does not value your stock or tell you what to ask for it/i);
  assert.doesNotMatch(text(priceCheckPage), /what your inventory is worth|value your inventory/i);
});

/* ---------------------------------------------- secure result seller path */

test("the private result adds a plain Sell link and leaks nothing into the URL", () => {
  assert.match(resultPage, /function ResultSellPath\(\)/);
  assert.match(resultPage, /href=\{SELL_SUBMISSION_PAGE\}/);
  assert.match(resultPage, /\{isSellSubmissionEnabled\(\) && <ResultSellPath \/>\}/);
  assert.match(text(resultPage), /Sell this part to Civilon/);
  // The existing Buy Request conversion is untouched.
  assert.match(resultPage, /<ResultSourcingAction/);
  assert.match(resultPage, /partNumber=\{priceCheck\.originalPartNumber\}/);

  const sellPath = resultPage.slice(
    resultPage.indexOf("function ResultSellPath()"),
    resultPage.indexOf("export default async function"),
  );
  // No query string, no interpolation, no prefill: the link is one constant.
  assert.deepEqual(sellPath.match(/href=[^\s>]+/g), ["href={SELL_SUBMISSION_PAGE}"]);
  assert.doesNotMatch(sellPath, /encodeURIComponent|URLSearchParams|\$\{|\?[a-z]/);
  assert.doesNotMatch(sellPath, /priceCheck\b|requester|publicReference|partNumber|customer\./);
  // And this page stays out of the analytics stream entirely.
  assert.doesNotMatch(resultPage, /trackCivilonEvent/);
});
