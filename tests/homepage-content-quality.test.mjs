import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (source) => source.replace(/\s+/g, " ");

const home = read("app", "page.tsx");
const router = read("components", "HeroDecisionRouter.tsx");
const promotion = read("components", "PriceCheckPromotion.tsx");
const footer = read("components", "SiteFooter.tsx");
const ctas = read("lib", "public-cta.ts");
const css = read("app", "globals.css");

test("homepage removes the duplicated routes section and retains its unique proof points", () => {
  assert.doesNotMatch(home, /PublicChoices|Which of these do you need/);
  for (const proof of [
    "Civilon is the seller",
    "No account or sign-in required",
    "The result stays private to you",
    "Every submission gets an internal review; offers are at Civilon’s discretion",
  ]) assert.match(router, new RegExp(proof.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("homepage trust strip and proof claims stay inside the approved boundaries", () => {
  assert.doesNotMatch(home, /CONDITIONAL AVAILABILITY/);
  assert.match(home, /FAA 8130-3 \/ EASA Form 1 where applicable/);
  assert.match(home, /TRACE-TO-SOURCE REVIEW/);
  assert.match(home, /APPROVED & VETTED SUPPLIERS/);
  assert.match(home, /The AOG line is answered by a live person, 24\/7\/365\./);
  assert.match(footer, /© 2026 Civilon LLC · Est\. 2012/);
  assert.doesNotMatch(compact(home + promotion + footer), /AS9120|ISO 9001|ASA certified|fill rate|parts shipped|customers served/i);
});

test("homepage uses the approved action pair and one primary hero action", () => {
  assert.match(ctas, /buy: "Request a Part"/);
  assert.match(ctas, /sell: "Offer Parts"/);
  assert.match(router, /title: "REQUEST A PART"/);
  assert.match(router, /title: "OFFER PARTS"/);
  assert.equal((home.match(/className="button button-primary"/g) ?? []).length, 1);
  assert.match(home, /className="button button-ghost"/);
  assert.match(home, /className="button button-tertiary"/);
  assert.match(css, /\.button-tertiary/);
});

test("homepage consolidates qualifiers and limits human-reviewed repetition", () => {
  assert.equal((router.match(/Availability and documentation are confirmed per request\./g) ?? []).length, 1);
  assert.equal((home.match(/Each sourcing option is confirmed for availability and the documentation supplied with it\./g) ?? []).length, 1);
  assert.equal((promotion.match(/Price Check is informational—not an appraisal, instant result or price guarantee\./g) ?? []).length, 1);
  assert.equal((compact(home + router + promotion).match(/human-reviewed/gi) ?? []).length, 2);
  assert.doesNotMatch(home, /Availability is subject to confirmation/);
  assert.doesNotMatch(home, /Civilon is not obliged to buy/);
});

test("homepage repair and AOG copy use active, grammatical language", () => {
  assert.match(home, /We manage the repair end to end—evaluation, workscope, quote, monitoring and return—through appropriately approved repair facilities where required\./);
  assert.doesNotMatch(home, /Evaluation, workscope, quotation, monitoring/);
  assert.doesNotMatch(compact(home + router + promotion), /For an aircraft on ground/i);
});
