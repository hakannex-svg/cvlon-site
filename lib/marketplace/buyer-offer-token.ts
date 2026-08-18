import "../../db/price-check/server-boundary.ts";

import { createHmac, timingSafeEqual } from "node:crypto";

import { BUYER_OFFER_PAGE_PATH, BUYER_OFFER_FRAGMENT_KEY } from "./buyer-offer-contract.ts";

/**
 * The credential that lets a buyer open one exact Civilon offer.
 *
 * ── Why there is no new table ────────────────────────────────────────────────
 *
 * A stored credential would need a row, a migration, and a revocation story.
 * This one needs none of them, because everything it authorises is already in
 * `buyer_offers`: the offer id, its version, the instant it was sent, and the
 * instant it expires. The credential is an HMAC over exactly those four values,
 * so the row *is* the record of what the credential may open. Nothing derived
 * from a different row, a different version, a different send, or a different
 * expiry verifies.
 *
 * ── What that binding buys ───────────────────────────────────────────────────
 *
 *  - Change the version and every credential for the old one stops verifying.
 *  - Re-send and `sent_at` moves, so the previous credential stops verifying.
 *  - Move the expiry and the credential stops verifying, so an expiry cannot be
 *    silently extended for a buyer who is already holding a link.
 *  - The offer id is carried in the clear so the server can find the row; it is
 *    not the secret, and a caller who edits it is simply presenting a signature
 *    over a different binding, which fails.
 *
 * The key is `MARKETPLACE_VERIFY_TOKEN_KEY`, reused deliberately: one key to
 * rotate, not three. Domain separation comes from the HMAC label, which is
 * distinct from every other marketplace label, so a Buy Request verification
 * credential can never be presented here and this credential can never be
 * presented at a verification endpoint — independently of every other check
 * those paths make.
 */

/** `<26-char record id>.<43-char base64url HMAC>`. Nothing else is a credential. */
export const BUYER_OFFER_TOKEN_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}\.[A-Za-z0-9_-]{43}$/;

const HMAC_LABEL = "civilon-buyer-offer-view-token:v1";

export type BuyerOfferTokenBinding = {
  buyerOfferId: string;
  version: number;
  sentAt: Date;
  expiresAt: Date;
};

function keyBytes(key: string) {
  if (key.length < 32) throw new Error("MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE");
  return Buffer.from(key, "utf8");
}

/**
 * The exact bytes signed.
 *
 * Every component has a fixed shape — a 26-character id, a decimal integer, and
 * two ISO-8601 instants — so the colon-joined form is unambiguous: no component
 * can absorb a separator and impersonate a different binding.
 */
function bindingMaterial(binding: BuyerOfferTokenBinding) {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(binding.buyerOfferId)) {
    throw new Error("BUYER_OFFER_TOKEN_BINDING_INVALID");
  }
  if (!Number.isInteger(binding.version) || binding.version <= 0) {
    throw new Error("BUYER_OFFER_TOKEN_BINDING_INVALID");
  }
  if (Number.isNaN(binding.sentAt.valueOf()) || Number.isNaN(binding.expiresAt.valueOf())) {
    throw new Error("BUYER_OFFER_TOKEN_BINDING_INVALID");
  }
  return [
    HMAC_LABEL,
    binding.buyerOfferId,
    String(binding.version),
    binding.sentAt.toISOString(),
    binding.expiresAt.toISOString(),
  ].join(":");
}

export function signBuyerOfferBinding(key: string, binding: BuyerOfferTokenBinding) {
  return createHmac("sha256", keyBytes(key)).update(bindingMaterial(binding)).digest("base64url");
}

/** The whole credential, id and signature together. */
export function deriveBuyerOfferToken(key: string, binding: BuyerOfferTokenBinding) {
  return `${binding.buyerOfferId}.${signBuyerOfferBinding(key, binding)}`;
}

export function isBuyerOfferToken(value: unknown): value is string {
  return typeof value === "string" && BUYER_OFFER_TOKEN_PATTERN.test(value);
}

export function parseBuyerOfferToken(value: unknown): { buyerOfferId: string; signature: string } | null {
  if (!isBuyerOfferToken(value)) return null;
  const separator = value.indexOf(".");
  return { buyerOfferId: value.slice(0, separator), signature: value.slice(separator + 1) };
}

/**
 * Constant-time verification against the binding the database actually holds.
 *
 * The id carried in the credential must be the id of the row that was loaded,
 * so a signature valid for one offer cannot be replayed against another row's
 * terms even if a caller swaps the visible half.
 */
export function buyerOfferTokenMatches(
  key: string,
  binding: BuyerOfferTokenBinding,
  presented: string,
) {
  const parsed = parseBuyerOfferToken(presented);
  if (!parsed) return false;
  if (parsed.buyerOfferId !== binding.buyerOfferId) return false;
  const expected = signBuyerOfferBinding(key, binding);
  if (expected.length !== parsed.signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(parsed.signature, "utf8"));
}

/**
 * The credential travels in the URL fragment, never the query string.
 *
 * A fragment is not transmitted with the request, so it cannot land in an access
 * log, a CDN log, a Referer header sent to a third party, or an analytics
 * page-path. The offer page reads it client-side, erases it from history, and
 * sends it only to Civilon's private view or response endpoint.
 */
export function buyerOfferUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}${BUYER_OFFER_PAGE_PATH}#${BUYER_OFFER_FRAGMENT_KEY}=${encodeURIComponent(token)}`;
}
