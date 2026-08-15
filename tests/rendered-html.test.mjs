import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Civilon production homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Aircraft Parts Sourcing &amp; 24\/7 AOG Support \| Civilon Air<\/title>/i);
  assert.match(html, /Start a part search/);
  assert.match(html, /Request availability/);
  assert.match(html, /Call AOG desk/);
  assert.match(html, /https:\/\/wa\.me\/19093444444\?text=AOG%20request/);
  assert.match(html, /Urgent AOG contact options/);
  assert.match(html, /id="part-number"[^>]*required=""[^>]*aria-required="true"/i);
  assert.match(html, /id="email"[^>]*required=""[^>]*aria-required="true"/i);
  assert.match(html, /class="required-mark" aria-hidden="true">\*<\/span>/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps responsive quality-image handling and replacement note", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /TODO\(production\): TEMPORARY IMAGE/);
  assert.match(page, /quality-inspection\.avif/);
  assert.match(page, /quality-inspection\.webp/);
  assert.match(page, /quality-inspection\.jpg/);
  assert.match(css, /aspect-ratio:\s*3\/2/);
  assert.match(css, /object-fit:\s*cover/);
  assert.match(css, /\.field-label\s*\{[^}]*display:inline-flex/);
  assert.match(css, /\.aog-check:has\(input:checked\)/);
  assert.match(css, /\.mobile-urgent/);
});
