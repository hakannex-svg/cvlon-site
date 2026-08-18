import "../../db/price-check/server-boundary.ts";

import { createHmac, randomBytes } from "node:crypto";

import { SELL_INVENTORY_FRESHNESS_TTL_MS } from "../../db/price-check/domain/sell-inventory-freshness.ts";
import {
  SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY,
  SELL_INVENTORY_FRESHNESS_PAGE_PATH,
} from "./sell-inventory-freshness-contract.ts";

/**
 * The credential that opens one exact bulk-inventory freshness check.
 *
 * Same construction as the verification and evidence credentials, and for the
 * same reasons: the token is an HMAC over a stored random nonce, and what is
 * persisted is a second, differently-labelled HMAC *of the token*. A reader
 * holding a database dump therefore holds neither the credential nor anything
 * replayable without the server key, and the plaintext exists only inside the
 * outgoing e-mail.
 *
 * Three independent separations from every other marketplace credential:
 *
 *  1. Its own derivation label, so the same nonce yields a different token here
 *     than on the verification or evidence paths. An evidence credential
 *     presented at the freshness endpoint is simply not a value this label can
 *     produce.
 *  2. Its own lookup label, so the stored hash lives in a namespace that no
 *     other credential's hash can collide with.
 *  3. Its own table. An evidence request's hash is not selectable from
 *     `sell_inventory_freshness_checks` at all, and vice versa.
 *
 * The key is `MARKETPLACE_VERIFY_TOKEN_KEY`, shared deliberately: one key to
 * rotate, with domain separation carried by the labels rather than by a third
 * secret nobody would remember to rotate.
 */

/** Fourteen days, as the freshness e-mail states to the seller. */
export const SELL_INVENTORY_FRESHNESS_TOKEN_TTL_MS = SELL_INVENTORY_FRESHNESS_TTL_MS;

/** Base64url of a 32-byte HMAC. Nothing else is a freshness credential. */
export const SELL_INVENTORY_FRESHNESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const DERIVE_LABEL = "civilon-marketplace-sell-inventory-freshness-token:v1";
const LOOKUP_LABEL = "civilon-marketplace-sell-inventory-freshness-lookup:v1";

function keyBytes(key: string) {
  if (key.length < 32) throw new Error("MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE");
  return Buffer.from(key, "utf8");
}

export function newSellInventoryFreshnessNonce() {
  return randomBytes(32).toString("hex");
}

export function deriveSellInventoryFreshnessToken(key: string, nonce: string) {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error("SELL_INVENTORY_FRESHNESS_NONCE_INVALID");
  return createHmac("sha256", keyBytes(key))
    .update(`${DERIVE_LABEL}:${nonce}`)
    .digest("base64url");
}

export function hashSellInventoryFreshnessToken(key: string, token: string) {
  return createHmac("sha256", keyBytes(key))
    .update(`${LOOKUP_LABEL}:${token}`)
    .digest("hex");
}

export function isSellInventoryFreshnessToken(value: unknown): value is string {
  return typeof value === "string" && SELL_INVENTORY_FRESHNESS_TOKEN_PATTERN.test(value);
}

/**
 * The emailed link. The credential is a fragment, never a query parameter, so
 * it never leaves the browser: no access log, no CDN log, no Referer header and
 * no analytics page-path can contain it.
 */
export function sellInventoryFreshnessUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}${SELL_INVENTORY_FRESHNESS_PAGE_PATH}#${SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY}=${encodeURIComponent(token)}`;
}
