import "../../../db/price-check/server-boundary.ts";

/**
 * GuardDuty malware-scan evidence, read from the object's tag set.
 *
 * The decision is deliberately three-valued and fails closed in two different
 * directions:
 *
 *  - Only the single literal `NO_THREATS_FOUND` yields CLEAN. Every other
 *    value, and a missing tag, does not.
 *  - A missing or still-pending tag is PENDING, not FAILED. The seller is told
 *    to retry in a moment rather than that their file was rejected, because
 *    "the scanner has not finished" and "the scanner found something" are
 *    different facts and must not be reported as the same one.
 *
 * Nothing here ever claims clean on absent evidence. If the tag cannot be read
 * at all — permissions, outage, deleted object — the caller sees the throw, not
 * a default.
 */
export const MARKETPLACE_SCAN_TAG = "GuardDutyMalwareScanStatus";

export type MarketplaceScanDecision = "CLEAN" | "PENDING" | "REJECTED" | "FAILED";

export function marketplaceScanDecision(status: string | undefined | null): MarketplaceScanDecision {
  if (!status) return "PENDING";
  if (status === "NO_THREATS_FOUND") return "CLEAN";
  if (status === "THREATS_FOUND") return "REJECTED";
  // ACCESS_DENIED, UNSUPPORTED, FAILED and anything unrecognised are all
  // "we do not know", which is never permission to proceed.
  return "FAILED";
}

/** Error codes the intake surface maps to a retry-or-refuse answer. */
export const MARKETPLACE_SCAN_PENDING_CODE = "MARKETPLACE_UPLOAD_SCAN_PENDING";
export const MARKETPLACE_SCAN_REJECTED_CODE = "MARKETPLACE_UPLOAD_SCAN_REJECTED";
export const MARKETPLACE_SCAN_UNAVAILABLE_CODE = "MARKETPLACE_UPLOAD_SCAN_UNAVAILABLE";

export function isRetryableScanCode(code: unknown) {
  return code === MARKETPLACE_SCAN_PENDING_CODE || code === MARKETPLACE_SCAN_UNAVAILABLE_CODE;
}
