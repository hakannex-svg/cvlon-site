import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("analytics bridge exposes approved non-sensitive events and context only", async () => {
  const source = await readFile(new URL("../lib/analytics.ts", import.meta.url), "utf8");
  for (const event of ["aog_call_click", "aog_whatsapp_click", "rfq_submit", "aog_rfq_submit"]) {
    assert.match(source, new RegExp(`"${event}"`));
  }
  for (const context of ["source_page", "aircraft_brand", "part_category"]) {
    assert.match(source, new RegExp(context));
  }
  assert.doesNotMatch(source, /part_number|email|telephone|tail_number|message_content/);
});
