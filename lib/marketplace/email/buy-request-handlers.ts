import "../../../db/price-check/server-boundary.ts";

import {
  BUY_REQUEST_AGGREGATE_TYPE,
  BUY_REQUEST_INTERNAL_MESSAGE_TYPE,
  BUY_REQUEST_VERIFY_MESSAGE_TYPE,
  loadBuyRequestNotice,
  loadBuyRequestVerification,
  markBuyRequestNotificationSucceeded,
  recordBuyRequestNotificationFailure,
} from "../../../db/price-check/repositories/buy-request-repository.ts";
import { PostmarkTransactionalEmailProvider } from "../../price-check/email/postmark.ts";
import type { TransactionalEmailProvider } from "../../price-check/email/provider.ts";
import type { NotificationHandler } from "../../notifications/types.ts";
import { getMarketplaceEmailFrom, getMarketplaceInternalRecipients } from "../config.ts";
import {
  buyRequestAdminUrl,
  buyRequestVerificationUrl,
  deriveVerificationToken,
  marketplaceOrigin,
  marketplaceVerifyTokenKey,
} from "../verification.ts";
import { buyRequestInternalEmail, buyRequestVerifyEmail } from "./buy-request-templates.ts";

function provider(supplied?: TransactionalEmailProvider): TransactionalEmailProvider {
  return supplied ?? new PostmarkTransactionalEmailProvider(process.env.POSTMARK_SERVER_TOKEN ?? "");
}

/**
 * Marketplace's claim on the shared outbox: the customer verification mail.
 *
 * The credential is re-derived from the stored nonce at send time, so the
 * plaintext token exists only inside this function and the outgoing message.
 * Delivery failures propagate to the shared dispatcher, which retries with the
 * existing backoff and lease fencing — the Buy Request itself is never touched.
 */
export const buyRequestVerifyNotificationHandler: NotificationHandler = {
  workflow: "marketplace",
  messageType: BUY_REQUEST_VERIFY_MESSAGE_TYPE,
  aggregateType: BUY_REQUEST_AGGREGATE_TYPE,
  async deliver(db, message, context) {
    const delivery = await loadBuyRequestVerification(db, message.aggregateId);
    const token = deriveVerificationToken(
      marketplaceVerifyTokenKey(),
      delivery.tokenDerivationNonce,
    );
    const sent = await provider(context.provider).send(
      buyRequestVerifyEmail({
        from: getMarketplaceEmailFrom(),
        to: delivery.businessEmail,
        reference: delivery.publicReference,
        verificationUrl: buyRequestVerificationUrl(marketplaceOrigin(), token),
        expiresAt: delivery.expiresAt,
      }),
    );
    await markBuyRequestNotificationSucceeded(db, {
      buyRequestId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      leaseOwner: context.leaseOwner,
      providerMessageId: sent.providerMessageId,
      now: context.now,
    });
    return { providerMessageId: sent.providerMessageId };
  },
  async recordFailure(db, message, failure) {
    await recordBuyRequestNotificationFailure(db, {
      buyRequestId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      code: failure.code,
      deadLetter: failure.deadLetter,
      now: failure.now,
    });
  },
};

/**
 * Marketplace's second claim: the internal new-request notice.
 *
 * Recipients come from the approved internal routing list, and the message body
 * is a reference, a status and a signed-in console link. Staff awareness of a
 * Buy Request therefore never depends on this mail succeeding — the request and
 * its audit trail are already committed before the message is eligible to send.
 */
export const buyRequestInternalNotificationHandler: NotificationHandler = {
  workflow: "marketplace",
  messageType: BUY_REQUEST_INTERNAL_MESSAGE_TYPE,
  aggregateType: BUY_REQUEST_AGGREGATE_TYPE,
  async deliver(db, message, context) {
    const notice = await loadBuyRequestNotice(db, message.aggregateId);
    const sent = await provider(context.provider).send(
      buyRequestInternalEmail({
        from: getMarketplaceEmailFrom(),
        to: getMarketplaceInternalRecipients().join(", "),
        reference: notice.publicReference,
        status: notice.status,
        submittedAt: notice.submittedAt,
        adminUrl: buyRequestAdminUrl(marketplaceOrigin(), notice.id),
      }),
    );
    await markBuyRequestNotificationSucceeded(db, {
      buyRequestId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      leaseOwner: context.leaseOwner,
      providerMessageId: sent.providerMessageId,
      now: context.now,
    });
    return { providerMessageId: sent.providerMessageId };
  },
  async recordFailure(db, message, failure) {
    await recordBuyRequestNotificationFailure(db, {
      buyRequestId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      code: failure.code,
      deadLetter: failure.deadLetter,
      now: failure.now,
    });
  },
};

export const buyRequestNotificationHandlers = [
  buyRequestVerifyNotificationHandler,
  buyRequestInternalNotificationHandler,
] as const;
