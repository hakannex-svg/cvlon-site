import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("homepage keeps AOG routing compact while dedicated AOG retains full fields", () => {
  const home = read("app", "page.tsx");
  const form = read("components", "RfqForm.tsx");
  assert.match(home, /<RfqForm sourcePage="homepage" compactAog/);
  assert.match(form, /aog-compact-route/);
  assert.match(form, /href="\/aog-services#rfq"/);
  assert.match(form, /isAog && !compactAog/);
  assert.match(form, /name="callbackNumber"/);
  assert.match(form, /name="requiredBy"/);
});

test("AOG preparation copy is practical and customer-facing", () => {
  const page = read("app", "aog-services", "page.tsx");
  assert.match(page, /Prepare these details/);
  assert.match(page, /Delivery and approval details/);
  assert.doesNotMatch(page, /HAVE READY/);
});

test("round-one styles cover field hierarchy, cards and precise process rails", () => {
  const css = read("app", "globals.css");
  assert.match(css, /\.quick-rfq input::placeholder \{ color:#617487; font-weight:400/);
  assert.match(css, /\.service-card:focus-within/);
  assert.match(css, /\.link-cards>a:focus-visible/);
  assert.match(css, /\.process-rail li:not\(:last-child\):after[^}]*left:calc\(50% \+ 18px\)/);
  assert.match(css, /grid-template-columns:repeat\(var\(--process-count\),minmax\(0,1fr\)\)/);
});
