import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
const flat = (source) => source.replace(/\s+/g, " ");

const about = flat(read("app", "about-us", "page.tsx"));
const home = flat(read("app", "page.tsx"));
const footer = flat(read("components", "SiteFooter.tsx"));
const aircraftIndex = flat(read("app", "aircraft", "page.tsx"));
const aircraftTemplate = flat(read("app", "aircraft", "[manufacturer]", "page.tsx"));
const contact = flat(read("app", "contact-us", "page.tsx"));
const css = flat(read("app", "globals.css"));

test("About uses the approved company story and metadata", () => {
  for (const approved of [
    "Built to be accountable.",
    "Parts buying has too many middlemen and not enough ownership.",
    "A parts desk that thinks like a freight desk.",
    "Private by design.",
    "You deal with one counterparty.",
    "Buyers and suppliers stay separated.",
    "The paperwork is part of the part.",
    "We'd rather be clear than impressive.",
    "About Civilon | Business Aircraft Parts Sourcing, Englewood Cliffs NJ",
  ]) assert.match(about, new RegExp(approved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((about.match(/className="section-qualifier"/g) ?? []).length, 2);
  assert.doesNotMatch(about, /ShipNex|AS9120|ISO 9001|ASA[- ](?:accredited|certified)|\[HAKAN/i);
});

test("homepage carries the approved WHO WE ARE block and footer fact", () => {
  assert.match(home, /WHO WE ARE/);
  assert.match(home, /Civilon is an independent parts-sourcing desk in Englewood Cliffs, New Jersey, established in 2012/);
  assert.match(home, /href="\/about-us">About Civilon/);
  assert.match(footer, /© 2026 Civilon LLC · Est\. 2012\. All rights reserved\./);
});

test("aircraft coverage carries one compact hero qualifier", () => {
  const qualifier = /Platform coverage does not imply live inventory; availability and documentation are confirmed per request\./g;
  assert.equal((aircraftIndex.match(qualifier) ?? []).length, 1);
  assert.equal((aircraftTemplate.match(qualifier) ?? []).length, 1);
  assert.doesNotMatch(aircraftIndex, /subject to availability/i);
});

test("contact uses only the approved AOG response statement", () => {
  assert.match(contact, /The AOG line and WhatsApp are monitored by a live person, 24\/7\/365\./);
  assert.doesNotMatch(contact, /within one hour|immediate initial response|aircraft[- ]on[- ]ground/i);
  assert.equal((contact.match(/className="section-qualifier"/g) ?? []).length, 1);
});

test("the paperwork image uses a bottom gradient without dimming the source", () => {
  assert.match(css, /\.quality-visual:after[^}]*linear-gradient\(0deg,rgba\(4,18,33,\.76\)[^}]*transparent 58%/);
  assert.match(css, /\.quality-visual>picture[^}]*opacity:1/);
  assert.doesNotMatch(css, /\.quality-visual>picture[^}]*opacity:\.86/);
});

test("public action and stale-phrase sweep remains clean", () => {
  const files = [
    ["app", "aircraft", "page.tsx"], ["app", "aircraft", "[manufacturer]", "page.tsx"],
    ["app", "about-us", "page.tsx"], ["app", "contact-us", "page.tsx"],
    ["components", "HeroDecisionRouter.tsx"], ["components", "Interior.tsx"],
    ["components", "PriceCheckForm.tsx"], ["components", "RfqForm.tsx"],
    ["components", "marketplace", "BuyRequestForm.tsx"],
    ["components", "marketplace", "SellEvidenceRequest.tsx"],
    ["components", "marketplace", "SellInventoryFreshness.tsx"],
    ["components", "marketplace", "SellSubmissionVerification.tsx"],
    ["lib", "marketplace", "email", "sell-evidence-templates.ts"],
    ["lib", "marketplace", "email", "sell-inventory-freshness-templates.ts"],
    ["lib", "marketplace", "email", "sell-submission-templates.ts"],
  ].map((parts) => flat(read(...parts))).join(" ");
  assert.doesNotMatch(files, /Submit parts|Buy an aircraft part|not obliged|aircraft[- ]on[- ]ground|Sell aircraft parts|Submit aircraft parts|Request an aircraft part/i);
  assert.match(files, /Request a Part/);
  assert.match(files, /offers are at Civilon(?:'|&rsquo;)s discretion/i);
});
