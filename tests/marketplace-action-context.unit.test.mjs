import assert from "node:assert/strict";
import test from "node:test";

import { registerServerModuleHooks } from "./helpers/server-module-hooks.mjs";

registerServerModuleHooks();

const { buildMarketplaceActionContext } = await import(
  "../lib/price-check/admin/marketplace-access.ts"
);

test("ADMIN receives the authorized next steps for a verified Buy Request", () => {
  const context = buildMarketplaceActionContext({
    aggregate: "buy_request",
    currentStatus: "verified",
    role: "ADMIN",
    staff: [],
  });

  assert.equal(context.canTransition, true);
  assert.deepEqual(
    [...context.statusOptions],
    ["sourcing", "closed", "spam", "withdrawn"],
  );
});

test("ordinary staff receive only ordinary transitions", () => {
  for (const role of ["ANALYST", "REVIEWER"]) {
    const context = buildMarketplaceActionContext({
      aggregate: "buy_request",
      currentStatus: "verified",
      role,
      staff: [],
    });

    assert.equal(context.canTransition, true, role);
    assert.deepEqual([...context.statusOptions], ["sourcing", "withdrawn"], role);
  }
});

test("AUDITOR receives no marketplace mutation controls", () => {
  const context = buildMarketplaceActionContext({
    aggregate: "sell_submission",
    currentStatus: "verified",
    role: "AUDITOR",
    staff: [],
  });

  assert.equal(context.canTransition, false);
  assert.equal(context.canAssign, false);
  assert.equal(context.canWriteNote, false);
  assert.deepEqual([...context.statusOptions], []);
});
