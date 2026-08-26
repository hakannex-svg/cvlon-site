import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("consent is explicit, persistent, and reopenable", () => {
  const source = read("components/ConsentPreferences.tsx");
  assert.match(source, /civilon_analytics_consent_v1/);
  assert.match(source, /"granted" \| "denied"/);
  assert.match(source, /Allow analytics/);
  assert.match(source, />Reject</);
  assert.match(source, /civilon:privacy-choices/);
  assert.doesNotMatch(source, /email|phone|company|part number|filename|supplier|result token/i);
});

test("Google advanced consent defaults denied, keeps advertising denied, and honors revocation", () => {
  const source = read("components/AnalyticsBootstrap.tsx");
  for (const denied of ["ad_storage", "ad_user_data", "ad_personalization"]) assert.match(source, new RegExp(`${denied}: "denied"`));
  assert.match(source, /gtag\("consent", "default"/);
  assert.match(source, /analytics_storage: "denied"/);
  assert.match(source, /gtag\("consent", "update"/);
  assert.match(source, /analytics_storage: granted \? "granted" : "denied"/);
  assert.doesNotMatch(source, /ga-disable-/);
});

test("consent notice accurately distinguishes cookieless measurement from optional storage", () => {
  const source = read("components/ConsentPreferences.tsx");
  assert.match(source, /limited cookieless measurement by default/i);
  assert.match(source, /analytics storage remains off unless you choose to allow it/i);
});
