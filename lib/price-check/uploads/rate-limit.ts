import "../../../db/price-check/server-boundary.ts";

import { createHash } from "node:crypto";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_AUTHORIZATIONS = 12;
const attempts = new Map<string, number[]>();

export function uploadRateLimitKey(value: string) {
  return createHash("sha256").update(`civilon-upload-authorize:v1:${value}`).digest("hex");
}

export function consumeUploadAuthorization(key: string, now = Date.now()) {
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

export function resetUploadRateLimitForTests() {
  attempts.clear();
}

