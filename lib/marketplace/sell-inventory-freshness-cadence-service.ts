import "../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import {
  SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX,
  sellInventoryFreshnessCadenceOutcomes,
  type SellInventoryFreshnessCadenceOutcome,
} from "../../db/price-check/domain/sell-inventory-freshness.ts";
import { selectDueSellInventoryFreshnessSubmissions } from "../../db/price-check/repositories/sell-inventory-freshness-cadence-repository.ts";
import { requestAutomaticSellInventoryFreshness } from "./sell-inventory-freshness-request-service.ts";

/**
 * One pass of the bulk-inventory freshness cadence.
 *
 * The producer's whole job: find the records whose 45 days have elapsed, ask
 * each seller once, and say how many of each thing happened. It sends nothing
 * itself — each ask leaves a row in the shared outbox, and the existing
 * minute-by-minute notification worker delivers it through the handler that
 * already owns this message type. One workflow, one sender.
 *
 * What comes back, and what reaches a log line, is counts against a closed
 * vocabulary of reasons. Never a submission id, never a reference, never a
 * contact or an address, never a part, a quantity, a price, a location or a
 * filename, never a credential and never a URL. A scheduled function's output is
 * read by whoever can read deploy logs, which is not the same set of people who
 * may read a seller's record.
 */

export type SellInventoryFreshnessCadenceSummary = {
  /** How many due records the batch query returned. Never which ones. */
  scanned: number;
  /** How many checks — and therefore how many queued e-mails — were written. */
  issued: number;
  /**
   * How many of those asks first retired an expired credential to free the
   * record's index slot. A count, so operations can see the retirement path is
   * exercised without any record being named.
   */
  retired: number;
  /** Counts against the fixed outcome vocabulary. Zero-valued keys included. */
  outcomes: Record<SellInventoryFreshnessCadenceOutcome, number>;
};

export type SellInventoryFreshnessCadenceDependencies = {
  selectDue: typeof selectDueSellInventoryFreshnessSubmissions;
  issue: typeof requestAutomaticSellInventoryFreshness;
};

const defaultDependencies: SellInventoryFreshnessCadenceDependencies = {
  selectDue: selectDueSellInventoryFreshnessSubmissions,
  issue: requestAutomaticSellInventoryFreshness,
};

function emptyOutcomes(): Record<SellInventoryFreshnessCadenceOutcome, number> {
  return Object.fromEntries(
    sellInventoryFreshnessCadenceOutcomes.map((outcome) => [outcome, 0]),
  ) as Record<SellInventoryFreshnessCadenceOutcome, number>;
}

export async function runSellInventoryFreshnessCadence(
  db: PriceCheckDb,
  input: { now?: Date; limit?: number } = {},
  dependencies: SellInventoryFreshnessCadenceDependencies = defaultDependencies,
): Promise<SellInventoryFreshnessCadenceSummary> {
  const now = input.now ?? new Date();
  // The ceiling is the producer's own, not a caller's: a scheduled function that
  // could be asked for a larger batch would be a way to mail every seller at
  // once by editing one environment variable.
  const limit = Math.min(
    input.limit ?? SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX,
    SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX,
  );

  const due = await dependencies.selectDue(db, { now, limit });
  const outcomes = emptyOutcomes();
  let retired = 0;

  // Sequential, deliberately. Each record is one short transaction, and a
  // scheduled run has no deadline worth racing itself for; issuing in order also
  // means two runs that overlap divide the batch through `SKIP LOCKED` rather
  // than contending on every row at once.
  for (const sellSubmissionId of due) {
    const result = await dependencies.issue(db, { sellSubmissionId, now });
    outcomes[result.ok ? "issued" : result.reason] += 1;
    // The retired check's id is deliberately looked at and not kept: the summary
    // records that a retirement happened, never which credential it was.
    if (result.ok && result.retiredCheckId) retired += 1;
  }

  return { scanned: due.length, issued: outcomes.issued, retired, outcomes };
}
