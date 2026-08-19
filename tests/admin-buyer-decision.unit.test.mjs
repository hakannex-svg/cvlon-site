import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buyerOffers } from "../db/price-check/schema.ts";
import {
  BUYER_DECISION_OPEN_BUY_REQUEST_STATUSES,
  buyRequestDecisionState,
  buyerDecisions,
  isBuyerDecision,
  latestBuyerDecision,
} from "../db/price-check/domain/buyer-decision.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const repository = read("db", "price-check", "repositories", "marketplace-admin-repository.ts");
const component = read("components", "admin", "BuyerDecisionAlert.tsx");
const display = read("lib", "price-check", "admin", "display.ts");
const listView = read("components", "admin", "MarketplaceListView.tsx");
const buyPage = read("app", "admin", "buy-requests", "page.tsx");
const sellPage = read("app", "admin", "sell-submissions", "page.tsx");
const pricePage = read("app", "admin", "price-checks", "page.tsx");
const queuePage = read("app", "admin", "queue", "page.tsx");
const css = read("app", "globals.css");

const decisionSection = (() => {
  const start = repository.indexOf("/* Buyer decisions ");
  const end = repository.indexOf("/* Bulk-inventory freshness health ", start);
  assert.ok(start > 0 && end > start);
  return repository.slice(start, end);
})();

test("buyer decision vocabulary is exactly the two buyer-answer statuses", () => {
  assert.deepEqual([...buyerDecisions], ["accepted", "declined"]);
  assert.deepEqual([...buyerDecisions], buyerOffers.status.enumValues.filter((value) => ["accepted", "declined"].includes(value)));
  for (const value of buyerDecisions) assert.equal(isBuyerDecision(value), true);
  for (const value of [null, undefined, "", "Accepted", "sent", "expired", "accepted ", "accepted'--", 1, {}]) {
    assert.equal(isBuyerDecision(value), false, String(value));
  }
});

test("the pure rule reads only the highest version and excludes concluded requests", () => {
  assert.equal(latestBuyerDecision([]), null);
  assert.equal(latestBuyerDecision([{ version: 1, status: "accepted" }, { version: 2, status: "sent" }]), null);
  assert.equal(latestBuyerDecision([{ version: 3, status: "accepted" }, { version: 2, status: "declined" }]), "accepted");
  assert.equal(latestBuyerDecision([{ version: 3, status: "declined" }, { version: 1, status: "accepted" }]), "declined");
  for (const status of BUYER_DECISION_OPEN_BUY_REQUEST_STATUSES) {
    assert.equal(buyRequestDecisionState({ status, offers: [{ version: 1, status: "accepted" }] }), "accepted");
  }
  for (const status of ["converted", "closed", "spam", "withdrawn"]) {
    assert.equal(buyRequestDecisionState({ status, offers: [{ version: 1, status: "accepted" }] }), null);
  }
});

test("counter and list share one latest-version reading and malformed filters fail closed", () => {
  assert.match(decisionSection, /function buyerDecisionReading\(decision: BuyerDecision \| null\)/);
  assert.equal((decisionSection.match(/buyerDecisionReading\(/g) ?? []).length, 3, "definition, filter, and counter");
  assert.match(decisionSection, /order by o\."version" desc\s+limit 1/);
  assert.match(decisionSection, /b\."status"::text in \(\$\{buyerDecisionOpenStatusList\}\)/);
  assert.match(repository, /if \(filters\.decision && !isBuyerDecision\(filters\.decision\)\) return \[\];/);
  assert.match(repository, /if \(filters\.decision && !isBuyerDecision\(filters\.decision\)\) return counts;/);
  assert.match(decisionSection, /throw new Error\("Malformed buyer decision filter\."\)/);
  assert.match(decisionSection, /count\(distinct b\."id"\)::int/);
});

test("the decision surface is read-only and projects counts or existing list rows only", () => {
  for (const forbidden of [/\.insert\(/, /\.update\(/, /\.delete\(/, /\.transaction\(/, /for update/i, /skip locked/i]) {
    assert.doesNotMatch(decisionSection, forbidden);
  }
  for (const forbidden of [
    "supplier_unit_cost", "supplier_name_snapshot", "supplier_contact_snapshot", "documents_summary",
    "civilon_sale_unit_price", "shipping_and_export_scope", "business_email", "keyed_token_hash",
    "recipient_reference", "provider_message_id", "object_key",
  ]) {
    assert.equal(decisionSection.includes(forbidden), false, forbidden);
    assert.equal(component.includes(forbidden), false, forbidden);
  }
  assert.match(decisionSection, /export type BuyerDecisionCounts = Record<BuyerDecision, number>/);
  assert.match(decisionSection, /const counts: BuyerDecisionCounts = \{ accepted: 0, declined: 0 \}/);
});

test("All Work renders compact native drill-down links with honest scope", () => {
  assert.match(queuePage, /repository\.countBuyerDecisions\(priceCheckDb\)/);
  assert.match(queuePage, /<BuyerDecisionAlert counts=\{buyerDecisionCounts\} \/>/);
  assert.equal((component.match(/<a\b/g) ?? []).length, 1, "one mapped native anchor renders both links");
  assert.doesNotMatch(component, /next\/link|<Link\b/);
  assert.match(component, /\?decision=\$\{decision\}/);
  assert.match(display, /accepted: "Accepted — act now"/);
  assert.match(display, /declined: "Declined — follow up"/);
  assert.match(component, /buyerDecisionLabels\[decision\]/);
  for (const phrase of ["not proof of payment", "not\\s+certification", "airworthiness approval", "authenticity", "fitness", "Availability remains\\s+subject to confirmation"]) {
    assert.match(component, new RegExp(phrase, "i"), phrase);
  }
  assert.match(css, /\.admin-buyer-decisions\{/);
  assert.match(css, /@media\(max-width:700px\).*admin-buyer-decisions/s);
});

test("Buy Requests alone preserve and render the strict decision filter", () => {
  assert.match(buyPage, /const rawDecision = one\("decision"\)/);
  assert.match(buyPage, /decision: rawDecision \|\| undefined/);
  assert.match(buyPage, /decision=\{\{ value: rawDecision \}\}/);
  assert.match(listView, /if \(decision && isBuyerDecision\(decision\.value\)\) params\.set\("decision", decision\.value\)/);
  assert.match(listView, /<select name="decision"/);
  assert.match(listView, /defaultValue=\{isBuyerDecision\(decision\.value\) \? decision\.value : ""\}/);
  assert.match(listView, /buyerDecisions\.map\(value =>/);
  assert.match(listView, /buyerDecisionLabels\[value\]/);
  assert.doesNotMatch(sellPage, /decision=\{/);
  assert.doesNotMatch(pricePage, /decision=\{/);
  assert.match(repository, /if \(filters\.decision\) return null/);
  assert.match(repository, /filters\.freshness \|\| filters\.decision/);
  assert.match(listView, /<Link href=\{basePath\}>Clear<\/Link>/);
});
