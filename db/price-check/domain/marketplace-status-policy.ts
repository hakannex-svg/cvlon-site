/**
 * Server-enforced status policy for the two marketplace workflows.
 *
 * Pure domain logic: no database, no environment, no request. The vocabularies
 * are declared as literals here, matching the Price Check policy idiom, and the
 * unit tests assert they equal the schema enums so the two cannot drift.
 *
 * Three rules shape every decision below:
 *
 *  - A terminal row is terminal. There is no path out of `closed`, `spam` or
 *    `withdrawn`; a resurrection is not a transition Civilon can make.
 *  - `spam` and `closed` end a customer's record on Civilon's say-so, so they
 *    are ADMIN-only even where the graph allows them.
 *  - `pending_verification -> verified` bypasses a customer-driven control, so
 *    it is ADMIN-only and audited under its own action.
 */

export const marketplaceAggregates = ["buy_request", "sell_submission"] as const;
export type MarketplaceAggregate = (typeof marketplaceAggregates)[number];

export const buyRequestStatusValues = [
  "pending_verification", "verified", "sourcing", "quoted", "converted", "closed", "spam", "withdrawn",
] as const;
export type BuyRequestStatusValue = (typeof buyRequestStatusValues)[number];

export const sellSubmissionStatusValues = [
  "pending_verification", "verified", "under_review", "accepted", "declined", "closed", "spam", "withdrawn",
] as const;
export type SellSubmissionStatusValue = (typeof sellSubmissionStatusValues)[number];

/** States a record can never leave. */
export const marketplaceTerminalStatuses = ["closed", "spam", "withdrawn"] as const;

/**
 * States that also set `closed_at`. Deliberately the terminal three and not
 * `converted`, `accepted` or `declined`: those are outcomes, and the record is
 * still open work until someone closes it.
 */
export const marketplaceClosingStatuses = marketplaceTerminalStatuses;

/** Targets reserved to ADMIN even when the graph permits them. */
export const marketplaceExceptionalTargets = ["spam", "closed"] as const;

const buyRequestGraph: Record<BuyRequestStatusValue, readonly BuyRequestStatusValue[]> = {
  pending_verification: ["verified", "spam", "withdrawn"],
  verified: ["sourcing", "closed", "spam", "withdrawn"],
  sourcing: ["quoted", "closed", "withdrawn"],
  quoted: ["converted", "closed", "withdrawn"],
  converted: ["closed"],
  closed: [],
  spam: [],
  withdrawn: [],
};

const sellSubmissionGraph: Record<SellSubmissionStatusValue, readonly SellSubmissionStatusValue[]> = {
  pending_verification: ["verified", "spam", "withdrawn"],
  verified: ["under_review", "closed", "spam", "withdrawn"],
  under_review: ["accepted", "declined", "closed", "withdrawn"],
  accepted: ["closed"],
  declined: ["closed"],
  closed: [],
  spam: [],
  withdrawn: [],
};

export type MarketplaceStatusValue = BuyRequestStatusValue | SellSubmissionStatusValue;

export function marketplaceStatusValues(aggregate: MarketplaceAggregate): readonly MarketplaceStatusValue[] {
  return aggregate === "buy_request" ? buyRequestStatusValues : sellSubmissionStatusValues;
}

export function isMarketplaceStatus(aggregate: MarketplaceAggregate, value: unknown): value is MarketplaceStatusValue {
  return typeof value === "string" && (marketplaceStatusValues(aggregate) as readonly string[]).includes(value);
}

export function isMarketplaceTerminalStatus(value: string) {
  return (marketplaceTerminalStatuses as readonly string[]).includes(value);
}

export function marketplaceStatusClosesRecord(value: string) {
  return (marketplaceClosingStatuses as readonly string[]).includes(value);
}

/** Every target reachable from `from` by the graph alone, ignoring role. */
export function marketplaceGraphTargets(
  aggregate: MarketplaceAggregate,
  from: string,
): readonly MarketplaceStatusValue[] {
  const graph = aggregate === "buy_request" ? buyRequestGraph : sellSubmissionGraph;
  return (graph as Record<string, readonly MarketplaceStatusValue[]>)[from] ?? [];
}

export function canTransitionMarketplace(aggregate: MarketplaceAggregate, from: string, to: string) {
  return (marketplaceGraphTargets(aggregate, from) as readonly string[]).includes(to);
}

export type MarketplaceTransitionKind =
  | "invalid"
  /** Everyday queue work: ANALYST and above. */
  | "ordinary"
  /** `spam` or `closed`: ADMIN only. */
  | "exceptional"
  /** `pending_verification -> verified`: ADMIN only, audited distinctly. */
  | "manual_verification";

export function marketplaceTransitionKind(
  aggregate: MarketplaceAggregate,
  from: string,
  to: string,
): MarketplaceTransitionKind {
  if (!canTransitionMarketplace(aggregate, from, to)) return "invalid";
  if (from === "pending_verification" && to === "verified") return "manual_verification";
  if ((marketplaceExceptionalTargets as readonly string[]).includes(to)) return "exceptional";
  return "ordinary";
}

/** The capability a caller must hold, or `null` when the transition is invalid. */
export function marketplaceTransitionCapability(
  aggregate: MarketplaceAggregate,
  from: string,
  to: string,
) {
  const kind = marketplaceTransitionKind(aggregate, from, to);
  if (kind === "invalid") return null;
  if (kind === "ordinary") return "transition_marketplace" as const;
  return "exceptional_marketplace_transition" as const;
}

/**
 * The targets a role may actually choose, which is what the detail page renders.
 * `roleCan` is injected rather than imported so this module stays free of the
 * admin auth layer and can be exercised without it.
 */
export function allowedMarketplaceTransitions(
  aggregate: MarketplaceAggregate,
  from: string,
  role: string,
  roleCan: (role: string, capability: string) => boolean,
): readonly MarketplaceStatusValue[] {
  return marketplaceGraphTargets(aggregate, from).filter((to) => {
    const capability = marketplaceTransitionCapability(aggregate, from, to);
    return capability !== null && roleCan(role, capability);
  });
}

const auditActions: Record<MarketplaceAggregate, {
  status: string; spam: string; closed: string; withdrawn: string; manualVerification: string;
  assigned: string; noteAdded: string;
}> = {
  buy_request: {
    status: "BUY_REQUEST_STATUS_CHANGED",
    spam: "BUY_REQUEST_MARKED_SPAM",
    closed: "BUY_REQUEST_CLOSED",
    withdrawn: "BUY_REQUEST_WITHDRAWN",
    manualVerification: "BUY_REQUEST_VERIFICATION_MANUALLY_OVERRIDDEN",
    assigned: "BUY_REQUEST_ASSIGNED",
    noteAdded: "BUY_REQUEST_NOTE_ADDED",
  },
  sell_submission: {
    status: "SELL_SUBMISSION_STATUS_CHANGED",
    spam: "SELL_SUBMISSION_MARKED_SPAM",
    closed: "SELL_SUBMISSION_CLOSED",
    withdrawn: "SELL_SUBMISSION_WITHDRAWN",
    manualVerification: "SELL_SUBMISSION_VERIFICATION_MANUALLY_OVERRIDDEN",
    assigned: "SELL_SUBMISSION_ASSIGNED",
    noteAdded: "SELL_SUBMISSION_NOTE_ADDED",
  },
};

export function marketplaceAuditActions(aggregate: MarketplaceAggregate) {
  return auditActions[aggregate];
}

/** The audit action a given transition is recorded under. */
export function marketplaceTransitionAction(aggregate: MarketplaceAggregate, from: string, to: string) {
  const actions = auditActions[aggregate];
  if (marketplaceTransitionKind(aggregate, from, to) === "manual_verification") return actions.manualVerification;
  if (to === "spam") return actions.spam;
  if (to === "closed") return actions.closed;
  if (to === "withdrawn") return actions.withdrawn;
  return actions.status;
}
