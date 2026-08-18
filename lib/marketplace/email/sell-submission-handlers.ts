import "../../../db/price-check/server-boundary.ts";

import {
  SELL_SUBMISSION_AGGREGATE_TYPE,
  SELL_SUBMISSION_INTERNAL_MESSAGE_TYPE,
  SELL_SUBMISSION_VERIFY_MESSAGE_TYPE,
  loadSellSubmissionNotice,
  loadSellSubmissionVerification,
  markSellSubmissionNotificationSucceeded,
  recordSellSubmissionNotificationFailure,
} from "../../../db/price-check/repositories/sell-submission-repository.ts";
import { PostmarkTransactionalEmailProvider } from "../../price-check/email/postmark.ts";
import type { TransactionalEmailProvider } from "../../price-check/email/provider.ts";
import type { NotificationHandler } from "../../notifications/types.ts";
import { getMarketplaceEmailFrom, getMarketplaceInternalRecipients } from "../config.ts";
import {
  deriveSellVerificationToken,
  sellSubmissionAdminUrl,
  marketplaceOrigin,
  marketplaceVerifyTokenKey,
  sellSubmissionVerificationUrl,
} from "../verification.ts";
import {
  sellSubmissionInternalEmail,
  sellSubmissionVerifyEmail,
} from "./sell-submission-templates.ts";

function provider(supplied?: TransactionalEmailProvider): TransactionalEmailProvider {
  return supplied ?? new PostmarkTransactionalEmailProvider(process.env.POSTMARK_SERVER_TOKEN ?? "");
}

/**
 * Sell's claim on the shared outbox: the supplier verification mail.
 *
 * The credential is re-derived from the stored nonce at send time under the
 * Sell-specific HMAC label, so the plaintext token exists only inside this
 * function and the outgoing message. Delivery failures propagate to the shared
 * dispatcher, which retries with the existing backoff and lease fencing — the
 * Sell Submission itself is never touched.
 */
export const sellSubmissionVerifyNotificationHandler: NotificationHandler = {
  workflow: "marketplace",
  messageType: SELL_SUBMISSION_VERIFY_MESSAGE_TYPE,
  aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
  async deliver(db, message, context) {
    const delivery = await loadSellSubmissionVerification(db, message.aggregateId);
    const token = deriveSellVerificationToken(
      marketplaceVerifyTokenKey(),
      delivery.tokenDerivationNonce,
    );
    const sent = await provider(context.provider).send(
      sellSubmissionVerifyEmail({
        from: getMarketplaceEmailFrom(),
        to: delivery.businessEmail,
        reference: delivery.publicReference,
        verificationUrl: sellSubmissionVerificationUrl(marketplaceOrigin(), token),
        expiresAt: delivery.expiresAt,
      }),
    );
    await markSellSubmissionNotificationSucceeded(db, {
      sellSubmissionId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      leaseOwner: context.leaseOwner,
      providerMessageId: sent.providerMessageId,
      now: context.now,
    });
    return { providerMessageId: sent.providerMessageId };
  },
  async recordFailure(db, message, failure) {
    await recordSellSubmissionNotificationFailure(db, {
      sellSubmissionId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      code: failure.code,
      deadLetter: failure.deadLetter,
      now: failure.now,
    });
  },
};

/**
 * Sell's second claim: the internal new-submission notice.
 *
 * Recipients come from the approved internal routing list, and the message body
 * is a reference, a status and a signed-in console link. Staff awareness of a
 * Sell Submission therefore never depends on this mail succeeding — the
 * submission and its audit trail are already committed before the message is
 * eligible to send — and a supplier's stock, price and location never fan out
 * to three mailboxes.
 */
export const sellSubmissionInternalNotificationHandler: NotificationHandler = {
  workflow: "marketplace",
  messageType: SELL_SUBMISSION_INTERNAL_MESSAGE_TYPE,
  aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
  async deliver(db, message, context) {
    const notice = await loadSellSubmissionNotice(db, message.aggregateId);
    const sent = await provider(context.provider).send(
      sellSubmissionInternalEmail({
        from: getMarketplaceEmailFrom(),
        to: getMarketplaceInternalRecipients().join(", "),
        reference: notice.publicReference,
        status: notice.status,
        submittedAt: notice.submittedAt,
        adminUrl: sellSubmissionAdminUrl(marketplaceOrigin(), notice.id),
      }),
    );
    await markSellSubmissionNotificationSucceeded(db, {
      sellSubmissionId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      leaseOwner: context.leaseOwner,
      providerMessageId: sent.providerMessageId,
      now: context.now,
    });
    return { providerMessageId: sent.providerMessageId };
  },
  async recordFailure(db, message, failure) {
    await recordSellSubmissionNotificationFailure(db, {
      sellSubmissionId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      code: failure.code,
      deadLetter: failure.deadLetter,
      now: failure.now,
    });
  },
};

export const sellSubmissionNotificationHandlers = [
  sellSubmissionVerifyNotificationHandler,
  sellSubmissionInternalNotificationHandler,
] as const;
