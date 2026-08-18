import "../../../db/price-check/server-boundary.ts";

import {
  loadBuyerOfferCustomerRecord,
  loadBuyerOfferResponseNotice,
  markBuyerOfferNotificationSucceeded,
  recordBuyerOfferNotificationFailure,
} from "../../../db/price-check/repositories/buyer-offer-repository.ts";
import {
  BUYER_OFFER_AGGREGATE_TYPE,
  BUYER_OFFER_DELIVERY_MESSAGE_TYPE,
  BUYER_OFFER_RESPONSE_MESSAGE_TYPE,
} from "../../../db/price-check/domain/buyer-offer-policy.ts";
import type { NotificationHandler } from "../../notifications/types.ts";
import { PostmarkTransactionalEmailProvider } from "../../price-check/email/postmark.ts";
import type { TransactionalEmailProvider } from "../../price-check/email/provider.ts";
import { getMarketplaceEmailFrom, getMarketplaceInternalRecipients } from "../config.ts";
import { buildBuyerOfferSnapshot } from "../buyer-offer-snapshot.ts";
import { buyerOfferUrl, deriveBuyerOfferToken } from "../buyer-offer-token.ts";
import { marketplaceOrigin, marketplaceVerifyTokenKey, buyRequestAdminUrl } from "../verification.ts";
import { buyerOfferCustomerEmail, buyerOfferResponseInternalEmail } from "./buyer-offer-templates.ts";

function provider(supplied?: TransactionalEmailProvider) {
  return supplied ?? new PostmarkTransactionalEmailProvider(process.env.POSTMARK_SERVER_TOKEN ?? "");
}

export const buyerOfferDeliveryNotificationHandler: NotificationHandler = {
  workflow: "marketplace",
  messageType: BUYER_OFFER_DELIVERY_MESSAGE_TYPE,
  aggregateType: BUYER_OFFER_AGGREGATE_TYPE,
  async deliver(db, message, context) {
    const record = await loadBuyerOfferCustomerRecord(db, message.aggregateId, context.now);
    if (!record) throw new Error("BUYER_OFFER_DELIVERY_UNAVAILABLE");
    const offer = buildBuyerOfferSnapshot({
      reference: record.reference,
      version: record.version,
      saleUnitPrice: record.civilonSaleUnitPrice,
      currencyCode: record.currencyCode,
      quantity: record.quantity,
      statedCondition: record.statedCondition,
      documentsSummary: record.documentsSummary,
      deliveryOption: record.deliveryOption,
      shippingAndExportScope: record.shippingAndExportScope,
      leadTimeDays: record.leadTimeDays,
      expiresAt: record.expiresAt,
    });
    const token = deriveBuyerOfferToken(marketplaceVerifyTokenKey(), {
      buyerOfferId: record.buyerOfferId,
      version: record.version,
      sentAt: record.sentAt,
      expiresAt: record.expiresAt,
    });
    const sent = await provider(context.provider).send(buyerOfferCustomerEmail({
      from: getMarketplaceEmailFrom(),
      to: record.businessEmail,
      offer,
      responseUrl: buyerOfferUrl(marketplaceOrigin(), token),
    }));
    await markBuyerOfferNotificationSucceeded(db, {
      buyerOfferId: record.buyerOfferId,
      notificationId: message.id,
      messageType: message.messageType,
      leaseOwner: context.leaseOwner,
      providerMessageId: sent.providerMessageId,
      now: context.now,
    });
    return { providerMessageId: sent.providerMessageId };
  },
  async recordFailure(db, message, failure) {
    await recordBuyerOfferNotificationFailure(db, {
      buyerOfferId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      code: failure.code,
      deadLetter: failure.deadLetter,
      now: failure.now,
    });
  },
};

export const buyerOfferResponseNotificationHandler: NotificationHandler = {
  workflow: "marketplace",
  messageType: BUYER_OFFER_RESPONSE_MESSAGE_TYPE,
  aggregateType: BUYER_OFFER_AGGREGATE_TYPE,
  async deliver(db, message, context) {
    const notice = await loadBuyerOfferResponseNotice(db, message.aggregateId);
    const sent = await provider(context.provider).send(buyerOfferResponseInternalEmail({
      from: getMarketplaceEmailFrom(),
      to: getMarketplaceInternalRecipients().join(", "),
      reference: notice.reference,
      version: notice.version,
      decision: notice.status,
      respondedAt: notice.respondedAt,
      adminUrl: buyRequestAdminUrl(marketplaceOrigin(), notice.buyRequestId),
    }));
    await markBuyerOfferNotificationSucceeded(db, {
      buyerOfferId: notice.buyerOfferId,
      notificationId: message.id,
      messageType: message.messageType,
      leaseOwner: context.leaseOwner,
      providerMessageId: sent.providerMessageId,
      now: context.now,
    });
    return { providerMessageId: sent.providerMessageId };
  },
  async recordFailure(db, message, failure) {
    await recordBuyerOfferNotificationFailure(db, {
      buyerOfferId: message.aggregateId,
      notificationId: message.id,
      messageType: message.messageType,
      code: failure.code,
      deadLetter: failure.deadLetter,
      now: failure.now,
    });
  },
};

export const buyerOfferNotificationHandlers = [
  buyerOfferDeliveryNotificationHandler,
  buyerOfferResponseNotificationHandler,
] as const;
