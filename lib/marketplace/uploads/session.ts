import "../../../db/price-check/server-boundary.ts";

import { createHmac, randomBytes } from "node:crypto";

import {
  MARKETPLACE_UPLOAD_COOKIE,
  MARKETPLACE_UPLOAD_SESSION_SECONDS,
} from "./constants.ts";

/**
 * Marketplace upload session ownership.
 *
 * Two separations from the Price Check session, both deliberate:
 *
 *  1. The cookie name is different and host-only (`__Host-` forbids a Domain
 *     attribute, so a sibling host can never set or read it), and the row lives
 *     in `marketplace_upload_sessions`, a different table entirely.
 *  2. The stored ownership proof is a *keyed* HMAC, not a bare digest. A
 *     database reader holds neither the cookie value nor anything that can be
 *     recomputed without the server key, and — because the label and the key
 *     both differ from Price Check's — a Price Check cookie presented here
 *     hashes to a value that exists in no marketplace row. Cross-claiming is
 *     impossible even before the table separation is considered.
 *
 * Fails closed on a missing or short key: an unkeyed fallback would make every
 * session hash reproducible by anyone holding a database dump.
 */
export const MARKETPLACE_UPLOAD_SESSION_KEY_MIN_LENGTH = 32;

function keyBytes(key: string) {
  if (key.length < MARKETPLACE_UPLOAD_SESSION_KEY_MIN_LENGTH) {
    throw new Error("MARKETPLACE_UPLOAD_SESSION_KEY_UNAVAILABLE");
  }
  return Buffer.from(key, "utf8");
}

export function marketplaceUploadSessionKey(
  env: Record<string, string | undefined> = process.env,
) {
  return keyBytes(env.MARKETPLACE_UPLOAD_SESSION_KEY ?? "").toString("utf8");
}

export function newMarketplaceUploadSessionToken() {
  return randomBytes(48).toString("base64url");
}

/** Base64url of 48 bytes: the only shape a session cookie may take. */
export const MARKETPLACE_UPLOAD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{64}$/;

export function isMarketplaceUploadSessionToken(value: unknown): value is string {
  return typeof value === "string" && MARKETPLACE_UPLOAD_TOKEN_PATTERN.test(value);
}

export function hashMarketplaceUploadSessionToken(key: string, token: string) {
  return createHmac("sha256", keyBytes(key))
    .update(`civilon-marketplace-upload-session:v1:${token}`)
    .digest("hex");
}

export function readMarketplaceUploadCookie(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === MARKETPLACE_UPLOAD_COOKIE) {
      const decoded = decodeURIComponent(value.join("="));
      // A malformed cookie is discarded rather than passed to a query. It can
      // only be a stale value or a probe; neither deserves a database round trip.
      return isMarketplaceUploadSessionToken(decoded) ? decoded : null;
    }
  }
  return null;
}

/**
 * SameSite=Strict, one notch tighter than the Price Check upload cookie.
 *
 * Every request that needs this cookie is a same-origin fetch issued by an
 * already-loaded Civilon page, and those carry Strict cookies normally. Strict
 * costs nothing here and removes the cross-site top-level navigation case
 * entirely.
 */
export function marketplaceUploadSessionCookie(token: string) {
  return `${MARKETPLACE_UPLOAD_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${MARKETPLACE_UPLOAD_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}
