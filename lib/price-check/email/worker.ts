import "../../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../../db/price-check/index.ts";
import { civilonNotificationHandlers } from "../../notifications/registry.ts";
import { processNextNotification } from "../../notifications/outbox-worker.ts";
import type { NotificationDrainResult } from "../../notifications/types.ts";
import type { TransactionalEmailProvider } from "./provider.ts";

export { deliveryOrigin, resultReadyNotificationHandler } from "./result-ready-handler.ts";

/**
 * Preserved entry point. It now drains the shared outbox through the Civilon
 * handler registry, so a message owned by another workflow is left for that
 * workflow instead of being dead-lettered here. RESULT_READY behaviour, retry
 * backoff, lease fencing and the result shape are unchanged.
 */
export async function processOneResultNotification(
  db: PriceCheckDb,
  options: { provider?: TransactionalEmailProvider; now?: Date; leaseOwner?: string } = {},
): Promise<NotificationDrainResult> {
  return processNextNotification(db, {
    handlers: civilonNotificationHandlers,
    provider: options.provider,
    now: options.now,
    leaseOwner: options.leaseOwner ?? `result-worker:${crypto.randomUUID()}`,
  });
}
