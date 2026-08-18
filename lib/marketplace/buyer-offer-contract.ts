import type { BuyerOfferSnapshot } from "./buyer-offer-snapshot.ts";

/** Private, link-only buyer-offer surface. Never add it to navigation or sitemap. */
export const BUYER_OFFER_PAGE_PATH = "/buy-sell-aircraft-parts/offer";
export const BUYER_OFFER_VIEW_API_PATH = "/api/marketplace/buyer-offers/view";
export const BUYER_OFFER_RESPOND_API_PATH = "/api/marketplace/buyer-offers/respond";
export const BUYER_OFFER_FRAGMENT_KEY = "token";
export const BUYER_OFFER_PUBLIC_MAX_BODY_BYTES = 2 * 1024;

export type BuyerOfferDecision = "accepted" | "declined";
export type BuyerOfferCustomerStatus = "awaiting_response" | BuyerOfferDecision;

export type BuyerOfferViewResponse =
  | { ok: true; offer: BuyerOfferSnapshot; status: BuyerOfferCustomerStatus }
  | { ok: false; status: "unavailable" };

export type BuyerOfferRespondResponse =
  | { ok: true; status: BuyerOfferDecision }
  | { ok: false; status: "unavailable" };
