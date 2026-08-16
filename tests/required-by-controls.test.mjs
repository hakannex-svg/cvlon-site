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
  assert.match(form, /neededByDate \? "date-has-value" : "date-is-empty"/);
  assert.doesNotMatch(form, /type="time"/);
  for (const name of ["requiredByHour", "requiredByMinute", "requiredByPeriod"]) assert.match(form, new RegExp(`name="${name}"`));
  for (const prompt of ["Hour", "Min", "AM/PM"]) assert.match(form, new RegExp(`<option value="">${prompt.replace("/", "\\/")}</option>`));
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

test("the empty native Date state clears WCAG AA without changing shared placeholders", () => {
  const css = read("app", "globals.css");
  assert.match(css, /input\[type="date"\]\.date-is-empty \{ color:#65798b; font-weight:400; \}/);
  assert.match(css, /input::placeholder,.quick-rfq textarea::placeholder\{color:#66798b;font-weight:400/);
});
