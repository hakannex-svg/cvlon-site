import "../../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../../db/price-check/index.ts";
import { failNotification, leaseNextNotification } from "../../../db/price-check/repositories/outbox-repository.ts";
import { loadResultDelivery, markResultDeliverySucceeded, recordResultDeliveryFailure } from "../../../db/price-check/repositories/result-delivery-repository.ts";
import { PostmarkTransactionalEmailProvider } from "./postmark.ts";
import { resultReadyEmail } from "./result-ready.ts";
import type { TransactionalEmailProvider } from "./provider.ts";

function deliveryOrigin() {
  const candidate = process.env.DEPLOY_PRIME_URL || process.env.URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  const url = new URL(candidate);
  if (url.protocol !== "https:" || !(url.hostname === "cvlon.com" || url.hostname.endsWith("--cvlon.netlify.app"))) throw new Error("RESULT_ORIGIN_INVALID");
  return url.origin;
}

export async function processOneResultNotification(db: PriceCheckDb, options: { provider?: TransactionalEmailProvider; now?: Date; leaseOwner?: string } = {}) {
  const now = options.now ?? new Date();
  const leaseOwner = options.leaseOwner ?? `result-worker:${crypto.randomUUID()}`;
  const message = await leaseNextNotification(db, { leaseOwner, now, leaseUntil: new Date(now.valueOf() + 60_000) });
  if (!message) return { status: "idle" as const };
  if (message.messageType !== "RESULT_READY" || message.aggregateType !== "price_check_result") {
    await failNotification(db, { id: message.id, leaseOwner, nextAttemptAt: now, sanitizedFailureCode: "UNSUPPORTED_MESSAGE", deadLetter: true });
    return { status: "dead_letter" as const, notificationId: message.id };
  }
  try {
    const tokenKey = process.env.PRICE_CHECK_RESULT_TOKEN_KEY ?? "";
    const delivery = await loadResultDelivery(db, message.aggregateId, tokenKey, deliveryOrigin());
    const provider = options.provider ?? new PostmarkTransactionalEmailProvider(process.env.POSTMARK_SERVER_TOKEN ?? "");
    const email = resultReadyEmail({
      from: process.env.PRICE_CHECK_EMAIL_FROM || "Civilon Price Check <pricecheck@cvlon.com>",
      to: delivery.requester.businessEmail,
      reference: delivery.priceCheck.publicReference,
      secureUrl: delivery.secureUrl,
      expiresAt: delivery.token.expiresAt,
    });
    const sent = await provider.send(email);
    await markResultDeliverySucceeded(db, { resultId: message.aggregateId, notificationId: message.id, leaseOwner, providerMessageId: sent.providerMessageId, now });
    return { status: "succeeded" as const, notificationId: message.id, providerMessageId: sent.providerMessageId };
  } catch (error) {
    const code = error instanceof Error ? error.message.replace(/[^A-Z0-9_]/gi, "_").slice(0, 120) : "DELIVERY_FAILED";
    const deadLetter = message.attemptCount >= 5;
    await failNotification(db, { id: message.id, leaseOwner, nextAttemptAt: new Date(now.valueOf() + Math.min(60 * 60_000, 2 ** message.attemptCount * 60_000)), sanitizedFailureCode: code, deadLetter });
    await recordResultDeliveryFailure(db, message.aggregateId, code, deadLetter);
    return { status: deadLetter ? "dead_letter" as const : "retry" as const, notificationId: message.id, code };
  }
}
