import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const component = fs.readFileSync(new URL("../components/price-check/CustomerResultView.tsx", import.meta.url), "utf8");
const sourcing = fs.readFileSync(new URL("../components/price-check/ResultSourcingAction.tsx", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/price-check/result/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

const requiredRegions = [
  "outer-container",
  "result-header",
  "public-reference",
  "price-position",
  "summary-metrics",
  "submitted-price",
  "confidence",
  "observation-count",
  "observed-range",
  "explanation",
  "disclaimer",
  "sourcing-cta",
  "sourcing-confirmation",
];

function assertViewportContainment(measurement, tolerance = 1) {
  for (const region of measurement.regions) {
    assert.ok(region.left >= -tolerance, `${region.name} starts outside the viewport`);
    assert.ok(region.right <= measurement.viewportWidth + tolerance, `${region.name} ends outside the viewport`);
    assert.ok(region.width <= measurement.viewportWidth + tolerance, `${region.name} is wider than the viewport`);
  }
}

function assertUsableResultWidth(measurement, tolerance = 2) {
  const outer = measurement.regions.find((region) => region.name === "outer-container");
  assert.ok(outer, "outer result container is measured");
  const expected = Math.min(920, measurement.viewportWidth - (measurement.viewportWidth <= 600 ? 36 : 48));
  assert.ok(outer.width >= expected - tolerance, `outer result container collapsed to ${outer.width}px; expected about ${expected}px`);
}

test("private customer result exposes bounding-box hooks for every important region", () => {
  const source = `${component}\n${sourcing}`;
  for (const region of requiredRegions) assert.match(source, new RegExp(`data-result-region=["']${region}["']`));
  assert.match(page, /data-result-page="private"/);
  assert.match(page, /data-result-region="unavailable-state"/);
});

test("standalone result CSS removes intrinsic-width escape paths", () => {
  assert.match(css, /\.customer-result-card\{width:100%;max-width:920px;min-width:0/);
  assert.match(css, /\.result-facts\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.result-range dl\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.result-sourcing\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css, /\.private-result-page\{width:100%;max-width:100%;min-width:0/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.doesNotMatch(css, /\.private-result-page[^}]*overflow-x:(?:hidden|clip)/);
});

test("bounding boxes catch clipping that document scrollWidth can miss", () => {
  const maskedOverflow = {
    viewportWidth: 390,
    scrollWidth: 390,
    regions: [{ name: "sourcing-cta", left: 18, right: 430, width: 412 }],
  };
  assert.equal(maskedOverflow.scrollWidth <= maskedOverflow.viewportWidth, true);
  assert.throws(() => assertViewportContainment(maskedOverflow), /sourcing-cta ends outside/);
  assert.doesNotThrow(() => assertViewportContainment({
    viewportWidth: 390,
    scrollWidth: 390,
    regions: requiredRegions.map((name) => ({ name, left: 18, right: 372, width: 354 })),
  }));
});

test("usable-width assertion catches the former narrow-column collapse even without overflow", () => {
  const collapsedWithoutOverflow = {
    viewportWidth: 390,
    regions: [{ name: "outer-container", left: 18, right: 65, width: 47 }],
  };
  assert.doesNotThrow(() => assertViewportContainment(collapsedWithoutOverflow));
  assert.throws(() => assertUsableResultWidth(collapsedWithoutOverflow), /collapsed to 47px/);
  assert.doesNotThrow(() => assertUsableResultWidth({
    viewportWidth: 390,
    regions: [{ name: "outer-container", left: 18, right: 372, width: 354 }],
  }));
});
