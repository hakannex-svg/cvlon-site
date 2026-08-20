import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

test("Civilon favicon metadata points to the supplied icon set and valid manifest", () => {
  const layout = read("app", "layout.tsx");
  const manifest = JSON.parse(read("public", "site.webmanifest"));

  assert.match(layout, /manifest: "\/site\.webmanifest"/);
  for (const asset of [
    "favicon.ico",
    "civilon-favicon-final.svg",
    "civilon-favicon-final-180.png",
    "civilon-favicon-final-512.png",
  ]) {
    const path = join(root, "public", asset);
    assert.equal(existsSync(path), true, `${asset} must exist`);
    assert.ok(statSync(path).size > 0, `${asset} must not be empty`);
  }
  assert.equal(existsSync(join(root, "public", "favicon.svg")), false);
  assert.doesNotMatch(
    read("netlify.toml"),
    /from\s*=\s*["']\/favicon\.ico["']/,
    "Netlify must serve the ICO directly instead of rewriting to the removed placeholder",
  );
  assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ["180x180", "512x512"]);
});

test("public form feedback helper focuses, offsets, scrolls, and respects reduced motion", () => {
  const helper = read("lib", "use-public-form-feedback.ts");
  assert.match(helper, /prefers-reduced-motion: reduce/);
  assert.match(helper, /focus\(\{ preventScroll: true \}\)/);
  assert.match(helper, /position === "fixed" \|\| position === "sticky"/);
  assert.match(helper, /behavior: reduceMotion \? "auto" : "smooth"/);
  assert.match(read("app", "globals.css"), /prefers-reduced-motion:reduce\)\{html\{scroll-behavior:auto\}/);
});

test("Buy, Sell, and Price Check focus success headings and failure summaries", () => {
  for (const file of [
    ["components", "marketplace", "BuyRequestForm.tsx"],
    ["components", "marketplace", "SellSubmissionForm.tsx"],
    ["components", "PriceCheckForm.tsx"],
  ]) {
    const source = read(...file);
    assert.match(source, /usePublicFormFeedback<HTMLHeadingElement>\(reference\)/, file.join("/"));
    assert.match(source, /usePublicFormFeedback<HTMLDivElement>\(errorFeedbackRevision\)/, file.join("/"));
    assert.match(source, /ref=\{confirmationHeadingRef\} tabIndex=\{-1\}/, file.join("/"));
    assert.match(source, /ref=\{errorFeedbackRef\} role="alert"[^>]+tabIndex=\{-1\}/, file.join("/"));
    assert.match(source, /role="status"/, file.join("/"));
  }
});

test("legacy public RFQ confirmations and delivery errors use the same feedback behavior", () => {
  const rfq = read("components", "RfqForm.tsx");
  assert.match(rfq, /usePublicFormFeedback<HTMLDivElement>/);
  assert.equal((rfq.match(/ref=\{submissionFeedbackRef\}/g) ?? []).length, 3);
  assert.equal((rfq.match(/tabIndex=\{-1\}/g) ?? []).length, 3);
});
