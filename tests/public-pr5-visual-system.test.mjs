import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [home, icons, css] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/PublicVisualIcons.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("homepage assigns three distinct service icon kinds", () => {
  assert.match(home, /icon: "sourcing" as const/);
  assert.match(home, /icon: "aog" as const/);
  assert.match(home, /icon: "repair" as const/);
  assert.doesNotMatch(home, />✦</);
  assert.match(home, /<ServiceIcon kind=\{service\.icon\}/);
});

test("service icons share currentColor line styling at 32px", () => {
  assert.match(icons, /stroke: "currentColor"/);
  assert.match(icons, /strokeWidth: 1\.8/);
  assert.match(css, /\.card-icon svg \{[^}]*width:32px; height:32px;/);
});

test("platform rows use a generic inline silhouette and animated hover", () => {
  assert.match(home, /<AircraftSilhouetteIcon \/>/);
  assert.match(icons, /className="platform-aircraft-icon"/);
  assert.match(css, /\.platform-list a:hover b \{ transform:translateX\(4px\); \}/);
  assert.doesNotMatch(icons, /Beechcraft|Cessna|Bombardier|Dassault|Embraer|Gulfstream/i);
});

test("captioned images share one bottom-gradient overlay and image grade", () => {
  assert.match(css, /\.service-photo:after,\.quality-visual:after/);
  assert.match(css, /linear-gradient\(0deg,rgba\(4,18,33,\.76\) 0%,rgba\(4,18,33,\.22\) 29%,transparent 58%\)/);
  assert.match(css, /--image-grade:saturate\(\.76\) contrast\(1\.08\) brightness\(\.94\)/);
});

test("public sections use the shared desktop and mobile spacing scale", () => {
  assert.match(css, /--section-space:96px; --section-space-tight:72px/);
  assert.match(css, /:root\{--section-space:64px;--section-space-tight:54px\}/);
  assert.match(css, /\.section-tight\{padding:var\(--section-space-tight\) 0\}/);
  assert.match(css, /main:not\(\.private-result-page\):not\(\.admin-app\)>section\+section/);
});
