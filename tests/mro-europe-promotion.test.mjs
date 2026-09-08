import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getMroEuropePromotionPhase, MRO_EUROPE_2026 } from "../lib/mro-europe-2026.ts";

test("MRO Europe promotion changes to follow-up after the show and expires one week later", () => {
  assert.equal(getMroEuropePromotionPhase(Date.parse("2026-10-29T22:59:59Z")), "show");
  assert.equal(getMroEuropePromotionPhase(Date.parse("2026-10-29T23:00:00Z")), "follow-up");
  assert.equal(getMroEuropePromotionPhase(Date.parse("2026-11-05T22:59:59Z")), "follow-up");
  assert.equal(getMroEuropePromotionPhase(Date.parse("2026-11-05T23:00:00Z")), "inactive");
  assert.equal(Date.parse(MRO_EUROPE_2026.promotionEndsAt) - Date.parse(MRO_EUROPE_2026.showEndsAt), 7 * 24 * 60 * 60 * 1000);
});

test("promotion uses supplied art, accessible HTML facts and approved page-level analytics only", async () => {
  const [component, config, home, header, analytics] = await Promise.all([
    readFile(new URL("../components/MroEuropePromotion.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/mro-europe-2026.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/SiteHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/analytics.ts", import.meta.url), "utf8"),
  ]);

  assert.match(config, /mro-europe-2026\.png/);
  assert.match(config, /October 28–29, 2026/);
  assert.match(config, /RAI Amsterdam/);
  assert.match(config, /1-1250/);
  assert.match(component, /isPrivateAnalyticsRoute/);
  assert.match(component, /trackCivilonEvent\("event_banner_click"/);
  assert.match(component, /trackCivilonEvent\("mro_meeting_click"/);
  assert.match(home, /<MroEuropeFeature \/>/);
  assert.match(header, /<MroEuropeAnnouncement \/>/);
  assert.match(analytics, /"event_banner_click"/);
  assert.match(analytics, /"mro_meeting_click"/);
  assert.doesNotMatch(component, /part_number|tail_number|document|price/);
});
