/**
 * The vocabulary of a buyer's answer to Civilon's own offer, as staff act on it.
 *
 * A Buy Request may carry several buyer offers over its life, versioned per
 * request. This module answers one question about one request — "what did the
 * buyer say about the offer that is actually current, and is the request still
 * open work?" — and it is the only place that answer is defined. The All Work
 * counter and the Buy Request list filter both read it, so a number and the list
 * it opens cannot come to mean two different things.
 *
 * A decision recorded here is a buyer's statement about a commercial offer. It is
 * not a payment, not a purchase order, not a procurement, not a shipment, not an
 * acceptance of documentation, and it is not certification, airworthiness
 * approval, an authenticity guarantee or a guarantee of fitness for any purpose.
 * Availability remains subject to confirmation either way.
 *
 * Kept free of the schema layer, exactly as `sell-inventory-freshness.ts` is, so
 * both vocabularies below can be asserted against the database enums without
 * importing them.
 */

import {
  buyRequestStatusValues,
  type BuyRequestStatusValue,
} from "./marketplace-status-policy.ts";
import type { BuyerOfferStatusValue } from "./buyer-offer-policy.ts";

/**
 * Exactly the two offer statuses that are a decision by the buyer.
 *
 * `draft`, `sent`, `expired`, `superseded` and `withdrawn` are deliberately
 * absent, and each for the same reason: none of them is something the buyer
 * said. A draft was never sent, a sent offer is still waiting, an expired one
 * ran out of time, and Civilon itself supersedes and withdraws. Counting any of
 * them as a decision would report Civilon's own bookkeeping as the buyer's
 * answer.
 *
 * Typed against the offer vocabulary rather than as free strings, so a value
 * that is not a real offer status cannot be added here.
 */
export const buyerDecisions = [
  "accepted",
  "declined",
] as const satisfies readonly BuyerOfferStatusValue[];

export type BuyerDecision = (typeof buyerDecisions)[number];

/**
 * Strict membership. Everything else — an empty string, a casing variant, any
 * other offer status, a SQL fragment — is malformed, and the repository fails
 * closed on it rather than dropping the filter and widening the list.
 */
export function isBuyerDecision(value: unknown): value is BuyerDecision {
  return typeof value === "string"
    && (buyerDecisions as readonly string[]).includes(value);
}

/**
 * Buy Request statuses that mean the request is no longer open work.
 *
 * `converted` alongside the three terminal statuses: a converted request has
 * already become the thing the decision was leading to, and a closed, spam or
 * withdrawn one is over. Chasing any of them would be Civilon asking staff to
 * act on work that has already ended.
 *
 * Stated as the concluded set rather than as an allowlist of open ones, so a
 * status added to the workflow later is treated as open until somebody
 * deliberately declares it concluded. The visible failure — a request appearing
 * in a counter that asks staff to look at it — is the safe direction; silently
 * dropping live work out of a follow-up list is not.
 */
export const BUYER_DECISION_CONCLUDED_BUY_REQUEST_STATUSES = [
  "converted",
  "closed",
  "spam",
  "withdrawn",
] as const satisfies readonly BuyRequestStatusValue[];

/** The complement of the above, derived so the two cannot overlap or drift. */
export const BUYER_DECISION_OPEN_BUY_REQUEST_STATUSES: readonly BuyRequestStatusValue[] =
  buyRequestStatusValues.filter((status) =>
    !(BUYER_DECISION_CONCLUDED_BUY_REQUEST_STATUSES as readonly string[]).includes(status));

export function isBuyerDecisionOpenBuyRequestStatus(value: unknown) {
  return typeof value === "string"
    && (BUYER_DECISION_OPEN_BUY_REQUEST_STATUSES as readonly string[]).includes(value);
}

/**
 * The decision one Buy Request's offer history carries, or `null` when it
 * carries none.
 *
 * Pure, and written here as a function over stored rows for the same reason the
 * freshness cadence rule is: the repository must decide the same thing in SQL
 * against every request at once, and a test can hold the two spellings against
 * each other only if one of them is executable on its own.
 *
 * The newest offer is the only one consulted. An older acceptance under a newer
 * offer is history, not a live decision, and reporting it would send staff after
 * something that has already been replaced. Versions are unique per request in
 * the schema, so "highest version" is a total order with no tie to break.
 */
export function latestBuyerDecision(
  offers: readonly { version: number; status: string }[],
): BuyerDecision | null {
  let latest: { version: number; status: string } | null = null;
  for (const offer of offers) {
    if (!latest || offer.version > latest.version) latest = offer;
  }
  if (!latest) return null;
  return isBuyerDecision(latest.status) ? latest.status : null;
}

/**
 * Whether one Buy Request belongs in a decision counter, and under which
 * decision. `null` means it belongs in neither.
 */
export function buyRequestDecisionState(
  request: { status: string; offers: readonly { version: number; status: string }[] },
): BuyerDecision | null {
  if (!isBuyerDecisionOpenBuyRequestStatus(request.status)) return null;
  return latestBuyerDecision(request.offers);
}
