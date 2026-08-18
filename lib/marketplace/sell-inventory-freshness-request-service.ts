import "../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import {
  issueSellInventoryFreshnessCheck,
  type IssueSellInventoryFreshnessCheckOutcome,
} from "../../db/price-check/repositories/sell-inventory-freshness-repository.ts";
import {
  SELL_INVENTORY_FRESHNESS_TOKEN_TTL_MS,
  deriveSellInventoryFreshnessToken,
  hashSellInventoryFreshnessToken,
  newSellInventoryFreshnessNonce,
} from "./sell-inventory-freshness-token.ts";
import { marketplaceVerifyTokenKey } from "./verification.ts";

/**
 * Mints one freshness credential and hands the database only its keyed hash and
 * derivation nonce.
 *
 * The plaintext token is derived here, used to compute the lookup hash, and then
 * goes out of scope. It is never stored, never logged, never returned to the
 * caller, and never crosses the admin HTTP boundary — the e-mail handler
 * re-derives it from the stored nonce at send time, which is the same shape the
 * verification and evidence credentials already use.
 *
 * This module exists as a separate layer for exactly that reason: the route
 * cannot accidentally return a value it is never given.
 */

export type RequestSellInventoryFreshnessDependencies = {
  issue: typeof issueSellInventoryFreshnessCheck;
  tokenKey: () => string;
  newNonce: typeof newSellInventoryFreshnessNonce;
};

const defaultDependencies: RequestSellInventoryFreshnessDependencies = {
  issue: issueSellInventoryFreshnessCheck,
  tokenKey: () => marketplaceVerifyTokenKey(),
  newNonce: newSellInventoryFreshnessNonce,
};

export async function requestSellInventoryFreshness(
  db: PriceCheckDb,
  input: {
    sellSubmissionId: string;
    actor: { id: string };
    now?: Date;
  },
  dependencies: RequestSellInventoryFreshnessDependencies = defaultDependencies,
): Promise<IssueSellInventoryFreshnessCheckOutcome> {
  const now = input.now ?? new Date();
  const key = dependencies.tokenKey();
  const nonce = dependencies.newNonce();
  const keyedTokenHash = hashSellInventoryFreshnessToken(
    key,
    deriveSellInventoryFreshnessToken(key, nonce),
  );

  return dependencies.issue(db, {
    sellSubmissionId: input.sellSubmissionId,
    keyedTokenHash,
    tokenDerivationNonce: nonce,
    expiresAt: new Date(now.valueOf() + SELL_INVENTORY_FRESHNESS_TOKEN_TTL_MS),
    actor: input.actor,
    now,
  });
}
