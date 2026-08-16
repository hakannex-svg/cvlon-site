import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("AOG needed-by UI preserves the existing Netlify requiredBy field", () => {
  const form = read("components", "RfqForm.tsx");
  const netlify = read("public", "netlify-form.html");
  assert.match(form, /type="hidden" name="requiredBy" value=\{requiredBy\}/);
  assert.match(netlify, /name="requiredBy"/);
  assert.doesNotMatch(form, /type="datetime-local"/);
  assert.match(form, /type="date" name="requiredByDate"/);
  assert.match(form, /type="time" name="requiredByTime"/);
  assert.match(form, /Use local time at the aircraft location\./);
});

test("UI-only needed-by controls are removed before submission", () => {
  const form = read("components", "RfqForm.tsx");
  for (const field of ["requiredByChoice", "requiredByDate", "requiredByTime"]) {
    assert.match(form, new RegExp(`formData\\.delete\\("${field}"\\)`));
  }
});
