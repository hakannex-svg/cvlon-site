import "../../db/price-check/server-boundary.ts";

import { createHash } from "node:crypto";

/**
 * Marketplace intake keeps its own counters, deliberately separate from the
 * Price Check limiter: neither workflow may consume the other's budget, and
 * tuning one must never silently loosen the other.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, number[]>();

export function marketplaceRateLimitKey(value: string) {
  return createHash("sha256").update(`civilon-marketplace-rate:v1:${value}`).digest("hex");
}

export function consumeMarketplaceAttempt(key: string, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  const recent = (attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= MAX_ATTEMPTS) {
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

export function resetMarketplaceRateLimitForTests() {
  attempts.clear();
}
