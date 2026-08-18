import "../../../db/price-check/server-boundary.ts";

import { createHash } from "node:crypto";

import { MARKETPLACE_UPLOAD_MAX_FILES } from "./constants.ts";

/**
 * Marketplace upload authorizations keep their own counters, separate from both
 * the Price Check upload limiter and the marketplace intake limiter. A seller
 * attaching twelve files must not exhaust their own ability to submit the
 * offer, and neither workflow may consume the other's budget.
 *
 * The ceiling is deliberately above the twelve-file maximum so one honest
 * session with a couple of retried files still fits, while a script grinding
 * presigned URLs does not.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_AUTHORIZATIONS = MARKETPLACE_UPLOAD_MAX_FILES * 2;
const attempts = new Map<string, number[]>();

export function marketplaceUploadRateLimitKey(value: string) {
  return createHash("sha256")
    .update(`civilon-marketplace-upload-authorize:v1:${value}`)
    .digest("hex");
}

export function consumeMarketplaceUploadAuthorization(key: string, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  const recent = (attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= MAX_AUTHORIZATIONS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)),
    };
  }
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 2_000) {
    for (const [candidate, timestamps] of attempts) {
      if (timestamps.every((timestamp) => timestamp <= cutoff)) attempts.delete(candidate);
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetMarketplaceUploadRateLimitForTests() {
  attempts.clear();
}
