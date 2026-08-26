import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isPrivateAnalyticsRoute } from "../lib/analytics-private-routes.ts";

test("analytics bridge exposes approved non-sensitive events and context only", async () => {
  const source = await readFile(new URL("../lib/analytics.ts", import.meta.url), "utf8");
  for (const event of ["aog_call_click", "whatsapp_click", "rfq_submit", "contact_submit", "price_check_view", "price_check_start", "price_check_submit", "price_check_upload_started", "price_check_upload_completed"]) {
    assert.match(source, new RegExp(`"${event}"`));
  }
  for (const context of ["source_page", "cta_location"]) {
    assert.match(source, new RegExp(context));
  }
  assert.match(source, /civilonPendingAnalyticsEvents/);
  assert.match(source, /if \(!window\.dataLayer\)/);
  assert.match(source, /window\.dataLayer\.push\(detail\)/);
  assert.doesNotMatch(source, /civilonAnalyticsConsentGranted === false/);
  assert.doesNotMatch(source, /price_check_result_view|price_check_quote_request/);
  assert.doesNotMatch(source, /part_number|email|telephone|tail_number|message_content|aircraft_brand|part_category/);
});

test("GTM is the sole denied-by-default consent-mode loader and private routes fail closed", async () => {
  const source = await readFile(new URL("../components/AnalyticsBootstrap.tsx", import.meta.url), "utf8");
  assert.match(source, /NEXT_PUBLIC_GTM_CONTAINER_ID/);
  assert.match(source, /consent-required/);
  assert.match(source, /gtm\.start/);
  assert.match(source, /gtag\("consent", "default"/);
  assert.match(source, /wait_for_update: 500/);
  assert.ok(source.indexOf('gtag("consent", "default"') < source.indexOf('event: "gtm.js"'));
  // The route list moved into the shared helper both this loader and the
  // consent UI read, so the exclusion is asserted through that helper.
  assert.match(source, /isPrivateAnalyticsRoute\(window\.location\.pathname\)/);
  assert.equal(isPrivateAnalyticsRoute("/price-check/result"), true);
  assert.equal(isPrivateAnalyticsRoute("/admin/queue"), true);
  assert.doesNotMatch(source, /NEXT_PUBLIC_GA4_MEASUREMENT_ID|gtag\/js/);
});

test("completed lead events fire only after confirmed form success", async () => {
  const source = await readFile(new URL("../components/RfqForm.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(response\.ok\) trackCivilonEvent/);
});
