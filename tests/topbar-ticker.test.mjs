import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("topbar ticker owns four messages and renders one span per message", () => {
  const ticker = read("components", "TopbarTicker.tsx");
  assert.match(ticker, /export const TOPBAR_TICKER_MESSAGES = \[/);
  assert.equal((ticker.match(/^\s+".+",$/gm) ?? []).length, 4);
  assert.match(ticker, /TOPBAR_TICKER_MESSAGES\.map\(\(message\) => <span key=\{message\}>\{message\}<\/span>\)/);
  assert.match(ticker, /aria-hidden="true"/);
});

test("ticker timing includes a fully hidden handoff between adjacent slots", () => {
  const css = read("app", "globals.css");
  assert.match(css, /@keyframes topbar-message \{ 0%,1\.5%\{opacity:0;transform:translateY\(6px\)\} 3%,21%\{opacity:1;transform:translateY\(0\)\} 22\.5%,100%\{opacity:0;transform:translateY\(-6px\)\} \}/);
  assert.match(css, /span:nth-child\(2\) \{ animation-delay:4\.84s; \}/);
  assert.match(css, /span:nth-child\(3\) \{ animation-delay:10\.34s; \}/);
  assert.match(css, /span:nth-child\(4\) \{ animation-delay:15\.84s; \}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{html\{scroll-behavior:auto\}\.topbar-message span\{animation:none;opacity:0\}\.topbar-message span:first-child\{opacity:1\}\}/);
});

test("Geist is self-hosted with intentional swap behavior and preloaded", () => {
  const layout = read("app", "layout.tsx");
  const css = read("app", "globals.css");
  const fonts = ["geist-latin-variable.woff2", "geist-mono-latin-variable.woff2"];

  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.equal((layout.match(/rel="preload"/g) ?? []).length, 2);
  assert.equal((css.match(/font-display:swap/g) ?? []).length, 2);
  assert.match(css, /--font-geist-sans:"Civilon Geist"/);
  assert.match(css, /--font-geist-mono:"Civilon Geist Mono"/);

  for (const font of fonts) {
    const path = join(process.cwd(), "public", "fonts", font);
    assert.equal(existsSync(path), true);
    assert.ok(statSync(path).size > 20_000);
  }
  assert.match(read("public", "fonts", "LICENSE.txt"), /SIL OPEN FONT LICENSE Version 1\.1/);
});
