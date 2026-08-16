import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("visible mobile AOG bar creates shared main-content clearance", () => {
  const css = read("app", "globals.css");
  assert.match(css, /--mobile-aog-bar-height:68px/);
  assert.match(css, /body:has\(\.mobile-urgent:not\(\.is-suppressed\)\) main:after/);
  assert.match(css, /height:calc\(var\(--mobile-aog-bar-height\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(css, /body[^}]*padding-bottom:calc\(var\(--mobile-aog-bar-height/);
});

test("existing route and intersection suppression remains unchanged", () => {
  const chrome = read("components", "GlobalAogChrome.tsx");
  const bar = read("components", "MobileAogBar.tsx");
  assert.match(chrome, /path==="\/aog-services"\|\|path==="\/contact-us"/);
  for (const target of ["[data-mobile-aog-suppress]", ".aog-band", "footer", ".prominent-aog-actions"]) {
    assert.ok(bar.includes(target));
  }
  assert.match(bar, /menu\|\|obscured\|\|formFocus/);
});
