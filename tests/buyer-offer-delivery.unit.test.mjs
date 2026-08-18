import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  BUYER_OFFER_TOKEN_PATTERN,
  buyerOfferTokenMatches,
  buyerOfferUrl,
  deriveBuyerOfferToken,
  parseBuyerOfferToken,
} from "../lib/marketplace/buyer-offer-token.ts";
import { buyerOfferCustomerEmail } from "../lib/marketplace/email/buyer-offer-templates.ts";
import { buildBuyerOfferSnapshot } from "../lib/marketplace/buyer-offer-snapshot.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const key = "buyer-offer-unit-signing-key-at-least-32-characters";
const binding = {
  buyerOfferId: "0123456789ABCDEFGHJKMNPQRS",
  version: 3,
  sentAt: new Date("2026-08-18T12:00:00Z"),
  expiresAt: new Date("2026-08-25T12:00:00Z"),
};

test("buyer-offer tokens are exact-binding HMAC credentials", () => {
  const token = deriveBuyerOfferToken(key, binding);
  assert.match(token, BUYER_OFFER_TOKEN_PATTERN);
  assert.deepEqual(parseBuyerOfferToken(token), {
    buyerOfferId: binding.buyerOfferId,
    signature: token.split(".")[1],
  });
  assert.equal(buyerOfferTokenMatches(key, binding, token), true);
  for (const changed of [
    { ...binding, version: 4 },
    { ...binding, sentAt: new Date("2026-08-18T12:00:01Z") },
    { ...binding, expiresAt: new Date("2026-08-26T12:00:00Z") },
    { ...binding, buyerOfferId: "1123456789ABCDEFGHJKMNPQRS" },
  ]) assert.equal(buyerOfferTokenMatches(key, changed, token), false);
  assert.equal(buyerOfferTokenMatches(key, binding, `${token.slice(0, -1)}A`), false);
  assert.equal(parseBuyerOfferToken("not-a-token"), null);
});

test("the customer URL keeps the credential in a fragment", () => {
  const token = deriveBuyerOfferToken(key, binding);
  const url = buyerOfferUrl("https://deploy-preview-21--cvlon.netlify.app", token);
  assert.match(url, /\/buy-sell-aircraft-parts\/offer#token=/);
  assert.equal(new URL(url).search, "");
  assert.equal(new URL(url).hash.includes(token), true);
});

test("customer email accepts only the frozen supplier-free snapshot", () => {
  const offer = buildBuyerOfferSnapshot({
    reference: "BR-0000000001", version: 3, saleUnitPrice: "2400.00", currencyCode: "USD",
    quantity: "2.00", statedCondition: "SV", documentsSummary: "8130-3 where available",
    deliveryOption: "door_delivery", shippingAndExportScope: "Door delivery", leadTimeDays: 7,
    expiresAt: binding.expiresAt,
  });
  const email = buyerOfferCustomerEmail({
    from: "Civilon Parts <parts@cvlon.com>", to: "buyer@example.com", offer,
    responseUrl: buyerOfferUrl("https://deploy-preview-21--cvlon.netlify.app", deriveBuyerOfferToken(key, binding)),
  });
  const rendered = JSON.stringify(email);
  for (const secret of [
    "supplierUnitCost", "supplierNameSnapshot", "supplierContactSnapshot",
    "selectedSupplierResponseId", "internal routing", "buyerOfferId",
  ]) assert.equal(rendered.includes(secret), false, secret);
  assert.match(email.textBody, /Documentation varies by part and source/);
  assert.match(email.textBody, /availability is subject to confirmation/i);
  assert.match(email.textBody, /appropriately approved repair facilities/);
  assert.match(email.textBody, /No account or payment/);
});

test("public page and APIs are private, POST-only and contain no checkout", () => {
  const component = read("components", "marketplace", "BuyerOfferResponse.tsx");
  const page = read("app", "buy-sell-aircraft-parts", "offer", "page.tsx");
  const routes = read("lib", "marketplace", "buyer-offer-public-routes.ts");
  const adminRoutes = read("lib", "marketplace", "admin", "buyer-offer-routes.ts");
  for (const file of [
    read("app", "api", "marketplace", "buyer-offers", "view", "route.ts"),
    read("app", "api", "marketplace", "buyer-offers", "respond", "route.ts"),
  ]) {
    assert.match(file, /export const POST/);
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.match(file, new RegExp(`export const ${method} = buyerOfferPublicMethodNotAllowed`));
    }
  }
  assert.match(page, /robots: \{ index: false, follow: false, nocache: true \}/);
  assert.match(page, /if \(!isMarketplaceEnabled\(\)\) notFound\(\)/);
  assert.match(component, /window\.history\.replaceState/);
  assert.match(component, /Accept Civilon offer/);
  assert.match(component, /no payment is taken on this page/i);
  assert.doesNotMatch(`${component}\n${page}`, /checkout|credit card|buyer.*seller.*email/i);
  assert.match(routes, /sec-fetch-site/);
  assert.match(routes, /isApprovedSubmissionHost/);
  assert.match(routes, /consumeMarketplaceAttempt/);
  assert.match(routes, /private, no-store/);
  assert.match(adminRoutes, /validation\.data\.expectedStatus !== "sent"/);
  assert.match(adminRoutes, /queueBuyerOfferDelivery/);
});

test("the private offer page is excluded from analytics and public discovery", () => {
  for (const file of ["AnalyticsBootstrap.tsx", "ConsentPreferences.tsx"]) {
    const source = read("components", file);
    assert.ok(source.includes('path === "/buy-sell-aircraft-parts/offer"'), file);
    assert.ok(source.includes('path.startsWith("/buy-sell-aircraft-parts/offer/")'), file);
  }

  for (const file of [
    read("components", "SiteHeader.tsx"),
    read("components", "SiteFooter.tsx"),
    read("app", "sitemap.ts"),
  ]) assert.equal(file.includes("/buy-sell-aircraft-parts/offer"), false);
});
