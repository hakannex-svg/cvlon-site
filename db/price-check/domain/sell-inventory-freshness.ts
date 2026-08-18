/**
 * The vocabulary of a bulk-inventory freshness check.
 *
 * Civilon holds bulk inventory offers that go stale: a seller lists a warehouse
 * of parts, and weeks later some of it is gone. A freshness check asks that
 * seller one question — is this still available — and records their answer.
 *
 * What a seller answers here is a *statement by the seller*, at a moment in
 * time. It is not a workflow transition, not a business review, not an evidence
 * review, not certification, not authenticity proof, not airworthiness or any
 * other regulatory approval, not supplier approval, and it does not oblige
 * Civilon to buy anything. Availability remains subject to confirmation either
 * way, and documentation varies by part and source.
 *
 * Kept free of the schema layer, exactly as `sell-evidence-request.ts` is, so
 * the response allowlist can be asserted against the database enum and the
 * public contract without importing either.
 */

/**
 * The shared-outbox coordinates of the seller's freshness e-mail.
 *
 * Here rather than in the repository for the same reason the evidence request's
 * are: the handler that sends the message and the read-only admin projection
 * that reports whether it was delivered both need them, and a read repository
 * importing a write repository to learn a string constant would be a dependency
 * in the wrong direction.
 */
export const SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE =
  "SELL_SUBMISSION_INVENTORY_FRESHNESS_CHECK";
export const SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE =
  "sell_inventory_freshness_check";

/**
 * How long an emailed freshness link lives. Fourteen days, exactly as the
 * message states to the seller and exactly as the evidence link works: long
 * enough for someone who reads mail weekly, short enough that a forwarded
 * message is not a standing credential.
 */
export const SELL_INVENTORY_FRESHNESS_TTL_DAYS = 14;
export const SELL_INVENTORY_FRESHNESS_TTL_MS =
  SELL_INVENTORY_FRESHNESS_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * How long a seller's answer is treated as current before staff would ordinarily
 * ask again. Forty-five days.
 *
 * Stage 1 does not schedule anything: no producer, no cron, no autonomous
 * function. The constant exists so the admin surface can say honestly whether a
 * record is due, and so Stage 2 — which is the scheduled producer, and which
 * depends on this migration and this manual path being deployed and proven —
 * anchors on exactly the same number rather than inventing a second one.
 */
export const SELL_INVENTORY_FRESHNESS_CADENCE_DAYS = 45;
export const SELL_INVENTORY_FRESHNESS_CADENCE_MS =
  SELL_INVENTORY_FRESHNESS_CADENCE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Exactly the three answers a seller may give.
 *
 * Three and only three, because a free-text answer would be a place for a
 * seller to write a part number, a price or a buyer's name into a record that
 * deliberately carries none of those, and because a two-way yes/no would force
 * a seller whose warehouse has partly moved to overstate in one direction or
 * the other.
 *
 * The stored values are the wire values are the database enum values. One
 * spelling, so a browser, a row and a check constraint cannot disagree.
 */
export const sellInventoryFreshnessResponses = [
  "all_available",
  "some_changed",
  "none_available",
] as const;

export type SellInventoryFreshnessResponse =
  (typeof sellInventoryFreshnessResponses)[number];

export function isSellInventoryFreshnessResponse(
  value: unknown,
): value is SellInventoryFreshnessResponse {
  return typeof value === "string"
    && (sellInventoryFreshnessResponses as readonly string[]).includes(value);
}

/**
 * Seller-facing labels. Each states what the seller is saying and nothing about
 * what Civilon concludes from it.
 */
export const sellInventoryFreshnessResponseLabels:
  Record<SellInventoryFreshnessResponse, string> = {
    all_available: "All inventory is still available",
    some_changed: "Some items changed",
    none_available: "This inventory is no longer available",
  };

/**
 * The two answers that stop an automated cadence until a staff member acts.
 *
 * A seller who has told Civilon that some or all of the inventory has moved has
 * already answered the question the cadence exists to ask. Asking again on a
 * timer would be Civilon repeating a question it has been answered, so Stage 2's
 * producer must treat these as terminal until a staff reissue creates a new
 * check. Stage 1 has no producer; it displays them distinctly and exports this
 * so the rule has one definition rather than two.
 */
export const sellInventoryFreshnessStopResponses = [
  "some_changed",
  "none_available",
] as const satisfies readonly SellInventoryFreshnessResponse[];

export function isSellInventoryFreshnessStopResponse(
  value: unknown,
): value is SellInventoryFreshnessResponse {
  return typeof value === "string"
    && (sellInventoryFreshnessStopResponses as readonly string[]).includes(value);
}

/**
 * Sell Submission statuses on which staff may issue a freshness check.
 *
 * Deliberately an allowlist rather than a "not terminal" test. A record still
 * awaiting the seller's own e-mail confirmation has no confirmed address to
 * write to; an accepted, declined, closed, withdrawn or spam record has had its
 * question answered by Civilon rather than by the seller. Only a live record
 * under active consideration is asked.
 */
export const SELL_INVENTORY_FRESHNESS_ELIGIBLE_STATUSES = [
  "verified",
  "under_review",
] as const;

export function isSellInventoryFreshnessEligibleStatus(value: unknown) {
  return typeof value === "string"
    && (SELL_INVENTORY_FRESHNESS_ELIGIBLE_STATUSES as readonly string[]).includes(value);
}

/** The one submission kind this workflow exists for. */
export const SELL_INVENTORY_FRESHNESS_SUBMISSION_KIND = "bulk_inventory";

export function isSellInventoryFreshnessSubmissionKind(value: unknown) {
  return value === SELL_INVENTORY_FRESHNESS_SUBMISSION_KIND;
}

/**
 * How one stored check reads to staff. Derived, never stored: a status column
 * would be a second copy of the timestamps that already say it.
 */
export type SellInventoryFreshnessRequestState =
  | "awaiting_seller"
  | "answered"
  | "expired"
  | "revoked";

export function sellInventoryFreshnessRequestState(
  check: {
    respondedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  },
  now: Date,
): SellInventoryFreshnessRequestState {
  // An answer that arrived outranks everything: a seller who replied replied,
  // whatever the link did afterwards.
  if (check.respondedAt) return "answered";
  if (check.revokedAt) return "revoked";
  if (check.expiresAt.valueOf() <= now.valueOf()) return "expired";
  return "awaiting_seller";
}

/**
 * Whether the seller's e-mail actually went out, as the shared outbox records
 * it — which is a different question from whether the check exists.
 *
 * Its own function rather than a shared one, because "what the outbox says
 * about this workflow's message" is a per-workflow reading and a shared helper
 * would make a change to one workflow's vocabulary a change to the other's.
 * `delivered` means the provider accepted the message: it is not a read receipt
 * and not proof the seller saw anything.
 */
export type SellInventoryFreshnessDeliveryState =
  | "queued"
  | "sending"
  | "delivered"
  | "retrying"
  | "undeliverable"
  | "unrecorded";

export function sellInventoryFreshnessDeliveryState(
  outboxState: string | null | undefined,
): SellInventoryFreshnessDeliveryState {
  switch (outboxState) {
    case "pending": return "queued";
    case "running": return "sending";
    case "succeeded": return "delivered";
    case "failed": return "retrying";
    case "dead_letter": return "undeliverable";
    // No row, or a state this build does not recognise. Saying nothing is known
    // is honest; guessing "sent" is not.
    default: return "unrecorded";
  }
}

/**
 * How the *submission* reads, from its latest check.
 *
 * The precedence is fixed and deliberate:
 *
 *  1. `none_available` and `some_changed` — the seller has told Civilon the
 *     inventory moved. That outranks any timer, and it stays until a staff
 *     member issues a new check.
 *  2. `awaiting_seller` — a live link is out and unanswered.
 *  3. `current` / `due` — the last answer was `all_available`, or the link
 *     lapsed unanswered. Whether it is still current is measured from
 *     `COALESCE(responded_at, issued_at) + 45 days`, which is the same anchor
 *     Stage 2's producer will use.
 *  4. `never_checked` — no check was ever issued.
 *
 * `expired` and `revoked` are deliberately not in this list: they describe one
 * request, not the submission, and are reported separately by
 * `sellInventoryFreshnessRequestState` when a specific latest request is shown.
 */
export type SellInventoryFreshnessSubmissionState =
  | "none_available"
  | "some_changed"
  | "awaiting_seller"
  | "current"
  | "due"
  | "never_checked";

export function sellInventoryFreshnessSubmissionState(
  latest: {
    response: string | null;
    respondedAt: Date | null;
    revokedAt: Date | null;
    issuedAt: Date;
    expiresAt: Date;
  } | null,
  now: Date,
): SellInventoryFreshnessSubmissionState {
  if (!latest) return "never_checked";
  // A stop answer is sticky. It is read before the timer precisely so that time
  // passing cannot turn "the seller told us it is gone" back into "due".
  if (latest.respondedAt && isSellInventoryFreshnessStopResponse(latest.response)) {
    return latest.response as SellInventoryFreshnessSubmissionState;
  }
  if (sellInventoryFreshnessRequestState(latest, now) === "awaiting_seller") {
    return "awaiting_seller";
  }
  return now.valueOf() < sellInventoryFreshnessDueAt(latest).valueOf() ? "current" : "due";
}

/**
 * When the next check would ordinarily fall due.
 *
 * Anchored on the seller's answer when there is one and on the date Civilon
 * asked when there is not, so a link that lapsed unanswered still starts the
 * clock from the ask rather than from the beginning of time.
 */
export function sellInventoryFreshnessDueAt(
  latest: { respondedAt: Date | null; issuedAt: Date },
) {
  const anchor = latest.respondedAt ?? latest.issuedAt;
  return new Date(anchor.valueOf() + SELL_INVENTORY_FRESHNESS_CADENCE_MS);
}
