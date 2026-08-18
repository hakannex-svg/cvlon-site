import "../../../db/price-check/server-boundary.ts";

import { loadResultDelivery, markResultDeliverySucceeded, recordResultDeliveryFailure } from "../../../db/price-check/repositories/result-delivery-repository.ts";
import type { NotificationHandler } from "../../notifications/types.ts";
import { PostmarkTransactionalEmailProvider } from "./postmark.ts";
import { resultReadyEmail } from "./result-ready.ts";

export function deliveryOrigin() {
  const candidate = process.env.DEPLOY_PRIME_URL || process.env.URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  const url = new URL(candidate);
  if (url.protocol !== "https:" || !(url.hostname === "cvlon.com" || url.hostname.endsWith("--cvlon.netlify.app"))) throw new Error("RESULT_ORIGIN_INVALID");
  return url.origin;
}

/** Price Check's claim on the shared outbox. Owns only RESULT_READY. */
export const resultReadyNotificationHandler: NotificationHandler = {
  workflow: "price-check",
  messageType: "RESULT_READY",
  aggregateType: "price_check_result",
  async deliver(db, message, context) {
    const tokenKey = process.env.PRICE_CHECK_RESULT_TOKEN_KEY ?? "";
    const delivery = await loadResultDelivery(db, message.aggregateId, tokenKey, deliveryOrigin());
    const provider = context.provider ?? new PostmarkTransactionalEmailProvider(process.env.POSTMARK_SERVER_TOKEN ?? "");
    const email = resultReadyEmail({
      from: process.env.PRICE_CHECK_EMAIL_FROM || "Civilon Price Check <pricecheck@cvlon.com>",
      to: delivery.requester.businessEmail,
      reference: delivery.priceCheck.publicReference,
      secureUrl: delivery.secureUrl,
      expiresAt: delivery.token.expiresAt,
    });
    const sent = await provider.send(email);
    await markResultDeliverySucceeded(db, {
      resultId: message.aggregateId,
      notificationId: message.id,
      leaseOwner: context.leaseOwner,
      providerMessageId: sent.providerMessageId,
      now: context.now,
    });
    return { providerMessageId: sent.providerMessageId };
  },
  async recordFailure(db, message, failure) {
    await recordResultDeliveryFailure(db, message.aggregateId, failure.code, failure.deadLetter);
  },
};
