import "../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import {
  isSellInventoryFreshnessResponse,
  type SellInventoryFreshnessResponse,
} from "../../db/price-check/domain/sell-inventory-freshness.ts";
import {
  findLiveSellInventoryFreshnessCheck,
  recordSellInventoryFreshnessResponse,
  type SellInventoryFreshnessSnapshot,
} from "../../db/price-check/repositories/sell-inventory-freshness-repository.ts";
import {
  hashSellInventoryFreshnessToken,
  isSellInventoryFreshnessToken,
} from "./sell-inventory-freshness-token.ts";

/**
 * The bulk-inventory freshness workflow, between the public routes and the
 * database.
 *
 * Thinner than the evidence service because there is no storage in this path at
 * all: no upload, no scan, no S3 round trip, nothing to prepare before the
 * transaction opens. The whole workflow is one credential and one of three
 * words, which is exactly why it can be answered from a phone in a warehouse.
 *
 * The credential is checked twice, deliberately. A cheap read-only check runs
 * first so a forged or dead credential is refused before Civilon opens a
 * transaction on its behalf; the authoritative check is the one inside
 * `recordSellInventoryFreshnessResponse`, under a predicate that names the
 * credential's own unanswered state. The first check is an optimisation and
 * never a control.
 */

export type SellInventoryFreshnessDependencies = {
  findLive: typeof findLiveSellInventoryFreshnessCheck;
  respond: typeof recordSellInventoryFreshnessResponse;
};

const defaultDependencies: SellInventoryFreshnessDependencies = {
  findLive: findLiveSellInventoryFreshnessCheck,
  respond: recordSellInventoryFreshnessResponse,
};

/**
 * What the seller page may render for a credential, or null.
 *
 * Non-consuming by construction: opening the page must not spend a single-use
 * credential, because mail scanners and prefetchers follow emailed links. It
 * also records nothing — viewing is not answering, and a seller who opens the
 * link and closes it has made no statement about their inventory.
 */
export async function viewSellInventoryFreshnessCheck(
  db: PriceCheckDb,
  input: { token: string; tokenKey: string; now?: Date },
  dependencies: SellInventoryFreshnessDependencies = defaultDependencies,
): Promise<SellInventoryFreshnessSnapshot | null> {
  if (!isSellInventoryFreshnessToken(input.token)) return null;
  return dependencies.findLive(db, {
    keyedTokenHash: hashSellInventoryFreshnessToken(input.tokenKey, input.token),
    now: input.now,
  });
}

export type SellInventoryFreshnessRespondResult =
  | { outcome: "recorded" }
  | { outcome: "unavailable" };

/**
 * Records the seller's answer.
 *
 * Everything else — forged, expired, answered, revoked, replayed, attempt
 * exhausted, or naming a record Civilon no longer asks about — reaches the
 * caller as the same opaque refusal. The reference is deliberately not returned:
 * the seller already has it, and echoing it would make this endpoint a way to
 * test whether a guessed credential belongs to a real submission.
 */
export async function respondToSellInventoryFreshnessCheck(
  db: PriceCheckDb,
  input: {
    token: string;
    tokenKey: string;
    response: SellInventoryFreshnessResponse;
    now?: Date;
  },
  dependencies: SellInventoryFreshnessDependencies = defaultDependencies,
): Promise<SellInventoryFreshnessRespondResult> {
  if (!isSellInventoryFreshnessToken(input.token)) return { outcome: "unavailable" };
  if (!isSellInventoryFreshnessResponse(input.response)) return { outcome: "unavailable" };

  const keyedTokenHash = hashSellInventoryFreshnessToken(input.tokenKey, input.token);
  // Cheap refusal before a transaction is opened. Not the control — the respond
  // transaction re-checks everything under its own predicate.
  const live = await dependencies.findLive(db, { keyedTokenHash, now: input.now });
  if (!live) return { outcome: "unavailable" };

  const result = await dependencies.respond(db, {
    keyedTokenHash,
    response: input.response,
    now: input.now,
  });
  return result.outcome === "recorded" ? { outcome: "recorded" } : { outcome: "unavailable" };
}
