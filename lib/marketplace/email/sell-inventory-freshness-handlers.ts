import "../../../db/price-check/server-boundary.ts";

import {
  SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE,
  SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
  loadSellInventoryFreshnessDelivery,
  markSellInventoryFreshnessNotificationSucceeded,
  recordSellInventoryFreshnessNotificationFailure,
} from "../../../db/price-check/repositories/sell-inventory-freshness-repository.ts";
import { PostmarkTransactionalEmailProvider } from "../../price-check/email/postmark.ts";
import type { TransactionalEmailProvider } from "../../price-check/email/provider.ts";
import type { NotificationHandler } from "../../notifications/types.ts";
import { getMarketplaceEmailFrom } from "../config.ts";
import {
  deriveSellInventoryFreshnessToken,
  sellInventoryFreshnessUrl,
} from "../sell-inventory-freshness-token.ts";
import { marketplaceOrigin, marketplaceVerifyTokenKey } from "../verification.ts";
import { sellInventoryFreshnessEmail } from "./sell-inventory-freshness-templates.ts";

function provider(supplied?: TransactionalEmailProvider): TransactionalEmailProvider {
  return supplied ?? new PostmarkTransactionalEmailProvider(process.env.POSTMARK_SERVER_TOKEN ?? "");
}

/**
 * The freshness check's claim on the shared outbox.
 *
 * The outbox row is keyed to the check, not to the Sell Submission, so a reissue
 * cannot cause an older queued message to go out carrying the newer check's
 * link. A superseded, answered or expired check refuses to load at all, so the
 * dispatcher retries and then dead-letters rather than emailing a seller a link
 * that is already dead.
 *
 * The credential is re-derived from the stored nonce at send time under the
 * freshness-specific HMAC label, so the plaintext token exists only inside this
 * function and the outgoing message. It is never stored, never logged, and never
 * returned to the staff member who asked for it.
 */
export const sellInventoryFreshnessNotificationHandler: NotificationHandler = {
  workflow: "marketplace",
  messageType: SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
  aggregateType: SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE,
  async deliver(db, message, context) {
    const delivery = await loadSellInventoryFreshnessDelivery(db, message.aggregateId, context.now);

    const token = deriveSellInventoryFreshnessToken(
      marketplaceVerifyTokenKey(),
      delivery.tokenDerivationNonce,
    );
    const sent = await provider(context.provider).send(
      sellInventoryFreshnessEmail({
        from: getMarketplaceEmailFrom(),
        to: delivery.businessEmail,
        reference: delivery.publicReference,
        availabilityUrl: sellInventoryFreshnessUrl(marketplaceOrigin(), token),
        expiresAt: delivery.expiresAt,
      }),
    );
    await markSellInventoryFreshnessNotificationSucceeded(db, {
      checkId: delivery.checkId,
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
    await recordSellInventoryFreshnessNotificationFailure(db, {
      checkId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      code: failure.code,
      deadLetter: failure.deadLetter,
      now: failure.now,
    });
  },
};
