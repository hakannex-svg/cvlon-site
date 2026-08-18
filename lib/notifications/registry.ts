import type { NotificationHandler } from "./types.ts";
import { resultReadyNotificationHandler } from "../price-check/email/result-ready-handler.ts";
import {
  buyRequestInternalNotificationHandler,
  buyRequestVerifyNotificationHandler,
} from "../marketplace/email/buy-request-handlers.ts";
import {
  sellSubmissionInternalNotificationHandler,
  sellSubmissionVerifyNotificationHandler,
} from "../marketplace/email/sell-submission-handlers.ts";
import { buyerOfferNotificationHandlers } from "../marketplace/email/buyer-offer-handlers.ts";

/**
 * The marketplace half of the registry, on its own.
 *
 * Exported separately so a drain can be scoped to Buy/Sell without being able
 * to lease, deliver, or dead-letter Price Check's `RESULT_READY`. The preview
 * drain is the only consumer today; the shared production drain still runs the
 * full `civilonNotificationHandlers` list below.
 */
export const marketplaceNotificationHandlers: readonly NotificationHandler[] = [
  buyRequestVerifyNotificationHandler,
  buyRequestInternalNotificationHandler,
  sellSubmissionVerifyNotificationHandler,
  sellSubmissionInternalNotificationHandler,
  ...buyerOfferNotificationHandlers,
];

/**
 * Every Civilon outbox message type that has an owner.
 *
 * Adding a workflow means adding its handler here. Until a handler is
 * registered, its message type is treated as unregistered and reaped, so a
 * producer must never be shipped ahead of its handler.
 */
export const civilonNotificationHandlers: readonly NotificationHandler[] = [
  resultReadyNotificationHandler,
  ...marketplaceNotificationHandlers,
];

export function registeredNotificationTypes(
  handlers: readonly NotificationHandler[] = civilonNotificationHandlers,
) {
  return [...new Set(handlers.map((handler) => handler.messageType))];
}
