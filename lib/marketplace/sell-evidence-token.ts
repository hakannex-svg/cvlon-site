import "../../db/price-check/server-boundary.ts";

import { createHmac, randomBytes } from "node:crypto";

import { SELL_EVIDENCE_FRAGMENT_KEY, SELL_EVIDENCE_PAGE_PATH } from "./sell-evidence-contract.ts";

/**
 * The credential that opens one exact seller-evidence request.
 *
 * Same construction as the Buy/Sell verification credential, and for the same
 * reasons: the token is an HMAC over a stored random nonce, and what is
 * persisted is a second, differently-labelled HMAC *of the token*. A reader
 * holding a database dump therefore holds neither the credential nor anything
 * replayable without the server key, and the plaintext exists only inside the
 * outgoing e-mail.
 *
 * Three independent separations from every other marketplace credential:
 *
 *  1. Its own derivation label, so the same nonce yields a different token here
 *     than on the verification path. A verification credential presented at the
 *     evidence endpoint is simply not a value this label can produce.
 *  2. Its own lookup label, so the stored hash lives in a namespace that no
 *     other credential's hash can collide with.
 *  3. Its own table. A verification token's hash is not selectable from
 *     `marketplace_evidence_requests` at all, and vice versa.
 *
 * The key is `MARKETPLACE_VERIFY_TOKEN_KEY`, shared deliberately: one key to
 * rotate, with domain separation carried by the labels rather than by a second
 * secret nobody would remember to rotate.
 */

/** Fourteen days, as the request states to the seller. */
export const SELL_EVIDENCE_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Base64url of a 32-byte HMAC. Nothing else is an evidence credential. */
export const SELL_EVIDENCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const DERIVE_LABEL = "civilon-marketplace-sell-evidence-token:v1";
const LOOKUP_LABEL = "civilon-marketplace-sell-evidence-lookup:v1";

function keyBytes(key: string) {
  if (key.length < 32) throw new Error("MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE");
  return Buffer.from(key, "utf8");
}

export function newSellEvidenceNonce() {
  return randomBytes(32).toString("hex");
}

export function deriveSellEvidenceToken(key: string, nonce: string) {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error("SELL_EVIDENCE_NONCE_INVALID");
  return createHmac("sha256", keyBytes(key))
    .update(`${DERIVE_LABEL}:${nonce}`)
    .digest("base64url");
}

export function hashSellEvidenceToken(key: string, token: string) {
  return createHmac("sha256", keyBytes(key))
    .update(`${LOOKUP_LABEL}:${token}`)
    .digest("hex");
}

export function isSellEvidenceToken(value: unknown): value is string {
  return typeof value === "string" && SELL_EVIDENCE_TOKEN_PATTERN.test(value);
}

/**
 * The emailed link. The credential is a fragment, never a query parameter, so
 * it never leaves the browser: no access log, no CDN log, no Referer header and
 * no analytics page-path can contain it.
 */
export function sellEvidenceUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}${SELL_EVIDENCE_PAGE_PATH}#${SELL_EVIDENCE_FRAGMENT_KEY}=${encodeURIComponent(token)}`;
}
