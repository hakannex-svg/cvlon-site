import assert from "node:assert/strict";
import test from "node:test";
import { validateRfq } from "../lib/rfq-logic.ts";

const baseValues = {
  partNumber: "101-384025-5",
  email: "buyer@example.com",
  callbackNumber: "",
  aircraftLocation: "",
};

test("normal RFQ does not require AOG-only fields", () => {
  assert.deepEqual(validateRfq(baseValues, false), {});
});

test("AOG RFQ requires callback number and aircraft location", () => {
  assert.deepEqual(validateRfq(baseValues, true), {
    callbackNumber: "Enter a callback or WhatsApp number for this AOG request.",
    aircraftLocation: "Enter the aircraft location for this AOG request.",
  });
});

test("unchecking AOG removes conditional requirements without clearing values", () => {
  const enteredValues = { ...baseValues, callbackNumber: "12015550123", aircraftLocation: "KTEB" };
  assert.deepEqual(validateRfq(enteredValues, true), {});
  assert.deepEqual(validateRfq(enteredValues, false), {});
  assert.equal(enteredValues.callbackNumber, "12015550123");
  assert.equal(enteredValues.aircraftLocation, "KTEB");
});
