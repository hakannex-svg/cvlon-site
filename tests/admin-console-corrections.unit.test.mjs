import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { adminRoles, roleCan } from "../lib/price-check/admin/policy.ts";
import { UNIFIED_QUEUE_LIMIT } from "../db/price-check/repositories/marketplace-admin-repository.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const buyDetail = read("components", "admin", "BuyRequestDetail.tsx");
const sellDetail = read("components", "admin", "SellSubmissionDetail.tsx");
const sellDetailPage = read("app", "admin", "sell-submissions", "[id]", "page.tsx");
const helpPage = read("app", "admin", "help", "page.tsx");
const queuePage = read("app", "admin", "queue", "page.tsx");

/* ------------------------------- empty states describe what staff can do now */

test("the Buy Request empty states offer the panel instead of deferring it", () => {
  // The supplier-response and buyer-offer panels ship in this build, so an
  // empty record must not tell staff the capability does not exist yet.
  assert.equal(/later slice/i.test(buyDetail), false, "no empty state may defer to a later slice");
  assert.equal(/arrives in a later/i.test(buyDetail), false);
  assert.equal(/coming soon|not yet available|future release/i.test(buyDetail), false);

  assert.match(buyDetail, /No supplier responses recorded yet\./);
  assert.match(buyDetail, /No Civilon offer drafted yet\./);

  // The empty state and the control it points at are on the same page.
  assert.match(buyDetail, /<SupplierResponseActions/);
  assert.match(buyDetail, /<BuyerOfferActions/);

  // Both panels are capability-gated, so the empty state only points a reader at
  // a control that reader can actually see. Otherwise it repeats, in a new form,
  // exactly the dishonesty the evidence link was corrected for.
  assert.match(buyDetail, /\{canRecordSupplierResponse\s*\n?\s*\? "No supplier responses recorded yet\. Use the panel below/);
  assert.match(buyDetail, /: "No supplier responses recorded yet\. Your role cannot record one\."/);
  assert.match(buyDetail, /\{canManageBuyerOffer\s*\n?\s*\? "No Civilon offer drafted yet\. Use the panel below/);
  assert.match(buyDetail, /: "No Civilon offer drafted yet\. Your role cannot draft one\."/);
});

test("no marketplace admin surface still promises a later slice", () => {
  for (const [name, source] of Object.entries({ buyDetail, sellDetail, queuePage })) {
    assert.equal(/later slice/i.test(source), false, `${name} must not defer to a later slice`);
  }
});

/* ----------------------------- evidence links match the caller's actual power */

test("the evidence link is offered only to a role that may actually download", () => {
  // The row needs both facts, and the capability is one of them.
  assert.match(sellDetail, /const storedClean = attachment\.scanState === "CLEAN" && !attachment\.deletedAt;/);
  assert.match(sellDetail, /const usable = storedClean && canDownload;/);
  assert.match(sellDetail, /canDownload: boolean/);

  // The "Open securely" anchor hangs off `usable`, not off the scan state.
  const anchor = sellDetail.indexOf("admin-evidence-open");
  const gate = sellDetail.indexOf("{usable");
  assert.ok(gate > 0 && gate < anchor, "the anchor must sit inside the usable branch");

  // An unauthorized role is told the truth about why, and is not sent to a 403.
  assert.match(sellDetail, /You do not have permission to open this file\./);
  assert.match(sellDetail, /storedClean\s*\n?\s*\?\s*"You do not have permission to open this file\."/);
});

test("the Sell detail page computes the download capability and passes it down", () => {
  assert.match(sellDetailPage, /import \{ roleCan \} from "@\/lib\/price-check\/admin\/policy";/);
  assert.match(sellDetailPage, /canDownloadEvidence=\{roleCan\(user\.role, "download_marketplace_evidence"\)\}/);
});

test("AUDITOR genuinely lacks the download capability the link is gated on", () => {
  // If this ever became true, the gate above would silently stop hiding anything.
  assert.equal(roleCan("AUDITOR", "download_marketplace_evidence"), false);
  assert.equal(roleCan("AUDITOR", "view_marketplace"), true);
  for (const role of adminRoles) {
    assert.equal(
      roleCan(role, "download_marketplace_evidence"),
      role !== "AUDITOR",
      `${role} download authority must match the rendered gate`,
    );
  }
});

/* ------------------------------------------ the guide covers all three workflows */

test("the operations guide is no longer Price-Check-only", () => {
  assert.equal(/Price Check operator help/.test(helpPage), false);
  assert.match(helpPage, /Civilon operator help/);
  assert.match(helpPage, /Buy Requests, Sell Submissions, and Price Check/);

  // The marketplace sections exist and are reachable from the jump navigation.
  assert.match(helpPage, /id="marketplace"/);
  assert.match(helpPage, /id="marketplace-limits"/);
  assert.match(helpPage, /href="#marketplace"/);
  assert.match(helpPage, /href="#marketplace-limits"/);

  // The Price Check guidance is preserved, not replaced.
  for (const kept of [
    /id="workflow"/,
    /id="extraction"/,
    /id="comparables"/,
    /id="confidence"/,
    /id="result"/,
    /id="troubleshooting"/,
    /priceCheckStatuses\.map/,
    /getPriceCheckWorkflowGuidance/,
  ]) {
    assert.match(helpPage, kept, `the Price Check guidance must survive: ${kept}`);
  }
});

test("the guide covers every marketplace topic staff need before touching a record", () => {
  for (const [topic, pattern] of Object.entries({
    "the three queues": /All Work<\/b>[\s\S]{0,240}Buy Requests<\/b> and <b>Sell Submissions/,
    "contact verification": /Pending verification<\/i> until the customer or supplier confirms their own email/,
    "audited staff override": /ADMIN may override that[\s\S]{0,200}audited under its own action/,
    "status, assignment, notes": /Status, assignment, notes/,
    "notes stay internal": /Notes are staff-only, append-only, and never reach a customer or a supplier/,
    "supplier responses internal": /Supplier responses<\/b> — internal sourcing only/,
    "nonregistered suppliers": /nonregistered supplier Civilon simply telephoned/,
    "offers are separate": /a buyer offer is Civilon&apos;s own separate sale terms/,
    "no supplier leakage": /no supplier identity, no supplier cost and no internal routing/,
    "buyer and supplier never meet": /The buyer and the supplier never see each other/,
    "clean scan required": /opened only while its malware scan is clean/,
    "no certification": /is a certification, an airworthiness approval, or a regulatory approval/,
    "no authenticity or fitness guarantee": /Nothing here guarantees authenticity, fitness for a purpose/,
    "documentation and availability qualified": /Documentation varies by part and source, and all availability is subject to confirmation/,
    "email is notification only": /Email is notification only/,
  })) {
    assert.match(helpPage, pattern, `the guide must cover ${topic}`);
  }
});

test("the guide stays short enough to read", () => {
  // A guide nobody finishes is not guidance. This is a ceiling, not a target.
  const marketplaceSection = helpPage.slice(
    helpPage.indexOf('id="marketplace"'),
    helpPage.indexOf('<div className="admin-help-grid">', helpPage.indexOf('id="marketplace-limits"')),
  );
  assert.ok(marketplaceSection.length > 0);
  const words = marketplaceSection.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
  assert.ok(words < 600, `the marketplace guidance is ${words} words; keep it under 600`);
});

/* ------------------------------------------------ the queue cap is stated plainly */

test("the unified queue says it shows at most the first 200 records", () => {
  assert.equal(UNIFIED_QUEUE_LIMIT, 200);

  // The number shown to staff is the real cap, not a second hardcoded copy.
  assert.match(queuePage, /\{UNIFIED_QUEUE_LIMIT\} records/);
  assert.match(queuePage, /UNIFIED_QUEUE_LIMIT,/, "the limit must be imported, not retyped");
  assert.equal(/first 200 records/.test(queuePage), false, "do not hardcode the cap in prose");

  // It is explicitly not a total, and it points at the remedy.
  assert.match(queuePage, /It is not a total/);
  assert.match(queuePage, /narrow the view with the filters/);

  // The counter no longer reads like a total either.
  assert.equal(/visible records/.test(queuePage), false);
  assert.match(queuePage, /<span>records shown<\/span>/);
});
