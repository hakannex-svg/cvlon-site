import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  acceptedDealExecutionSourceStatuses,
  canStartAcceptedDealExecution,
} from "../db/price-check/domain/accepted-deal-policy.ts";
import { roleCan } from "../lib/price-check/admin/policy.ts";
import { validateAcceptedDealExecution } from "../lib/marketplace/admin/accepted-deal-validation.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const policy = read("db", "price-check", "domain", "accepted-deal-policy.ts");
const repository = read("db", "price-check", "repositories", "accepted-deal-repository.ts");
const routes = read("lib", "marketplace", "admin", "accepted-deal-routes.ts");
const route = read("app", "api", "admin", "marketplace", "buy-requests", "[id]", "execution", "route.ts");
const detail = read("components", "admin", "BuyRequestDetail.tsx");
const action = read("components", "admin", "AcceptedDealExecutionAction.tsx");

test("only the three pre-conversion Buy states can start accepted-deal execution", () => {
  assert.deepEqual([...acceptedDealExecutionSourceStatuses], ["verified", "sourcing", "quoted"]);
  for (const status of acceptedDealExecutionSourceStatuses) {
    assert.equal(canStartAcceptedDealExecution(status), true, status);
  }
  for (const status of ["pending_verification", "converted", "closed", "spam", "withdrawn", "under_review"] ) {
    assert.equal(canStartAcceptedDealExecution(status), false, status);
  }
});

test("the execution body is strict and carries only the optimistic status fence", () => {
  for (const status of acceptedDealExecutionSourceStatuses) {
    assert.deepEqual(
      validateAcceptedDealExecution({ expectedStatus: status }),
      { ok: true, data: { expectedStatus: status } },
    );
  }
  for (const body of [
    null,
    [],
    {},
    { expectedStatus: "converted" },
    { expectedStatus: "verified", to: "converted" },
    { expectedStatus: "verified", force: true },
  ]) assert.equal(validateAcceptedDealExecution(body).ok, false, JSON.stringify(body));
});

test("the server route is same-origin, capability-gated, private and POST-only", () => {
  assert.match(routes, /requireStaffApi\("transition_marketplace"\)/);
  assert.match(routes, /verifyAdminMutationOrigin\(request\)/);
  assert.match(routes, /validateAcceptedDealExecution\(await readJsonBody\(request\)\)/);
  assert.match(routes, /startAcceptedDealExecution\(priceCheckDb/);
  assert.match(routes, /privateJson/);
  assert.doesNotMatch(routes, /manage_buyer_offer|requireAdminApi|getPriceCheckAdminAccess/);
  assert.equal(roleCan("ANALYST", "transition_marketplace"), true);
  assert.equal(roleCan("REVIEWER", "transition_marketplace"), true);
  assert.equal(roleCan("ADMIN", "transition_marketplace"), true);
  assert.equal(roleCan("AUDITOR", "transition_marketplace"), false);
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /export const POST = POST_startAcceptedDealExecution/);
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    assert.match(route, new RegExp(`export const ${method} = acceptedDealMethodNotAllowed`), method);
  }
});

test("the repository atomically binds expected status and the exact newest accepted offer", () => {
  assert.match(repository, /return db\.transaction\(async \(tx\) => \{/);
  assert.match(repository, /orderBy\(desc\(buyerOffers\.version\)\)/);
  assert.match(repository, /latestOffer\.status !== "accepted"/);
  assert.match(repository, /eq\(buyRequests\.status, input\.expectedStatus\)/);
  assert.match(repository, /\) = \$\{latestOffer\.id\}/);
  assert.match(repository, /\) = 'accepted'/);
  assert.match(repository, /status: "converted", updatedAt: now/);
  assert.match(policy, /BUY_REQUEST_EXECUTION_STARTED/);
  assert.match(repository, /beforeVersionReference: `status:\$\{request\.status\}`/);
  assert.match(repository, /afterVersionReference: "status:converted"/);
  assert.doesNotMatch(repository, /notificationOutbox|insert\(buyerOffers\)|update\(buyerOffers\)|supplierResponses/);
});

test("the accepted-deal panel alone renders the explicit one-click action", () => {
  assert.match(detail, /actions\.canTransition && canStartAcceptedDealExecution\(request\.status\)/);
  assert.match(detail, /<AcceptedDealExecutionAction\s+buyRequestId=\{request\.id\}\s+expectedStatus=\{request\.status\}/);
  assert.match(action, /Start execution — mark Converted/);
  assert.match(action, /body: JSON\.stringify\(\{ expectedStatus \}\)/);
  assert.match(action, /router\.refresh\(\)/);
  for (const phrase of [
    "does not mean payment",
    "procurement",
    "supplier reconfirmation",
    "documentation acceptance",
    "shipment",
    "export",
    "delivery",
    "certification",
    "airworthiness approval",
    "authenticity",
    "fitness",
    "confirmed availability",
  ]) assert.ok(action.includes(phrase), phrase);
  assert.doesNotMatch(action, /Postmark|notification|supplierUnitCost|civilonSaleUnitPrice|trackCivilonEvent/);
});
