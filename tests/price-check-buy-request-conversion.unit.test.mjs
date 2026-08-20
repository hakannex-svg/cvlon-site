import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  conversionHasRequiredPhone,
  validatePriceCheckBuyRequestSubmission,
} from "../lib/marketplace/price-check-conversion-validation.ts";

function payload(overrides = {}) {
  return {
    quantity: "1",
    acceptableCondition: "NOT_SURE",
    urgency: "standard",
    neededByDate: null,
    deliveryCountry: "US",
    deliveryPostalCode: null,
    deliveryCity: null,
    fulfillmentPreference: "not_sure",
    applicationNotes: null,
    phone: null,
    serviceAcknowledged: true,
    legalAcknowledged: true,
    website: "",
    ...overrides,
  };
}

test("Price Check Buy Request confirmation accepts only the short operational fields", () => {
  const result = validatePriceCheckBuyRequestSubmission(payload({
    quantity: "2.5",
    urgency: "critical",
    phone: "+1 909 555 0123",
    deliveryCountry: "de",
  }));
  assert.equal(result.success, true);
  assert.equal(result.data.quantity, "2.5");
  assert.equal(result.data.deliveryCountry, "DE");
  assert.equal(result.data.phone, "+1 909 555 0123");
});

test("identity, part and provenance fields cannot be supplied by the browser", () => {
  for (const field of ["partNumber", "businessEmail", "companyName", "priceCheckId", "resultId", "sourceResultId", "status"]) {
    const result = validatePriceCheckBuyRequestSubmission(payload({ [field]: "attacker-controlled" }));
    assert.equal(result.success, false, field);
    assert.match(result.fieldErrors._form, /unsupported field/);
  }
});

test("conversion validation rejects malformed, oversized, enum and acknowledgment input", () => {
  const cases = [
    [{ quantity: "0" }, "quantity"],
    [{ quantity: "1.0000" }, "quantity"],
    [{ acceptableCondition: "CERTIFIED" }, "acceptableCondition"],
    [{ urgency: "emergency" }, "urgency"],
    [{ neededByDate: "2026-02-30" }, "neededByDate"],
    [{ deliveryCountry: "USA" }, "deliveryCountry"],
    [{ phone: "123" }, "phone"],
    [{ applicationNotes: "x".repeat(2001) }, "applicationNotes"],
    [{ serviceAcknowledged: false }, "serviceAcknowledged"],
    [{ legalAcknowledged: false }, "legalAcknowledged"],
    [{ website: "spam.example" }, "_form"],
  ];
  for (const [overrides, field] of cases) {
    const result = validatePriceCheckBuyRequestSubmission(payload(overrides));
    assert.equal(result.success, false, JSON.stringify(overrides));
    assert.ok(result.fieldErrors[field], `${field}: ${JSON.stringify(result.fieldErrors)}`);
  }
});

test("urgent conversion can use the requester phone already protected on the server", () => {
  const urgent = validatePriceCheckBuyRequestSubmission(payload({ urgency: "aog" }));
  assert.equal(urgent.success, true);
  assert.equal(conversionHasRequiredPhone(urgent.data, true), true);
  assert.equal(conversionHasRequiredPhone(urgent.data, false), false);
  const supplied = validatePriceCheckBuyRequestSubmission(payload({ urgency: "critical", phone: "+1 909 555 0123" }));
  assert.equal(supplied.success, true);
  assert.equal(conversionHasRequiredPhone(supplied.data, false), true);
});

test("the secure route and UI never accept browser-selected identity or provenance", () => {
  const route = fs.readFileSync(new URL("../app/api/price-check/result/buy-request/route.ts", import.meta.url), "utf8");
  const component = fs.readFileSync(new URL("../components/price-check/ResultSourcingAction.tsx", import.meta.url), "utf8");
  assert.match(route, /verifyResultSession/);
  assert.match(route, /origin !== new URL\(request.url\)\.origin/);
  assert.match(route, /PRICE_CHECK_BUY_REQUEST_MAX_BODY_BYTES/);
  assert.match(route, /LEGAL_DOCUMENT_VERSIONS/);
  assert.doesNotMatch(component, /businessEmail|companyName|sourceResultId|priceCheckId/);
  assert.match(component, /PUBLIC_CTA\.buy/);
  assert.doesNotMatch(component, /Create a Buy Request/);
  assert.match(component, /Submitting does not place an order/);
  assert.match(component, /subject to confirmation/);
  assert.equal(
    fs.existsSync(new URL("../app/api/price-check/result/sourcing/route.ts", import.meta.url)),
    false,
    "the former one-click endpoint must not leave a public path that creates an incomplete legacy-only record",
  );
});

test("both admin directions expose the linked records without exposing them publicly", () => {
  const priceCheckAdmin = fs.readFileSync(new URL("../app/admin/price-checks/[id]/page.tsx", import.meta.url), "utf8");
  const buyDetail = fs.readFileSync(new URL("../components/admin/BuyRequestDetail.tsx", import.meta.url), "utf8");
  const adminRepository = fs.readFileSync(new URL("../db/price-check/repositories/marketplace-admin-repository.ts", import.meta.url), "utf8");
  assert.match(priceCheckAdmin, /\/admin\/buy-requests\/\$\{resultData\.linkedBuyRequest\.id\}/);
  assert.match(buyDetail, /Originating Price Check result/);
  assert.match(buyDetail, /request\.sourceResultId/);
  assert.match(adminRepository, /sourceResultId: buyRequests\.sourceResultId/);
});
