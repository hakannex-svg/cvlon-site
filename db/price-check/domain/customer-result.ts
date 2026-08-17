import "../server-boundary.ts";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { RESULT_DISCLAIMER, factorLabels } from "../../../lib/price-check/result-copy.ts";

export const RESULT_DISCLAIMER_VERSION = "civilon-price-check-v1-pending-legal-review";
export { RESULT_DISCLAIMER, factorLabels };
export const RESULT_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const RESULT_SESSION_TTL_SECONDS = 30 * 60;

export const customerClassifications = [
  "BELOW_OBSERVED_RANGE",
  "WITHIN_OBSERVED_RANGE",
  "ABOVE_OBSERVED_RANGE",
  "INSUFFICIENT_COMPARABLE_EVIDENCE",
] as const;
export type CustomerClassification = (typeof customerClassifications)[number];

export function customerClassification(value: string | null): CustomerClassification {
  if (value === "BELOW_OBSERVED_RANGE") return value;
  if (value === "WITHIN_OBSERVED_RANGE") return value;
  if (value === "ABOVE_OBSERVED_RANGE") return value;
  return "INSUFFICIENT_COMPARABLE_EVIDENCE";
}

export function stableDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function keyBytes(key: string) {
  if (key.length < 32) throw new Error("Result token key must contain at least 32 characters.");
  return Buffer.from(key, "utf8");
}

export function newTokenNonce() {
  return randomBytes(32).toString("hex");
}

export function deriveResultToken(key: string, nonce: string) {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error("Token nonce is invalid.");
  return createHmac("sha256", keyBytes(key)).update(`civilon-result-token:v1:${nonce}`).digest("base64url");
}

export function hashResultToken(key: string, token: string) {
  return createHmac("sha256", keyBytes(key)).update(`civilon-result-lookup:v1:${token}`).digest("hex");
}

export function secureEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

type ResultSession = { resultId: string; tokenId: string; expiresAt: number };

export function createResultSession(key: string, session: ResultSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", keyBytes(key)).update(`civilon-result-session:v1:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyResultSession(key: string, value: string | undefined, now = Date.now()): ResultSession | null {
  if (!value || value.length > 1000) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", keyBytes(key)).update(`civilon-result-session:v1:${payload}`).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ResultSession;
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(parsed.resultId) || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(parsed.tokenId) || !Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= now) return null;
    return parsed;
  } catch {
    return null;
  }
}
