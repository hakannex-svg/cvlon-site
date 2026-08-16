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
  assert.doesNotMatch(form + netlify, /name="required-by"/);
  assert.doesNotMatch(form, /type="datetime-local"/);
  assert.match(form, /type="date" name="requiredByDate"/);
  assert.doesNotMatch(form, /type="time"/);
  for (const name of ["requiredByHour", "requiredByMinute", "requiredByPeriod"]) assert.match(form, new RegExp(`name="${name}"`));
  assert.match(form, /Use local time at the aircraft location\./);
});

test("UI-only needed-by controls are removed before submission", () => {
  const form = read("components", "RfqForm.tsx");
  const netlify = read("public", "netlify-form.html");
  for (const field of ["requiredByChoice", "requiredByDate", "requiredByHour", "requiredByMinute", "requiredByPeriod"]) {
    assert.match(form, new RegExp(`formData\\.delete\\("${field}"\\)`));
    assert.doesNotMatch(netlify, new RegExp(`name="${field}"`));
  }
});

test("homepage keeps the compact AOG route without full time controls", () => {
  const home = read("app", "page.tsx");
  assert.match(home, /<RfqForm sourcePage="homepage" compactAog/);
  assert.doesNotMatch(home, /requiredByHour|requiredByMinute|requiredByPeriod/);
});
