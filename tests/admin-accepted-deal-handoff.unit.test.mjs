/**
 * The accepted-deal handoff on the Buy Request detail page.
 *
 * Two kinds of assertion, and they are deliberately different in weight. The
 * visibility rule is executed here against the same pure functions the page
 * imports, so "which offer is current" and "is this request over" are proved
 * rather than described. The rendering itself is TSX and cannot be imported, so
 * it is held to the source: the component must spell the gate as exactly that
 * pair of functions, which is what stops the executable half from drifting into
 * a second, private rule that only the test believes in.
 *
 * The panel reports. It stores nothing, mutates nothing, and adds no route: the
 * one write it can lead to is the existing audited note.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  BUYER_DECISION_CONCLUDED_BUY_REQUEST_STATUSES,
  latestBuyerDecision,
} from "../db/price-check/domain/buyer-decision.ts";
import {
  buyRequestStatusValues,
  isMarketplaceTerminalStatus,
  marketplaceTerminalStatuses,
} from "../db/price-check/domain/marketplace-status-policy.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const buyDetail = read("components", "admin", "BuyRequestDetail.tsx");
const sellDetail = read("components", "admin", "SellSubmissionDetail.tsx");
const actions = read("components", "admin", "MarketplaceDetailActions.tsx");
const help = read("app", "admin", "help", "page.tsx");
const css = read("app", "globals.css");

/** The handoff panel alone, from its own id up to the notes panel below it. */
const panel = (() => {
  const start = buyDetail.indexOf('id="accepted-deal"');
  const end = buyDetail.indexOf("<MarketplaceNotesPanel", start);
  assert.ok(start > 0 && end > start, "the accepted-deal panel must be present");
  return buyDetail.slice(start, end);
})();

/** The note template, as the literal the component actually joins. */
const template = (() => {
  const start = buyDetail.indexOf("function acceptedDealNoteTemplate(");
  const end = buyDetail.indexOf('].join("\\n");', start);
  assert.ok(start > 0 && end > start, "the note template must be present");
  return buyDetail.slice(start, end);
})();

/**
 * The visibility rule, executed against the real domain functions.
 *
 * Written here in the same three clauses the component uses, and the source
 * assertion below pins the component to them. `latestBuyerDecision` decides
 * which answer is current; the highest-version offer is only which row gets
 * described; `isMarketplaceTerminalStatus` decides whether the request is over.
 */
function handoffVisible(status, offers) {
  const current = offers.reduce((highest, offer) =>
    (!highest || offer.version > highest.version ? offer : highest), null);
  return latestBuyerDecision(offers) === "accepted"
    && current?.status === "accepted"
    && !isMarketplaceTerminalStatus(status);
}

/* ------------------------------------------------------------ visibility rule */

test("the current highest accepted offer shows the handoff", () => {
  assert.equal(handoffVisible("quoted", [{ version: 1, status: "accepted" }]), true);
  assert.equal(handoffVisible("quoted", [
    { version: 1, status: "declined" },
    { version: 2, status: "accepted" },
  ]), true);
  assert.equal(handoffVisible("sourcing", [
    { version: 3, status: "accepted" },
    { version: 2, status: "superseded" },
    { version: 1, status: "expired" },
  ]), true);
});

test("an older acceptance under a newer offer is history, not an active handoff", () => {
  for (const newest of ["draft", "sent", "expired", "superseded", "withdrawn", "declined"]) {
    assert.equal(
      handoffVisible("quoted", [{ version: 1, status: "accepted" }, { version: 2, status: newest }]),
      false,
      `a newer ${newest} offer must hide the handoff`,
    );
  }
  // And with no offer at all there is nothing to hand off.
  assert.equal(handoffVisible("quoted", []), false);
  assert.equal(handoffVisible("quoted", [{ version: 1, status: "sent" }]), false);
});

test("converted keeps the handoff; only the terminal three remove it", () => {
  // Converted means Civilon is carrying the accepted deal out and still has to
  // close it. That is exactly when the checklist is in use.
  assert.equal(handoffVisible("converted", [{ version: 2, status: "accepted" }]), true);
  for (const status of ["closed", "spam", "withdrawn"]) {
    assert.equal(handoffVisible(status, [{ version: 2, status: "accepted" }]), false, status);
  }
  // Every other Buy Request status keeps it.
  for (const status of buyRequestStatusValues) {
    assert.equal(
      handoffVisible(status, [{ version: 1, status: "accepted" }]),
      !marketplaceTerminalStatuses.includes(status),
      status,
    );
  }
  // The counter's concluded set is deliberately a different rule, and the
  // difference is `converted`. If the two ever became the same set this test
  // would be asserting nothing.
  assert.ok(BUYER_DECISION_CONCLUDED_BUY_REQUEST_STATUSES.includes("converted"));
  assert.equal(marketplaceTerminalStatuses.includes("converted"), false);
});

test("the component spells the gate as exactly those two domain functions", () => {
  assert.match(buyDetail, /import \{ latestBuyerDecision \} from "@\/db\/price-check\/domain\/buyer-decision";/);
  assert.match(buyDetail, /import \{ isMarketplaceTerminalStatus, marketplaceExceptionalTargets \} from "@\/db\/price-check\/domain\/marketplace-status-policy";/);
  assert.match(buyDetail, /const acceptedOffer = latestBuyerDecision\(detail\.buyerOffers\) === "accepted"\s*\n\s*&& currentOffer\?\.status === "accepted"\s*\n\s*&& !isMarketplaceTerminalStatus\(request\.status\)/);
  assert.match(buyDetail, /\(highest, offer\) => \(!highest \|\| offer\.version > highest\.version \? offer : highest\)/);
  // The panel hangs off that one binding and nothing else.
  assert.match(buyDetail, /\{acceptedOffer \? <section className="admin-panel" id="accepted-deal"/);
  assert.match(buyDetail, /<\/section> : null\}/);
  // No second, private status list.
  assert.doesNotMatch(buyDetail, /BUYER_DECISION_CONCLUDED_BUY_REQUEST_STATUSES|buyRequestDecisionState/);
  assert.doesNotMatch(buyDetail, /"closed", "spam", "withdrawn"/);
});

/* ------------------------------------------------------------ what it reports */

test("the panel reports the accepted offer, the owner and the honest caveats", () => {
  assert.match(panel, /<Field label="Accepted offer version">\{acceptedOffer\.version\}<\/Field>/);
  assert.match(panel, /<Field label="Buyer responded">\{value\(acceptedOffer\.respondedAt\)\}<\/Field>/);
  assert.match(panel, /staffDisplayName\(detail\.assignee\?\.email \?\? null\)/);
  assert.match(panel, /selectedResponseCount === 0/);
  assert.match(panel, /deliveryOptionLabels\[acceptedOffer\.deliveryOption\]/);
  assert.match(panel, /value\(acceptedOffer\.shippingAndExportScope\)/);

  // Selection is a sourcing choice and is said to be one.
  assert.match(panel, /is not supplier reconfirmation, and it is not a Civilon confirmation that the part is available/);
  // Promised scope is not evidence of execution, and routing stays internal.
  assert.match(panel, /not proof that any of it was carried out/);
  assert.match(panel, /supplier-direct or through Civilon New Jersey is a separate internal decision that never appears on a buyer offer/);
  // Acceptance is a decision signal and nothing else.
  for (const phrase of [
    "not payment", "not a purchase order", "not procurement", "not supplier reconfirmation",
    "not shipment", "not delivery", "not acceptance of documentation",
    "not certification", "not an airworthiness approval", "no guarantee of authenticity or fitness",
    "subject to confirmation",
  ]) {
    assert.ok(panel.includes(phrase), phrase);
  }
  // The checklist is guidance; the records stay the record.
  assert.match(panel, /This checklist is guidance for staff, not a record of anything/);
  assert.match(panel, /<a href="\/admin\/help#accepted-deal">/);
});

test("the checklist is the six agreed steps and links to existing controls", () => {
  const steps = panel.match(/<li><b>[^<]+<\/b>/g) ?? [];
  assert.equal(steps.length, 6, "the checklist must be exactly six steps");
  for (const heading of [
    "Assign an owner",
    "Reconfirm with the supplier",
    "Handle the customer&apos;s commercial and payment terms externally",
    "Choose and record the internal route",
    "Coordinate shipping and export",
    "Convert, then close",
  ]) {
    assert.ok(panel.includes(`<b>${heading}</b>`), heading);
  }
  // Native anchors into sections that actually carry those ids.
  for (const anchor of ["#record-actions", "#supplier-responses", "#civilon-offer"]) {
    assert.ok(panel.includes(`href="${anchor}"`), anchor);
  }
  assert.match(buyDetail, /<section className="admin-panel" id="supplier-responses" aria-label="Supplier responses">/);
  assert.match(buyDetail, /<section className="admin-panel" id="civilon-offer" aria-label="Civilon buyer offers">/);
  assert.match(actions, /className="admin-panel admin-actions-panel" id="record-actions"/);
  assert.doesNotMatch(panel, /next\/link|<Link\b/);
  // Staff are told never to type a credential into the console.
  assert.match(panel, /Never type payment credentials, banking data, card details, tokens or secrets into this console/);
});

/* -------------------------------------------------------------- note template */

test("the note template carries every required field and no resolved claim", () => {
  for (const field of [
    "Accepted offer version:",
    "Owner / next action:",
    "Supplier reconfirmation (supplier claim only, never a Civilon confirmation of availability):",
    "Customer terms handled externally (no payment credentials, no banking data, no card details):",
    "Internal route: not determined / supplier direct / Civilon New Jersey",
    "Documentation operational review: not reviewed / reviewed / concern (not certification, not an airworthiness approval)",
    "Shipping / export coordination:",
    "Delivery / cancellation outcome:",
  ]) {
    assert.ok(template.includes(field), field);
  }
  // The version comes from the accepted offer, not from a guess.
  assert.match(template, /\$\{offer\.version\}/);
  // Nothing in the template asserts that a step was completed.
  for (const forbidden of [
    /\breconfirmed\b/i, /\bpaid\b/i, /\bshipped\b/i, /\bdelivered\b/i,
    /\bconfirmed available\b/i, /\bavailability confirmed\b/i,
    /Civilon guarantees/i, /quality guaranteed/i, /\bcertifie[sd]\b/i,
  ]) {
    assert.doesNotMatch(template, forbidden, String(forbidden));
  }
  // And it asks for nothing that must never be typed into a note.
  for (const forbidden of [/card number/i, /\biban\b/i, /\bcvv\b/i, /routing number/i, /password/i, /\btoken:/i]) {
    assert.doesNotMatch(template, forbidden, String(forbidden));
  }
});

test("the template control fills the box, never submits, and never overwrites", () => {
  // It is a button, not a submit, so the note form cannot fire from it.
  assert.match(actions, /<button\s+type="button"\s+disabled=\{busy \|\| templateBlocked\}\s+onClick=\{\(\) => \{ if \(templateBlocked \|\| !noteTemplate\) return; setNote\(noteTemplate\); \}\}/);
  // Blocked on any text at all, not on text that survives trimming.
  assert.match(actions, /const templateBlocked = note\.length > 0;/);
  // The handler does one thing. It posts nothing and saves nothing.
  const handler = actions.slice(actions.indexOf("{noteTemplate ? <div"), actions.indexOf('<button type="submit" disabled={busy || !note.trim()}'));
  assert.doesNotMatch(handler, /post\(|fetch\(|type="submit"|router\.refresh/);
  assert.match(handler, /The template will not replace text you have written/);
  assert.match(handler, /It saves nothing/);
  // Saving is still the one existing audited route.
  assert.equal((actions.match(/void post\("note", "notes"/g) ?? []).length, 1);
  assert.match(css, /\.admin-note-template\{/);
});

test("the template props are optional and Sell Submission passes none", () => {
  assert.match(actions, /noteTemplate\?: string;/);
  assert.match(actions, /noteTemplateLabel\?: string;/);
  assert.match(actions, /\{noteTemplateLabel \?\? "Insert template"\}/);
  // Absent props mean the control does not render at all.
  assert.match(actions, /\{noteTemplate \? <div className="admin-note-template">/);

  const sellUse = sellDetail.slice(
    sellDetail.indexOf("<MarketplaceDetailActions"),
    sellDetail.indexOf("/>", sellDetail.indexOf("<MarketplaceDetailActions")),
  );
  assert.ok(sellUse.length > 0, "the Sell detail must still use the shared actions panel");
  assert.doesNotMatch(sellUse, /noteTemplate/);
  assert.doesNotMatch(sellDetail, /noteTemplate|acceptedDealNoteTemplate|accepted-deal/);

  const buyUse = buyDetail.slice(
    buyDetail.indexOf("<MarketplaceDetailActions"),
    buyDetail.indexOf("/>", buyDetail.indexOf("<MarketplaceDetailActions")),
  );
  assert.match(buyUse, /noteTemplate=\{acceptedOffer \? acceptedDealNoteTemplate\(acceptedOffer\) : undefined\}/);
  assert.match(buyUse, /noteTemplateLabel="Start an accepted-deal note"/);
});

/* --------------------------------------------------------------- what it is not */

test("the panel leaks no supplier detail, no secret and no buyer-facing mutation", () => {
  for (const forbidden of [
    "supplierNameSnapshot", "supplierContactSnapshot", "supplierCountry", "supplierUnitCost",
    "supplierKind", "availabilityState", "shippingNotes", "recordedByEmail", "documentsSummary",
    "selectedSupplierResponseId", "civilonSaleUnitPrice", "currencyCode",
    "objectKey", "object_key", "tokenHash", "keyedTokenHash", "getSignedUrl", "amazonaws",
    "businessEmail", "notificationOutbox", "providerMessageId",
  ]) {
    assert.equal(panel.includes(forbidden), false, `the handoff panel must not reference ${forbidden}`);
  }
  // No price, no margin, no arithmetic across the two economic sides.
  assert.doesNotMatch(panel, /money\(|margin/i);
  // It writes nothing and reaches no buyer.
  assert.doesNotMatch(panel, /fetch\(|method:\s*"POST"|onClick=|onSubmit=|useState|mailto:|<form/);
  assert.doesNotMatch(panel, /trackCivilonEvent|dataLayer|civilonAnalytics/);
  // It is marked internal, like every other internal section.
  assert.match(panel, /<InternalOnlyBadge \/>/);
  // No banned assurance anywhere in the panel.
  for (const banned of [/Civilon guarantees/i, /quality guaranteed/i, /availability confirmed/i, /\bcertifie[sd]\b/i]) {
    assert.doesNotMatch(panel, banned, String(banned));
  }
});

test("the operations guide explains the workflow without promoting it to a record", () => {
  assert.ok(help.includes('<a href="#accepted-deal">Accepted deals</a>'), "the jump nav must link the section");
  assert.match(help, /<section id="accepted-deal" className="admin-panel">/);
  assert.match(help, /An older acceptance underneath a newer draft or sent offer is history/);
  assert.match(help, /The panel stays visible on a Converted request/);
  assert.match(help, /it stores nothing and proves nothing/);
  assert.match(help, /The stored facts remain the request status, the assignment, the supplier responses, the Civilon offer, the internal notes and the audit trail/);
  assert.match(help, /It never saves, never submits, and is refused while the box already holds text/);
  // The guide still writes nothing.
  assert.doesNotMatch(help, /fetch\(|method:\s*"POST"|<form/);
});
