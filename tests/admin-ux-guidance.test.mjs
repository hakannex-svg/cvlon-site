import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { priceCheckStatuses } from "../db/price-check/domain/status-policy.ts";
import { getPriceCheckWorkflowGuidance, workflowPhases } from "../lib/price-check/admin/workflow-guidance.ts";

test("every persisted Price Check status maps to the five read-only workflow phases", () => {
  assert.deepEqual(workflowPhases.map((phase) => phase.title), [
    "Intake",
    "Verify Transaction",
    "Analyze Evidence",
    "Prepare Result",
    "Delivery & Follow-up",
  ]);
  for (const status of priceCheckStatuses) {
    const guidance = getPriceCheckWorkflowGuidance(status, true);
    assert.equal(guidance.phases.length, 5, status);
    assert.ok(guidance.currentPhase >= 0 && guidance.currentPhase < 5, status);
    assert.ok(guidance.nextAction.length > 20, status);
    assert.ok(guidance.phases.every((phase) => ["completed", "current", "upcoming", "attention"].includes(phase.state)), status);
  }
  assert.match(getPriceCheckWorkflowGuidance("quote_requested", true).nextAction, /requested a Civilon quote/i);
  assert.match(getPriceCheckWorkflowGuidance("submitted", false).nextAction, /^Assign the request/);
});

test("common admin navigation exposes authorized destinations and a compact mobile menu", async () => {
  const [chrome, css] = await Promise.all([
    readFile("components/admin/AdminChrome.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);
  assert.match(chrome, /Review Queue/);
  assert.match(chrome, /Operations Guide/);
  assert.match(chrome, /Open Civilon ↗/);
  assert.match(chrome, /user\.role === "ADMIN"[\s\S]*?\/admin\/staff/);
  assert.match(chrome, /aria-current=\{active === link\.key \? "page"/);
  assert.match(chrome, /<details className="admin-mobile-menu">/);
  assert.match(chrome, /Civilon Website/);
  assert.match(chrome, /label="Sign Out"/);
  assert.match(css, /\.admin-mobile-menu\{display:none\}/);
  assert.match(css, /\.admin-topbar \.admin-mobile-nav\{display:grid!important/);
});

test("authenticated help and request guidance remain read-only and use normal anchors", async () => {
  const [help, detail, overview] = await Promise.all([
    readFile("app/admin/help/page.tsx", "utf8"),
    readFile("app/admin/price-checks/[id]/page.tsx", "utf8"),
    readFile("components/admin/AdminWorkflowOverview.tsx", "utf8"),
  ]);
  assert.match(help, /getPriceCheckAdminAccess/);
  assert.match(help, /redirect\("\/admin\/login"\)/);
  assert.match(help, /active="help"/);
  assert.doesNotMatch(help, /fetch\(|method:\s*"POST"|<form/);
  for (const anchor of ["overview", "documents", "review", "comparables", "result", "activity"]) {
    assert.match(detail, new RegExp(`<a href="#${anchor}">`), anchor);
  }
  assert.doesNotMatch(overview, /fetch\(|useRouter|onClick|<button/);
  assert.match(detail, /Customer requested a Civilon quote/);
  assert.match(detail, /<details className="admin-panel admin-history-disclosure">/);
});
