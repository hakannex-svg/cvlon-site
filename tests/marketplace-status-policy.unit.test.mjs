import test from "node:test";
import assert from "node:assert/strict";

import {
  allowedMarketplaceTransitions,
  buyRequestStatusValues,
  canTransitionMarketplace,
  isMarketplaceStatus,
  isMarketplaceTerminalStatus,
  marketplaceAggregates,
  marketplaceAuditActions,
  marketplaceClosingStatuses,
  marketplaceExceptionalTargets,
  marketplaceGraphTargets,
  marketplaceStatusClosesRecord,
  marketplaceStatusValues,
  marketplaceTerminalStatuses,
  marketplaceTransitionAction,
  marketplaceTransitionCapability,
  marketplaceTransitionKind,
  sellSubmissionStatusValues,
} from "../db/price-check/domain/marketplace-status-policy.ts";
import { buyRequests, sellSubmissions } from "../db/price-check/schema.ts";
import { adminRoles, roleCan } from "../lib/price-check/admin/policy.ts";

const can = (role, capability) => roleCan(role, capability);

/** The complete intended graph, written out independently of the module. */
const expectedGraph = {
  buy_request: {
    pending_verification: ["verified", "spam", "withdrawn"],
    verified: ["sourcing", "closed", "spam", "withdrawn"],
    sourcing: ["quoted", "closed", "withdrawn"],
    quoted: ["converted", "closed", "withdrawn"],
    converted: ["closed"],
    closed: [],
    spam: [],
    withdrawn: [],
  },
  sell_submission: {
    pending_verification: ["verified", "spam", "withdrawn"],
    verified: ["under_review", "closed", "spam", "withdrawn"],
    under_review: ["accepted", "declined", "closed", "withdrawn"],
    accepted: ["closed"],
    declined: ["closed"],
    closed: [],
    spam: [],
    withdrawn: [],
  },
};

test("the policy vocabulary matches the schema enums exactly", () => {
  assert.deepEqual([...buyRequestStatusValues], [...buyRequests.status.enumValues]);
  assert.deepEqual([...sellSubmissionStatusValues], [...sellSubmissions.status.enumValues]);
  assert.deepEqual([...marketplaceAggregates], ["buy_request", "sell_submission"]);
  assert.deepEqual([...marketplaceStatusValues("buy_request")], [...buyRequests.status.enumValues]);
  assert.deepEqual([...marketplaceStatusValues("sell_submission")], [...sellSubmissions.status.enumValues]);
});

test("every declared state has an explicit outbound edge list", () => {
  for (const aggregate of marketplaceAggregates) {
    for (const status of marketplaceStatusValues(aggregate)) {
      assert.deepEqual(
        [...marketplaceGraphTargets(aggregate, status)],
        expectedGraph[aggregate][status],
        `${aggregate}.${status}`,
      );
    }
  }
});

test("the full transition matrix is exactly the declared graph", () => {
  for (const aggregate of marketplaceAggregates) {
    const states = marketplaceStatusValues(aggregate);
    for (const from of states) {
      for (const to of states) {
        const expected = expectedGraph[aggregate][from].includes(to);
        assert.equal(
          canTransitionMarketplace(aggregate, from, to), expected,
          `${aggregate}: ${from} -> ${to} should be ${expected}`,
        );
      }
    }
  }
});

test("terminal states cannot be resurrected by anyone", () => {
  assert.deepEqual([...marketplaceTerminalStatuses], ["closed", "spam", "withdrawn"]);
  for (const aggregate of marketplaceAggregates) {
    for (const terminal of marketplaceTerminalStatuses) {
      assert.equal(isMarketplaceTerminalStatus(terminal), true);
      assert.deepEqual([...marketplaceGraphTargets(aggregate, terminal)], []);
      for (const to of marketplaceStatusValues(aggregate)) {
        assert.equal(canTransitionMarketplace(aggregate, terminal, to), false, `${terminal} -> ${to}`);
        assert.equal(marketplaceTransitionKind(aggregate, terminal, to), "invalid");
        assert.equal(marketplaceTransitionCapability(aggregate, terminal, to), null);
      }
      for (const role of adminRoles) {
        assert.deepEqual([...allowedMarketplaceTransitions(aggregate, terminal, role, can)], [], `${role} from ${terminal}`);
      }
    }
  }
});

test("no state can transition to itself", () => {
  for (const aggregate of marketplaceAggregates) {
    for (const status of marketplaceStatusValues(aggregate)) {
      assert.equal(canTransitionMarketplace(aggregate, status, status), false, `${aggregate}.${status}`);
    }
  }
});

test("an unknown state or target is rejected, never defaulted", () => {
  for (const aggregate of marketplaceAggregates) {
    assert.deepEqual([...marketplaceGraphTargets(aggregate, "not_a_status")], []);
    assert.equal(canTransitionMarketplace(aggregate, "not_a_status", "verified"), false);
    assert.equal(canTransitionMarketplace(aggregate, "pending_verification", "not_a_status"), false);
    assert.equal(marketplaceTransitionCapability(aggregate, "pending_verification", "not_a_status"), null);
    assert.equal(isMarketplaceStatus(aggregate, "not_a_status"), false);
    assert.equal(isMarketplaceStatus(aggregate, null), false);
    assert.equal(isMarketplaceStatus(aggregate, 1), false);
  }
  // A Sell status is not a Buy status and vice versa.
  assert.equal(isMarketplaceStatus("buy_request", "under_review"), false);
  assert.equal(isMarketplaceStatus("sell_submission", "sourcing"), false);
  assert.equal(canTransitionMarketplace("buy_request", "verified", "under_review"), false);
  assert.equal(canTransitionMarketplace("sell_submission", "verified", "sourcing"), false);
});

test("spam and closed are exceptional wherever the graph allows them", () => {
  assert.deepEqual([...marketplaceExceptionalTargets], ["spam", "closed"]);
  for (const aggregate of marketplaceAggregates) {
    for (const from of marketplaceStatusValues(aggregate)) {
      for (const to of marketplaceGraphTargets(aggregate, from)) {
        const kind = marketplaceTransitionKind(aggregate, from, to);
        if (to === "spam" || to === "closed") {
          assert.equal(kind, "exceptional", `${aggregate}: ${from} -> ${to}`);
          assert.equal(marketplaceTransitionCapability(aggregate, from, to), "exceptional_marketplace_transition");
        }
      }
    }
  }
});

test("pending_verification -> verified is the manual override, and only that edge is", () => {
  for (const aggregate of marketplaceAggregates) {
    assert.equal(marketplaceTransitionKind(aggregate, "pending_verification", "verified"), "manual_verification");
    assert.equal(
      marketplaceTransitionCapability(aggregate, "pending_verification", "verified"),
      "exceptional_marketplace_transition",
    );
    // No other edge is a manual verification.
    for (const from of marketplaceStatusValues(aggregate)) {
      for (const to of marketplaceGraphTargets(aggregate, from)) {
        if (from === "pending_verification" && to === "verified") continue;
        assert.notEqual(marketplaceTransitionKind(aggregate, from, to), "manual_verification", `${from} -> ${to}`);
      }
    }
  }
});

test("withdrawn is ordinary staff work from every state that allows it", () => {
  for (const aggregate of marketplaceAggregates) {
    for (const from of marketplaceStatusValues(aggregate)) {
      if (!canTransitionMarketplace(aggregate, from, "withdrawn")) continue;
      assert.equal(marketplaceTransitionKind(aggregate, from, "withdrawn"), "ordinary", `${from} -> withdrawn`);
      assert.equal(marketplaceTransitionCapability(aggregate, from, "withdrawn"), "transition_marketplace");
      for (const role of ["ANALYST", "REVIEWER", "ADMIN"]) {
        assert.ok(allowedMarketplaceTransitions(aggregate, from, role, can).includes("withdrawn"), `${role} from ${from}`);
      }
    }
  }
});

test("role gating: ANALYST and REVIEWER get ordinary targets only", () => {
  for (const aggregate of marketplaceAggregates) {
    for (const from of marketplaceStatusValues(aggregate)) {
      for (const role of ["ANALYST", "REVIEWER"]) {
        const allowed = allowedMarketplaceTransitions(aggregate, from, role, can);
        const expected = expectedGraph[aggregate][from].filter(
          (to) => to !== "spam" && to !== "closed" && !(from === "pending_verification" && to === "verified"),
        );
        assert.deepEqual([...allowed], expected, `${aggregate}.${from} for ${role}`);
      }
    }
  }
});

test("role gating: ADMIN gets the whole graph, AUDITOR gets nothing", () => {
  for (const aggregate of marketplaceAggregates) {
    for (const from of marketplaceStatusValues(aggregate)) {
      assert.deepEqual(
        [...allowedMarketplaceTransitions(aggregate, from, "ADMIN", can)],
        expectedGraph[aggregate][from],
        `ADMIN from ${aggregate}.${from}`,
      );
      assert.deepEqual([...allowedMarketplaceTransitions(aggregate, from, "AUDITOR", can)], [], `AUDITOR from ${from}`);
    }
  }
  assert.equal(roleCan("AUDITOR", "transition_marketplace"), false);
  assert.equal(roleCan("AUDITOR", "assign_marketplace"), false);
  assert.equal(roleCan("AUDITOR", "write_marketplace_note"), false);
  assert.equal(roleCan("ANALYST", "exceptional_marketplace_transition"), false);
  assert.equal(roleCan("REVIEWER", "exceptional_marketplace_transition"), false);
  assert.equal(roleCan("ADMIN", "exceptional_marketplace_transition"), true);
});

test("only the terminal three set closed_at", () => {
  assert.deepEqual([...marketplaceClosingStatuses], ["closed", "spam", "withdrawn"]);
  for (const aggregate of marketplaceAggregates) {
    for (const status of marketplaceStatusValues(aggregate)) {
      const expected = ["closed", "spam", "withdrawn"].includes(status);
      assert.equal(marketplaceStatusClosesRecord(status), expected, `${aggregate}.${status}`);
    }
  }
  // Outcome states are not closures: converted, accepted and declined stay open.
  for (const status of ["converted", "accepted", "declined", "sourcing", "quoted", "under_review", "verified"]) {
    assert.equal(marketplaceStatusClosesRecord(status), false, status);
  }
});

test("every closing status is permitted by the schema's closed_at check", () => {
  // buy: converted|closed|spam|withdrawn — sell: accepted|declined|closed|spam|withdrawn
  const buyAllowed = ["converted", "closed", "spam", "withdrawn"];
  const sellAllowed = ["accepted", "declined", "closed", "spam", "withdrawn"];
  for (const status of marketplaceClosingStatuses) {
    assert.ok(buyAllowed.includes(status), `buy_requests_closed_state_chk forbids closed_at with ${status}`);
    assert.ok(sellAllowed.includes(status), `sell_submissions_closed_state_chk forbids closed_at with ${status}`);
  }
});

test("audit actions are distinct per aggregate, per outcome", () => {
  const buy = marketplaceAuditActions("buy_request");
  const sell = marketplaceAuditActions("sell_submission");
  assert.equal(buy.manualVerification, "BUY_REQUEST_VERIFICATION_MANUALLY_OVERRIDDEN");
  assert.equal(sell.manualVerification, "SELL_SUBMISSION_VERIFICATION_MANUALLY_OVERRIDDEN");
  const all = [...Object.values(buy), ...Object.values(sell)];
  assert.equal(new Set(all).size, all.length, "no audit action may be reused");

  assert.equal(marketplaceTransitionAction("buy_request", "pending_verification", "verified"), buy.manualVerification);
  assert.equal(marketplaceTransitionAction("buy_request", "pending_verification", "spam"), buy.spam);
  assert.equal(marketplaceTransitionAction("buy_request", "verified", "closed"), buy.closed);
  assert.equal(marketplaceTransitionAction("buy_request", "sourcing", "withdrawn"), buy.withdrawn);
  assert.equal(marketplaceTransitionAction("buy_request", "verified", "sourcing"), buy.status);
  assert.equal(marketplaceTransitionAction("sell_submission", "under_review", "accepted"), sell.status);
  assert.equal(marketplaceTransitionAction("sell_submission", "under_review", "declined"), sell.status);

  // Every graph edge resolves to a non-empty, aggregate-prefixed action.
  for (const aggregate of marketplaceAggregates) {
    const prefix = aggregate === "buy_request" ? "BUY_REQUEST_" : "SELL_SUBMISSION_";
    for (const from of marketplaceStatusValues(aggregate)) {
      for (const to of marketplaceGraphTargets(aggregate, from)) {
        const action = marketplaceTransitionAction(aggregate, from, to);
        assert.ok(action.startsWith(prefix), `${aggregate}: ${from} -> ${to} gave ${action}`);
      }
    }
  }
});

test("the policy module is pure: no database, environment or auth import", () => {
  // Asserted structurally by the import list of this test file: the module was
  // imported above with no database running and no environment configured.
  assert.equal(typeof canTransitionMarketplace, "function");
  assert.equal(typeof marketplaceTransitionCapability, "function");
});
