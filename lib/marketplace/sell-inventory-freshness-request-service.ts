import "../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import {
  issueSellInventoryFreshnessCheck,
  type IssueSellInventoryFreshnessCheckOutcome,
} from "../../db/price-check/repositories/sell-inventory-freshness-repository.ts";
import {
  issueAutomaticSellInventoryFreshnessCheck,
  type IssueAutomaticSellInventoryFreshnessCheckOutcome,
} from "../../db/price-check/repositories/sell-inventory-freshness-cadence-repository.ts";
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

/**
 * Mints one credential and returns only what a repository may be told about it.
 *
 * Shared by the staff-issued path and the scheduled one so there is exactly one
 * derivation, one 14-day expiry and one place where a plaintext token exists.
 * The token is derived, hashed, and dropped inside this function: the caller is
 * handed a keyed hash, a nonce and an expiry, and can therefore never return,
 * log or store the credential it never received.
 */
function mintSellInventoryFreshnessCredential(
  dependencies: { tokenKey: () => string; newNonce: typeof newSellInventoryFreshnessNonce },
  now: Date,
) {
  const key = dependencies.tokenKey();
  const nonce = dependencies.newNonce();
  const keyedTokenHash = hashSellInventoryFreshnessToken(
    key,
    deriveSellInventoryFreshnessToken(key, nonce),
  );
  return {
    keyedTokenHash,
    tokenDerivationNonce: nonce,
    expiresAt: new Date(now.valueOf() + SELL_INVENTORY_FRESHNESS_TOKEN_TTL_MS),
  };
}

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
  const credential = mintSellInventoryFreshnessCredential(dependencies, now);

  return dependencies.issue(db, {
    sellSubmissionId: input.sellSubmissionId,
    ...credential,
    actor: input.actor,
    now,
  });
}

export type RequestAutomaticSellInventoryFreshnessDependencies = {
  issue: typeof issueAutomaticSellInventoryFreshnessCheck;
  tokenKey: () => string;
  newNonce: typeof newSellInventoryFreshnessNonce;
};

const defaultAutomaticDependencies: RequestAutomaticSellInventoryFreshnessDependencies = {
  issue: issueAutomaticSellInventoryFreshnessCheck,
  tokenKey: () => marketplaceVerifyTokenKey(),
  newNonce: newSellInventoryFreshnessNonce,
};

/**
 * The same credential, for the check nobody asked for.
 *
 * A sibling rather than a flag on the manual function: there is no actor, the
 * repository it calls is the insert-only one, and every refusal it can return is
 * a cadence category rather than a staff-facing eligibility message. Sharing the
 * minting is the whole of what the two paths have in common, and that is exactly
 * what is shared.
 */
export async function requestAutomaticSellInventoryFreshness(
  db: PriceCheckDb,
  input: { sellSubmissionId: string; now?: Date },
  dependencies: RequestAutomaticSellInventoryFreshnessDependencies = defaultAutomaticDependencies,
): Promise<IssueAutomaticSellInventoryFreshnessCheckOutcome> {
  const now = input.now ?? new Date();
  const credential = mintSellInventoryFreshnessCredential(dependencies, now);

  return dependencies.issue(db, {
    sellSubmissionId: input.sellSubmissionId,
    ...credential,
    now,
  });
}
