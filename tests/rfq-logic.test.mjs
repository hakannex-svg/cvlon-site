import assert from "node:assert/strict";
import test from "node:test";
import { composeRequiredBy, FIVE_MINUTE_OPTIONS, to24HourTime, validateNeededBy, validateRfq } from "../lib/rfq-logic.ts";

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

test("ASAP serializes into the existing requiredBy value", () => {
  assert.equal(composeRequiredBy("asap", "2026-08-20", "03", "00", "PM"), "ASAP");
});

test("12-hour selections convert to the required local 24-hour values", () => {
  assert.equal(to24HourTime("12", "00", "AM"), "00:00");
  assert.equal(to24HourTime("12", "30", "AM"), "00:30");
  assert.equal(to24HourTime("01", "00", "AM"), "01:00");
  assert.equal(to24HourTime("03", "05", "PM"), "15:05");
  assert.equal(to24HourTime("11", "55", "PM"), "23:55");
  assert.equal(to24HourTime("12", "00", "PM"), "12:00");
});

test("specific date and selected time serialize without timezone conversion", () => {
  assert.equal(composeRequiredBy("specific", "2026-08-20", "03", "00", "PM"), "2026-08-20T15:00");
  assert.equal(composeRequiredBy("specific", "2026-08-20", "", "00", "PM"), "");
  assert.doesNotMatch(composeRequiredBy("specific", "2026-08-20", "03", "00", "PM"), /Z$/);
});

test("specific mode rejects incomplete selections and minutes use five-minute increments", () => {
  assert.equal(validateNeededBy("specific", "2026-08-20", "03", "", "PM"), "Select a date, hour, minute, and AM or PM.");
  assert.equal(validateNeededBy("specific", "2026-08-20", "03", "00", "PM"), undefined);
  assert.equal(validateNeededBy("asap", "", "", "", ""), undefined);
  assert.deepEqual(FIVE_MINUTE_OPTIONS, ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
});
