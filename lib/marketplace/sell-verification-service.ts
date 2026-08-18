import "../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import {
  redeemSellSubmissionVerification,
  type SellSubmissionVerificationOutcome,
} from "../../db/price-check/repositories/sell-submission-repository.ts";
import {
  hashVerificationToken,
  isVerificationToken,
  marketplaceVerifyTokenKey,
} from "./verification.ts";

type VerificationDependencies = {
  redeem: typeof redeemSellSubmissionVerification;
  tokenKey: () => string;
};

const defaultDependencies: VerificationDependencies = {
  redeem: redeemSellSubmissionVerification,
  tokenKey: () => marketplaceVerifyTokenKey(),
};

/**
 * Turns a presented credential into a Sell Submission activation.
 *
 * A malformed credential is rejected before any query runs, so a scanner cannot
 * use response timing or database load to distinguish "wrong shape" from
 * "unknown token". Everything else collapses into the repository's single
 * opaque `unavailable`, including a well-formed Buy Request credential: it
 * hashes into the shared lookup namespace but never joins a Sell Submission.
 */
export async function verifySellSubmissionContact(
  db: PriceCheckDb,
  input: { token: unknown; now?: Date },
  dependencies: VerificationDependencies = defaultDependencies,
): Promise<SellSubmissionVerificationOutcome> {
  if (!isVerificationToken(input.token)) return { outcome: "unavailable" };
  const keyedTokenHash = hashVerificationToken(dependencies.tokenKey(), input.token);
  return dependencies.redeem(db, { keyedTokenHash, now: input.now });
}
