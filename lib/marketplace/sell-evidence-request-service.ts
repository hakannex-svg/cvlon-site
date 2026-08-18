import "../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import type { SellEvidenceRequestCategory } from "../../db/price-check/domain/sell-evidence-request.ts";
import {
  issueSellEvidenceRequest,
  type IssueSellEvidenceRequestOutcome,
} from "../../db/price-check/repositories/sell-evidence-request-repository.ts";
import {
  SELL_EVIDENCE_TOKEN_TTL_MS,
  deriveSellEvidenceToken,
  hashSellEvidenceToken,
  newSellEvidenceNonce,
} from "./sell-evidence-token.ts";
import { marketplaceVerifyTokenKey } from "./verification.ts";

/**
 * Mints one follow-up evidence credential and hands the database only its keyed
 * hash and derivation nonce.
 *
 * The plaintext token is derived here, used to compute the lookup hash, and
 * then goes out of scope. It is never stored, never logged, never returned to
 * the caller, and never crosses the admin HTTP boundary — the e-mail handler
 * re-derives it from the stored nonce at send time, which is the same shape the
 * verification credential already uses.
 *
 * This module exists as a separate layer for exactly that reason: the route
 * cannot accidentally return a value it is never given.
 */

export type RequestSellEvidenceDependencies = {
  issue: typeof issueSellEvidenceRequest;
  tokenKey: () => string;
  newNonce: typeof newSellEvidenceNonce;
};

const defaultDependencies: RequestSellEvidenceDependencies = {
  issue: issueSellEvidenceRequest,
  tokenKey: () => marketplaceVerifyTokenKey(),
  newNonce: newSellEvidenceNonce,
};

export async function requestSellEvidence(
  db: PriceCheckDb,
  input: {
    sellSubmissionId: string;
    categories: readonly SellEvidenceRequestCategory[];
    actor: { id: string };
    now?: Date;
  },
  dependencies: RequestSellEvidenceDependencies = defaultDependencies,
): Promise<IssueSellEvidenceRequestOutcome> {
  const now = input.now ?? new Date();
  const key = dependencies.tokenKey();
  const nonce = dependencies.newNonce();
  const keyedTokenHash = hashSellEvidenceToken(key, deriveSellEvidenceToken(key, nonce));

  return dependencies.issue(db, {
    sellSubmissionId: input.sellSubmissionId,
    categories: input.categories,
    keyedTokenHash,
    tokenDerivationNonce: nonce,
    expiresAt: new Date(now.valueOf() + SELL_EVIDENCE_TOKEN_TTL_MS),
    actor: input.actor,
    now,
  });
}
