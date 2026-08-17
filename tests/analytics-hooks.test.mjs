import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("analytics bridge exposes approved non-sensitive events and context only", async () => {
  const source = await readFile(new URL("../lib/analytics.ts", import.meta.url), "utf8");
  for (const event of ["aog_call_click", "whatsapp_click", "rfq_submit", "contact_submit", "price_check_view", "price_check_start", "price_check_submit", "price_check_upload_started", "price_check_upload_completed", "price_check_result_view", "price_check_quote_request"]) {
    assert.match(source, new RegExp(`"${event}"`));
  }
  for (const context of ["source_page", "aircraft_brand", "part_category"]) {
    assert.match(source, new RegExp(context));
  }
  assert.doesNotMatch(source, /part_number|email|telephone|tail_number|message_content/);
});
