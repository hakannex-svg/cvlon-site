import "../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import {
  redeemBuyRequestVerification,
  type BuyRequestVerificationOutcome,
} from "../../db/price-check/repositories/buy-request-repository.ts";
import {
  hashVerificationToken,
  isVerificationToken,
  marketplaceVerifyTokenKey,
} from "./verification.ts";

type VerificationDependencies = {
  redeem: typeof redeemBuyRequestVerification;
  tokenKey: () => string;
};

const defaultDependencies: VerificationDependencies = {
  redeem: redeemBuyRequestVerification,
  tokenKey: () => marketplaceVerifyTokenKey(),
};

/**
 * Turns a presented credential into an activation.
 *
 * A malformed credential is rejected before any query runs, so a scanner cannot
 * use response timing or database load to distinguish "wrong shape" from
 * "unknown token". Everything else collapses into the repository's single
 * opaque `unavailable`.
 */
export async function verifyBuyRequestContact(
  db: PriceCheckDb,
  input: { token: unknown; now?: Date },
  dependencies: VerificationDependencies = defaultDependencies,
): Promise<BuyRequestVerificationOutcome> {
  if (!isVerificationToken(input.token)) return { outcome: "unavailable" };
  const keyedTokenHash = hashVerificationToken(dependencies.tokenKey(), input.token);
  return dependencies.redeem(db, { keyedTokenHash, now: input.now });
}
