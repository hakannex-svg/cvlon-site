/**
 * Status policy for an internal supplier response against a Buy Request.
 *
 * Pure domain logic. Kept apart from the aggregate status policy because a
 * supplier response is sourcing work, not the customer's record: moving one
 * through this graph never moves the Buy Request, never creates a buyer offer,
 * and never contacts anyone.
 *
 * Terminal states are terminal here for the same reason they are on the
 * aggregates: a declined, withdrawn or expired supplier response is a fact
 * about what happened, not a slot to be reused.
 */

export const supplierResponseStatusValues = [
  "received", "under_review", "shortlisted", "selected", "declined", "withdrawn", "expired",
] as const;
export type SupplierResponseStatusValue = (typeof supplierResponseStatusValues)[number];

export const supplierSourceKinds = ["registered_contact", "nonregistered_supplier"] as const;
export type SupplierSourceKind = (typeof supplierSourceKinds)[number];

/**
 * How available the supplier says the part is. Every value is phrased as the
 * supplier's own claim, and the default records no claim at all: Civilon does
 * not confirm availability, and nothing in this vocabulary may imply it does.
 */
export const supplierAvailabilityStates = [
  "subject_to_confirmation", "claimed_available", "claimed_lead_time", "unavailable", "unknown",
] as const;
export type SupplierAvailabilityState = (typeof supplierAvailabilityStates)[number];

export const DEFAULT_SUPPLIER_AVAILABILITY: SupplierAvailabilityState = "subject_to_confirmation";
export const DEFAULT_SUPPLIER_RESPONSE_STATUS: SupplierResponseStatusValue = "received";

export const supplierResponseTerminalStatuses = ["declined", "withdrawn", "expired"] as const;

/** The currencies `supplier_responses_currency_chk` accepts. */
export const supplierResponseCurrencies = ["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "USD"] as const;

/** `marketplace_condition_code`, as a supplier may state it. */
export const supplierConditionCodes = ["NE", "NS", "OH", "SV", "AR", "ANY", "NOT_SURE"] as const;

const graph: Record<SupplierResponseStatusValue, readonly SupplierResponseStatusValue[]> = {
  received: ["under_review", "shortlisted", "declined", "withdrawn", "expired"],
  under_review: ["shortlisted", "declined", "withdrawn", "expired"],
  shortlisted: ["selected", "declined", "withdrawn", "expired"],
  // Selecting a supplier is a sourcing decision, not a commitment: it can still
  // fall through, and doing so is recorded rather than erased.
  selected: ["declined", "withdrawn", "expired"],
  declined: [],
  withdrawn: [],
  expired: [],
};

export function isSupplierResponseStatus(value: unknown): value is SupplierResponseStatusValue {
  return typeof value === "string" && (supplierResponseStatusValues as readonly string[]).includes(value);
}

export function isSupplierSourceKind(value: unknown): value is SupplierSourceKind {
  return typeof value === "string" && (supplierSourceKinds as readonly string[]).includes(value);
}

export function isSupplierAvailabilityState(value: unknown): value is SupplierAvailabilityState {
  return typeof value === "string" && (supplierAvailabilityStates as readonly string[]).includes(value);
}

export function isSupplierResponseTerminal(value: string) {
  return (supplierResponseTerminalStatuses as readonly string[]).includes(value);
}

export function supplierResponseTargets(from: string): readonly SupplierResponseStatusValue[] {
  return (graph as Record<string, readonly SupplierResponseStatusValue[]>)[from] ?? [];
}

export function canTransitionSupplierResponse(from: string, to: string) {
  return (supplierResponseTargets(from) as readonly string[]).includes(to);
}

export const SUPPLIER_RESPONSE_RECORDED_ACTION = "SUPPLIER_RESPONSE_RECORDED";
export const SUPPLIER_RESPONSE_STATUS_ACTION = "SUPPLIER_RESPONSE_STATUS_CHANGED";
