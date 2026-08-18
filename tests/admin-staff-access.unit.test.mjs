import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  adminRoles,
  marketplaceCapabilities,
  roleCan,
} from "../lib/price-check/admin/policy.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const auth = read("lib", "price-check", "admin", "auth.ts");

/** The capabilities every role that does ordinary marketplace work must hold. */
const ordinaryMarketplaceWork = [
  "view_marketplace",
  "assign_marketplace",
  "transition_marketplace",
  "write_marketplace_note",
  "download_marketplace_evidence",
  "record_supplier_response",
];

test("requireStaffApi is product-flag independent", () => {
  const body = auth.slice(
    auth.indexOf("export async function requireStaffApi"),
    auth.indexOf("export async function requireAdminApi"),
  );
  assert.ok(body.length > 0, "requireStaffApi must be declared before requireAdminApi");
  assert.match(body, /await getAdminAccess\(\)/);
  assert.doesNotMatch(body, /getPriceCheckAdminAccess/);
  assert.doesNotMatch(body, /isPriceCheckEnabled/);
  assert.doesNotMatch(body, /isMarketplaceEnabled|NEXT_PUBLIC_MARKETPLACE_ENABLED|NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED/);
  assert.match(body, /roleCan\(access\.user\.role, capability\)/);
});

test("getAdminAccess itself depends on no product feature flag", () => {
  const body = auth.slice(
    auth.indexOf("export async function getAdminAccess"),
    auth.indexOf("export async function getPriceCheckAdminAccess"),
  );
  assert.doesNotMatch(body, /isPriceCheckEnabled|isMarketplaceEnabled|NEXT_PUBLIC_/);
});

test("requireAdminApi and getPriceCheckAdminAccess keep their Price Check gate", () => {
  // Slice 0 adds a sibling guard; it must not relax the existing Price Check API.
  assert.match(auth, /export async function requireAdminApi\(capability: AdminCapability\) \{\s*const access = await getPriceCheckAdminAccess\(\);/);
  assert.match(auth, /export async function getPriceCheckAdminAccess\(\): Promise<AdminAccess> \{\s*if \(!isPriceCheckEnabled\(\)\) return \{ status: "disabled" \};\s*return getAdminAccess\(\);/);
});

test("marketplace capability list is complete and exported", () => {
  assert.deepEqual([...marketplaceCapabilities], [
    ...ordinaryMarketplaceWork,
    "manage_buyer_offer",
    "exceptional_marketplace_transition",
    // Preview-only manual notification drain. ADMIN-only, like the two above.
    "process_marketplace_notifications",
  ]);
});

test("ADMIN holds every marketplace capability", () => {
  for (const capability of marketplaceCapabilities) {
    assert.equal(roleCan("ADMIN", capability), true, `ADMIN should hold ${capability}`);
  }
});

test("AUDITOR is read-only across both workflows", () => {
  assert.equal(roleCan("AUDITOR", "view_marketplace"), true);
  for (const capability of marketplaceCapabilities) {
    if (capability === "view_marketplace") continue;
    assert.equal(roleCan("AUDITOR", capability), false, `AUDITOR must not hold ${capability}`);
  }
  assert.equal(roleCan("AUDITOR", "transition"), false);
});

test("ANALYST and REVIEWER hold exactly the ordinary marketplace capabilities", () => {
  for (const role of ["ANALYST", "REVIEWER"]) {
    for (const capability of ordinaryMarketplaceWork) {
      assert.equal(roleCan(role, capability), true, `${role} should hold ${capability}`);
    }
    // Terminal / verification-bypassing transitions stay with ADMIN.
    assert.equal(roleCan(role, "exceptional_marketplace_transition"), false);
  }
});

test("setting Civilon's sale price mirrors the Price Check result authority split", () => {
  // ANALYST lacks approve_result/send_result, so it also lacks manage_buyer_offer.
  assert.equal(roleCan("ANALYST", "approve_result"), false);
  assert.equal(roleCan("ANALYST", "manage_buyer_offer"), false);
  assert.equal(roleCan("REVIEWER", "manage_buyer_offer"), true);
});

test("no role gained a Price Check capability it did not already hold", () => {
  const priceCheckExpectations = {
    ANALYST: { manage_staff: false, approve_result: false, exceptional_transition: false, assign_any: false },
    REVIEWER: { manage_staff: false, approve_result: true, exceptional_transition: false, assign_any: false },
    ADMIN: { manage_staff: true, approve_result: true, exceptional_transition: true, assign_any: true },
    AUDITOR: { manage_staff: false, approve_result: false, exceptional_transition: false, assign_any: false },
  };
  for (const role of adminRoles) {
    for (const [capability, expected] of Object.entries(priceCheckExpectations[role])) {
      assert.equal(roleCan(role, capability), expected, `${role}/${capability}`);
    }
  }
});
