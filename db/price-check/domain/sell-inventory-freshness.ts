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
 * How long a seller's answer is treated as current before Civilon asks again.
 * Forty-five days.
 *
 * Stage 2's autonomous producer anchors on exactly this number rather than
 * inventing a second one: the figure the admin surface shows as "next check
 * due" is the figure the producer measures against, so staff never read one
 * cadence while the schedule runs another.
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
 * timer would be Civilon repeating a question it has been answered, so the
 * autonomous producer treats these as terminal until a staff reissue creates a
 * newer check. The admin surface displays them distinctly from the same list, so
 * the rule has one definition rather than two.
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

/* ------------------------------------------------------------------ cadence */

/**
 * The autonomous cadence: the rule that decides, without a staff member, whether
 * Civilon may ask one seller the freshness question again today.
 *
 * It is written here — as a pure function over stored rows — rather than only as
 * a database predicate, because the producer must decide twice: once when it
 * selects a batch (a SQL predicate, so a scan does not load every record), and
 * once inside the transaction that writes (this function, against the rows as
 * they are at that instant). Two spellings of one rule would eventually
 * disagree; a predicate and its authority cannot.
 *
 * Nothing decided here changes a Sell Submission's status, its business review,
 * its evidence review, or any certification, authenticity, airworthiness or
 * regulatory position, and nothing here obliges Civilon to buy.
 */

/** How many submissions one scheduled run may ask about. */
export const SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX = 25;

/**
 * How many automatic asks may lapse unanswered before the cadence stops for a
 * record.
 *
 * Two, not one: a single unanswered link is as likely to be a holiday as a
 * disinterested seller. Two consecutive automatic asks that both expired with no
 * answer is Civilon talking to itself, and it stops until a staff member decides
 * the record is worth asking about again.
 */
export const SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC = 2;

/**
 * A check, as the cadence rule reads it.
 *
 * `requestedByAdminUserId` is the whole of the manual/automatic distinction: a
 * staff member's id marks a check somebody asked for, and null marks one the
 * schedule produced. No second column, and no flag that could drift from it.
 */
export type SellInventoryFreshnessCadenceCheck = {
  id: string;
  requestedByAdminUserId: string | null;
  issuedAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  revokedAt: Date | null;
  response: string | null;
};

/** Why the cadence did or did not ask. Fixed categories: never an identifier. */
export const sellInventoryFreshnessCadenceReasons = [
  /** No check was ever issued for this record. */
  "never_checked",
  /** The 45 days since the last ask, or the last answer, have elapsed. */
  "cadence_elapsed",
  /** A credential the seller could still use is out. Nothing on a timer touches it. */
  "live_check",
  /** The seller's latest answer says the inventory moved. */
  "stop_response",
  /** Two automatic asks in a row lapsed unanswered. */
  "lapsed_backoff",
  /** Inside the 45-day cadence. */
  "not_due",
] as const;

export type SellInventoryFreshnessCadenceReason =
  (typeof sellInventoryFreshnessCadenceReasons)[number];

export type SellInventoryFreshnessCadenceDecision =
  | { due: true; reason: "never_checked" | "cadence_elapsed" }
  | { due: false; reason: "live_check" | "stop_response" | "lapsed_backoff" | "not_due" };

/** Newest first, by the same ordering the staff projection uses. */
export function sellInventoryFreshnessChecksNewestFirst(
  checks: readonly SellInventoryFreshnessCadenceCheck[],
) {
  return [...checks].sort((left, right) =>
    right.issuedAt.valueOf() - left.issuedAt.valueOf()
    || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0));
}

/** Whether one stored check was produced by the schedule rather than by staff. */
export function isSellInventoryFreshnessAutomaticCheck(
  check: { requestedByAdminUserId: string | null },
) {
  return check.requestedByAdminUserId === null;
}

/**
 * How many automatic asks have lapsed unanswered in an unbroken run ending at
 * the newest check.
 *
 * The run is *trailing*: it is counted from the newest check backwards and stops
 * at the first check that is not an automatic ask which expired unanswered. A
 * staff-issued check therefore resets it by existing, which is the only reset
 * there is — a status edit is not one, because nobody asked the seller anything
 * by editing a status.
 *
 * `revoked_at` is deliberately not consulted. The producer retires an expired
 * ask of its own to free the record's one index slot before writing the next
 * one, and a strike that the producer could erase by taking its own row out of
 * the way would not be a strike at all: two unanswered automatic asks are two
 * unanswered automatic asks whether or not the first has since been retired.
 * What ends the run is a *different kind* of check — one somebody answered, or
 * one a staff member issued.
 */
export function sellInventoryFreshnessLapsedAutomaticRun(
  checks: readonly SellInventoryFreshnessCadenceCheck[],
  now: Date,
) {
  let run = 0;
  for (const check of sellInventoryFreshnessChecksNewestFirst(checks)) {
    const lapsed = isSellInventoryFreshnessAutomaticCheck(check)
      && !check.respondedAt
      && check.expiresAt.valueOf() <= now.valueOf();
    if (!lapsed) break;
    run += 1;
  }
  return run;
}

/**
 * Whether a check is one the database still counts as standing.
 *
 * Unanswered and unrevoked, whatever its expiry — which is exactly the predicate
 * of the partial unique index that allows one such row per submission. Standing
 * is not the same as usable: a lapsed link is dead to the seller but still holds
 * the record's slot, which is why retiring one is a precondition of asking
 * again rather than an act against anybody.
 */
export function isSellInventoryFreshnessStandingCheck(
  check: { respondedAt: Date | null; revokedAt: Date | null },
) {
  return !check.respondedAt && !check.revokedAt;
}

/**
 * Whether a credential is one a seller could still use right now.
 *
 * Standing *and* unexpired. This is the check the producer must never touch:
 * somebody may have the e-mail open. Expressed through the existing request
 * state so "live" has one definition across the staff surface and the schedule.
 */
export function isSellInventoryFreshnessLiveCheck(
  check: { respondedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
) {
  return sellInventoryFreshnessRequestState(check, now) === "awaiting_seller";
}

/**
 * Whether a check is a dead credential holding a live slot.
 *
 * Standing, so the partial unique index counts it; expired, so no seller can
 * answer it and no link in anybody's inbox still works. Retiring one of these —
 * stamping `revoked_at` in the same transaction that writes the next ask — is
 * the only write the automatic path ever makes to an existing row, and it is
 * bookkeeping on something already dead rather than the withdrawal of anything.
 */
export function isSellInventoryFreshnessRetirableCheck(
  check: { respondedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
) {
  return isSellInventoryFreshnessStandingCheck(check)
    && !isSellInventoryFreshnessLiveCheck(check, now);
}

/**
 * Whether the schedule may ask this record today, and why.
 *
 * Four independent reasons to say no, so the answer does not depend on the order
 * they are tested in — the order below only decides which one is *reported*:
 *
 *  1. Two lapsed automatic asks in a row: the cadence has stopped talking to
 *     itself, and it stays stopped until a staff member asks by hand.
 *  2. A live check — standing and unexpired. A seller may be holding that
 *     e-mail, and nothing on a timer may take it away from them.
 *  3. A stop answer on the newest check is sticky. Only a newer check clears it,
 *     and since the producer cannot write one while the stop answer is newest,
 *     that newer check is always a staff member's.
 *  4. The 45 days have not elapsed. No history at all is due immediately;
 *     otherwise the newest check's `COALESCE(responded_at, issued_at) + 45 days`
 *     decides, with the boundary itself counting as due.
 *
 * An expired standing check is deliberately *not* a reason to say no. By the
 * time 45 days have passed a 14-day credential is three weeks dead, and the
 * producer retires it inside the writing transaction to free the record's index
 * slot.
 */
export function sellInventoryFreshnessCadenceDecision(
  checks: readonly SellInventoryFreshnessCadenceCheck[],
  now: Date,
): SellInventoryFreshnessCadenceDecision {
  const [latest] = sellInventoryFreshnessChecksNewestFirst(checks);
  if (!latest) return { due: true, reason: "never_checked" };
  if (
    sellInventoryFreshnessLapsedAutomaticRun(checks, now)
      >= SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC
  ) {
    return { due: false, reason: "lapsed_backoff" };
  }
  if (checks.some((check) => isSellInventoryFreshnessLiveCheck(check, now))) {
    return { due: false, reason: "live_check" };
  }
  if (latest.respondedAt && isSellInventoryFreshnessStopResponse(latest.response)) {
    return { due: false, reason: "stop_response" };
  }
  return now.valueOf() >= sellInventoryFreshnessDueAt(latest).valueOf()
    ? { due: true, reason: "cadence_elapsed" }
    : { due: false, reason: "not_due" };
}

/**
 * Every way one submission can leave a scheduled run, as a closed vocabulary.
 *
 * A run summary is counts against these codes and nothing else: no submission
 * id, no reference, no contact, no part, no file, no price, no location, no
 * credential and no URL ever reaches a log line or an HTTP response.
 */
export const sellInventoryFreshnessCadenceOutcomes = [
  /** A check, its audit event and its e-mail were recorded together. */
  "issued",
  "live_check",
  "stop_response",
  "lapsed_backoff",
  "not_due",
  /** Another writer held the record. It is left for the next run. */
  "locked",
  /** Kind, status or contact stopped qualifying between selection and writing. */
  "ineligible",
] as const;

export type SellInventoryFreshnessCadenceOutcome =
  (typeof sellInventoryFreshnessCadenceOutcomes)[number];

export function isSellInventoryFreshnessCadenceOutcome(
  value: unknown,
): value is SellInventoryFreshnessCadenceOutcome {
  return typeof value === "string"
    && (sellInventoryFreshnessCadenceOutcomes as readonly string[]).includes(value);
}

/* --------------------------------------------------------- staff drill-down */

/**
 * The bulk-inventory freshness states a staff member may narrow a Sell
 * Submission list to.
 *
 * A closed allowlist rather than a free string, and deliberately the same four
 * states the All Work counters already report, so a counter and the list it
 * opens cannot mean two different things:
 *
 *  - `due` — the producer's own eligible-and-due predicate, and nothing else.
 *    Its batch cap is not part of the predicate: staff are asking which records
 *    are waiting, not which twenty-five the next run happens to take.
 *  - `live` — a credential the seller could still use is out.
 *  - `backoff` — two automatic asks in a row lapsed unanswered, so the cadence
 *    has stopped for that record until a staff member asks by hand.
 *  - `seller_changes` — the seller's own latest answer says the inventory moved.
 *
 * Delivery concerns is deliberately absent. It counts queued e-mails rather than
 * records, so there is no set of Sell Submissions it could narrow a list to, and
 * a filter that pretended otherwise would answer a different question from the
 * counter a staff member clicked.
 *
 * Naming a state here is not a Civilon position on the parts: every one of them
 * describes stored workflow state, never certification, airworthiness,
 * authenticity or fitness for any use.
 */
export const sellInventoryFreshnessFilters = [
  "due",
  "live",
  "backoff",
  "seller_changes",
] as const;

export type SellInventoryFreshnessFilter = (typeof sellInventoryFreshnessFilters)[number];

/**
 * Strict membership. Everything else — an empty string, a casing variant, a
 * counter key, a SQL fragment — is malformed, and the repository fails closed on
 * it rather than dropping the filter and widening the list.
 */
export function isSellInventoryFreshnessFilter(
  value: unknown,
): value is SellInventoryFreshnessFilter {
  return typeof value === "string"
    && (sellInventoryFreshnessFilters as readonly string[]).includes(value);
}
