import "../../../db/price-check/server-boundary.ts";

import { isSellEvidenceRequestCategory } from "../../../db/price-check/domain/sell-evidence-request.ts";
import {
  SELL_EVIDENCE_REQUEST_AGGREGATE_TYPE,
  SELL_EVIDENCE_REQUEST_MESSAGE_TYPE,
  loadSellEvidenceRequestDelivery,
  markSellEvidenceNotificationSucceeded,
  recordSellEvidenceNotificationFailure,
} from "../../../db/price-check/repositories/sell-evidence-request-repository.ts";
import { PostmarkTransactionalEmailProvider } from "../../price-check/email/postmark.ts";
import type { TransactionalEmailProvider } from "../../price-check/email/provider.ts";
import type { NotificationHandler } from "../../notifications/types.ts";
import { getMarketplaceEmailFrom } from "../config.ts";
import { deriveSellEvidenceToken, sellEvidenceUrl } from "../sell-evidence-token.ts";
import { marketplaceOrigin, marketplaceVerifyTokenKey } from "../verification.ts";
import { sellEvidenceRequestEmail } from "./sell-evidence-templates.ts";

function provider(supplied?: TransactionalEmailProvider): TransactionalEmailProvider {
  return supplied ?? new PostmarkTransactionalEmailProvider(process.env.POSTMARK_SERVER_TOKEN ?? "");
}

/**
 * The follow-up evidence request's claim on the shared outbox.
 *
 * The outbox row is keyed to the evidence request, not to the Sell Submission,
 * so a reissue cannot cause an older queued message to go out carrying the
 * newer request's link and the older request's category list. A superseded,
 * used or expired request refuses to load at all, so the dispatcher retries and
 * then dead-letters rather than emailing a seller a link that is already dead.
 *
 * The credential is re-derived from the stored nonce at send time under the
 * evidence-specific HMAC label, so the plaintext token exists only inside this
 * function and the outgoing message. It is never stored, never logged, and
 * never returned to the staff member who asked for it.
 */
export const sellEvidenceRequestNotificationHandler: NotificationHandler = {
  workflow: "marketplace",
  messageType: SELL_EVIDENCE_REQUEST_MESSAGE_TYPE,
  aggregateType: SELL_EVIDENCE_REQUEST_AGGREGATE_TYPE,
  async deliver(db, message, context) {
    const delivery = await loadSellEvidenceRequestDelivery(db, message.aggregateId, context.now);
    const categories = delivery.requestedCategories.filter(isSellEvidenceRequestCategory);
    if (categories.length === 0) throw new Error("SELL_EVIDENCE_REQUEST_UNAVAILABLE");

    const token = deriveSellEvidenceToken(
      marketplaceVerifyTokenKey(),
      delivery.tokenDerivationNonce,
    );
    const sent = await provider(context.provider).send(
      sellEvidenceRequestEmail({
        from: getMarketplaceEmailFrom(),
        to: delivery.businessEmail,
        reference: delivery.publicReference,
        categories,
        evidenceUrl: sellEvidenceUrl(marketplaceOrigin(), token),
        expiresAt: delivery.expiresAt,
      }),
    );
    await markSellEvidenceNotificationSucceeded(db, {
      evidenceRequestId: delivery.evidenceRequestId,
      sellSubmissionId: delivery.sellSubmissionId,
      notificationId: message.id,
      messageType: message.messageType,
      leaseOwner: context.leaseOwner,
      providerMessageId: sent.providerMessageId,
      now: context.now,
    });
    return { providerMessageId: sent.providerMessageId };
  },
  async recordFailure(db, message, failure) {
    await recordSellEvidenceNotificationFailure(db, {
      evidenceRequestId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      code: failure.code,
      deadLetter: failure.deadLetter,
      now: failure.now,
    });
  },
};
