/**
 * Status policy for Civilon's own offer to a buyer.
 *
 * Pure domain logic. This is the resale side of the transaction: Civilon's sale
 * price and the buyer-facing delivery option, and nothing that could name or
 * price a supplier.
 *
 * ── Why `draft` has exactly one outbound edge ────────────────────────────────
 *
 * The requested graph included `draft -> withdrawn` and `draft -> superseded`.
 * The schema makes both impossible without lying. `buyer_offers_sent_state_chk`
 * requires `sent_at` for every status other than `draft`, and
 * `buyer_offers_draft_not_sent_chk` requires `sent_at` to be null while the
 * status IS `draft`. Together they say: a row is a draft exactly while it has
 * never been sent. Moving a draft to `withdrawn` or `superseded` would mean
 * stamping a `sent_at` for an offer that was never sent — a false delivery
 * claim in the system of record.
 *
 * So a draft leaves `draft` only by being sent. A draft that is wrong is
 * replaced (see `createBuyerOffer`), and a *sent* offer is what gets superseded
 * when a new one goes out. Closing this properly would need a migration, which
 * this stage is not authorised to make.
 */

export const buyerOfferStatusValues = [
  "draft", "sent", "accepted", "declined", "expired", "superseded", "withdrawn",
] as const;
export type BuyerOfferStatusValue = (typeof buyerOfferStatusValues)[number];

/**
 * The buyer-facing delivery choices, and the complete set of them.
 *
 * `supplier_direct` is deliberately absent and must never be added: whether
 * Civilon has a supplier ship directly or routes through New Jersey is an
 * internal fulfilment decision. The buyer is offered a destination, not a
 * description of Civilon's supply chain.
 */
export const buyerOfferDeliveryOptions = [
  "door_delivery", "port_of_entry", "nj_pickup", "not_determined",
] as const;
export type BuyerOfferDeliveryOption = (typeof buyerOfferDeliveryOptions)[number];

export const buyerOfferCurrencies = ["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "USD"] as const;
export const buyerOfferConditionCodes = ["NE", "NS", "OH", "SV", "AR", "ANY", "NOT_SURE"] as const;

export const DEFAULT_BUYER_OFFER_STATUS: BuyerOfferStatusValue = "draft";
export const DEFAULT_BUYER_OFFER_DELIVERY: BuyerOfferDeliveryOption = "not_determined";

export const buyerOfferTerminalStatuses = [
  "accepted", "declined", "expired", "superseded", "withdrawn",
] as const;

/** Statuses a new draft may supersede. Anything terminal is left alone. */
export const buyerOfferSupersedableStatuses = ["sent"] as const;

const graph: Record<BuyerOfferStatusValue, readonly BuyerOfferStatusValue[]> = {
  // See the note above: the only way out of `draft` is being sent.
  draft: ["sent"],
  sent: ["accepted", "declined", "expired", "withdrawn", "superseded"],
  accepted: [],
  declined: [],
  expired: [],
  superseded: [],
  withdrawn: [],
};

export function isBuyerOfferStatus(value: unknown): value is BuyerOfferStatusValue {
  return typeof value === "string" && (buyerOfferStatusValues as readonly string[]).includes(value);
}

export function isBuyerOfferDeliveryOption(value: unknown): value is BuyerOfferDeliveryOption {
  return typeof value === "string" && (buyerOfferDeliveryOptions as readonly string[]).includes(value);
}

export function isBuyerOfferTerminal(value: string) {
  return (buyerOfferTerminalStatuses as readonly string[]).includes(value);
}

export function buyerOfferTargets(from: string): readonly BuyerOfferStatusValue[] {
  return (graph as Record<string, readonly BuyerOfferStatusValue[]>)[from] ?? [];
}

export function canTransitionBuyerOffer(from: string, to: string) {
  return (buyerOfferTargets(from) as readonly string[]).includes(to);
}

/**
 * Which timestamp a transition stamps.
 *
 * `expired` and `withdrawn` stamp nothing: neither is a buyer response, and
 * writing `responded_at` for them would invent one.
 */
export function buyerOfferTimestampFor(to: string): "sentAt" | "respondedAt" | "supersededAt" | null {
  if (to === "sent") return "sentAt";
  if (to === "accepted" || to === "declined") return "respondedAt";
  if (to === "superseded") return "supersededAt";
  return null;
}

export const BUYER_OFFER_DRAFTED_ACTION = "BUYER_OFFER_DRAFTED";
export const BUYER_OFFER_STATUS_ACTION = "BUYER_OFFER_STATUS_CHANGED";
export const BUYER_OFFER_SUPERSEDED_ACTION = "BUYER_OFFER_SUPERSEDED";
export const BUYER_OFFER_DRAFT_REPLACED_ACTION = "BUYER_OFFER_DRAFT_REPLACED";

/**
 * The wording every buyer-facing rendering of an offer must carry.
 *
 * Civilon sells the part; it does not certify it. Nothing about making or
 * reviewing an offer is an approval of anything.
 */
export const BUYER_OFFER_DISCLOSURE =
  "Documentation varies by part and source, and all availability is subject to confirmation. "
  + "This offer is not a certification, an airworthiness approval, or a regulatory approval, "
  + "and it is not a guarantee of authenticity or fitness for any purpose.";
