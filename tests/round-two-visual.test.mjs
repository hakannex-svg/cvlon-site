import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("Round 2 uses shared descriptive card actions", () => {
  const interior = read("components", "Interior.tsx");
  const home = read("app", "page.tsx");
  assert.match(interior, /function cardAction/);
  assert.match(interior, /className="card-action"/);
  assert.match(home, /className="service-card-action"/);
  assert.doesNotMatch(home, />Learn more/);
});

test("Round 2 process geometry and information note remain shared", () => {
  const interior = read("components", "Interior.tsx");
  const parts = read("app", "parts", "page.tsx");
  const css = read("app", "globals.css");
  assert.match(interior, /--process-count/);
  assert.match(interior, /export function InformationNote/);
  assert.match(parts, /<InformationNote label="WARRANTY">Warranty terms vary by part condition and source and are stated with each quotation\.<\/InformationNote>/);
  assert.match(css, /\.information-note/);
});

test("Round 2 utility bar prioritizes AOG and phone on mobile", () => {
  const header = read("components", "SiteHeader.tsx");
  const css = read("app", "globals.css");
  assert.match(header, /className="topbar-aog"/);
  assert.match(header, /className="topbar-office"/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*\.topbar-office\{display:none\}/);
});
