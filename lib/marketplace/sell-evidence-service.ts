import "../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import {
  findLiveSellEvidenceRequest,
  redeemSellEvidenceRequest,
  type PreparedSellEvidenceAttachment,
  type SellEvidenceRequestSnapshot,
} from "../../db/price-check/repositories/sell-evidence-request-repository.ts";
import { MARKETPLACE_UPLOAD_MAX_FILES } from "./uploads/constants.ts";
import { hashSellEvidenceToken, isSellEvidenceToken } from "./sell-evidence-token.ts";

/**
 * The follow-up evidence workflow, between the public routes and the database.
 *
 * The split is the one the initial intake already uses and it exists for a hard
 * reason: every storage round trip happens *before* the transaction opens. An
 * S3 call inside a transaction holds row locks for the length of a network
 * call, and a storage timeout would then be a stuck transaction rather than a
 * failed request.
 *
 * The credential is checked twice, deliberately. A cheap read-only check runs
 * first so a forged or dead credential is refused before Civilon does any
 * storage work on its behalf; the authoritative check is the one inside
 * `redeemSellEvidenceRequest`, under a predicate that names the credential's own
 * unconsumed state. The first check is an optimisation and never a control.
 */

export type SellEvidencePreparer = (
  db: PriceCheckDb,
  input: { handles: string[]; uploadSessionToken: string | null | undefined },
) => Promise<PreparedSellEvidenceAttachment[]>;

async function defaultPrepareAttachments(
  db: PriceCheckDb,
  input: { handles: string[]; uploadSessionToken: string | null | undefined },
) {
  const [{ prepareMarketplaceAttachments }, session] = await Promise.all([
    import("./uploads/binding.ts"),
    import("./uploads/session.ts"),
  ]);
  const tokenHash = input.uploadSessionToken
    ? session.hashMarketplaceUploadSessionToken(
        session.marketplaceUploadSessionKey(),
        input.uploadSessionToken,
      )
    : null;
  return prepareMarketplaceAttachments(db, {
    handles: input.handles,
    uploadSessionToken: input.uploadSessionToken,
    tokenHash,
    // The same aggregate the initial intake uses. A session opened for the
    // other side of the marketplace can never be adopted here.
    intendedAggregateType: "sell_submission",
  });
}

export type SellEvidenceDependencies = {
  findLive: typeof findLiveSellEvidenceRequest;
  redeem: typeof redeemSellEvidenceRequest;
  prepareAttachments: SellEvidencePreparer;
};

const defaultDependencies: SellEvidenceDependencies = {
  findLive: findLiveSellEvidenceRequest,
  redeem: redeemSellEvidenceRequest,
  prepareAttachments: defaultPrepareAttachments,
};

/**
 * What the seller page may render for a credential, or null.
 *
 * Non-consuming by construction: opening the page must not spend a single-use
 * credential, because mail scanners and prefetchers follow emailed links.
 */
export async function viewSellEvidenceRequest(
  db: PriceCheckDb,
  input: { token: string; tokenKey: string; now?: Date },
  dependencies: SellEvidenceDependencies = defaultDependencies,
): Promise<SellEvidenceRequestSnapshot | null> {
  if (!isSellEvidenceToken(input.token)) return null;
  return dependencies.findLive(db, {
    keyedTokenHash: hashSellEvidenceToken(input.tokenKey, input.token),
    now: input.now,
  });
}

export type SellEvidenceSubmitResult =
  | { outcome: "bound"; reference: string; attachmentIds: string[] }
  | { outcome: "unavailable" };

/**
 * Binds requested evidence to the original Sell Submission.
 *
 * A follow-up submission must carry at least one fully uploaded file: the offer
 * itself is already recorded and needed no evidence, so an empty follow-up is a
 * mistake rather than a valid response. Everything else — forged, expired,
 * consumed, revoked, cross-session, cross-aggregate, unscanned, or one bad
 * handle in an otherwise good batch — reaches the caller as the same opaque
 * refusal, or as one of the storage/scan codes the caller already knows how to
 * translate for a seller looking at their own file.
 */
export async function submitSellEvidence(
  db: PriceCheckDb,
  input: {
    token: string;
    tokenKey: string;
    handles: readonly string[];
    uploadSessionToken?: string | null;
    now?: Date;
  },
  dependencies: SellEvidenceDependencies = defaultDependencies,
): Promise<SellEvidenceSubmitResult> {
  if (!isSellEvidenceToken(input.token)) return { outcome: "unavailable" };
  if (input.handles.length === 0 || input.handles.length > MARKETPLACE_UPLOAD_MAX_FILES) {
    return { outcome: "unavailable" };
  }

  const keyedTokenHash = hashSellEvidenceToken(input.tokenKey, input.token);
  // Cheap refusal before any storage work. Not the control — the redeem
  // transaction re-checks everything under its own predicate.
  const live = await dependencies.findLive(db, { keyedTokenHash, now: input.now });
  if (!live) return { outcome: "unavailable" };

  const attachments = await dependencies.prepareAttachments(db, {
    handles: [...input.handles],
    uploadSessionToken: input.uploadSessionToken,
  });

  // A purpose outside the request is refused here as well as in the
  // transaction. Cheaper, and it keeps the reason for the rule next to the
  // categories the seller was actually shown.
  const requested = new Set<string>(live.categories);
  if (attachments.some((attachment) => !requested.has(attachment.purpose))) {
    return { outcome: "unavailable" };
  }

  const result = await dependencies.redeem(db, {
    keyedTokenHash,
    attachments,
    now: input.now,
  });
  return result.outcome === "bound"
    ? { outcome: "bound", reference: result.reference, attachmentIds: result.attachmentIds }
    : { outcome: "unavailable" };
}
