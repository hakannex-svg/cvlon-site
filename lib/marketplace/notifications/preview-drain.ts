import "../../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../../db/price-check/index.ts";
import { processNextNotification } from "../../notifications/outbox-worker.ts";
import {
  marketplaceNotificationHandlers,
  registeredNotificationTypes,
} from "../../notifications/registry.ts";
import type { TransactionalEmailProvider } from "../../price-check/email/provider.ts";
import { isMarketplaceEnabled } from "../feature.ts";

/**
 * Manual, preview-only drain of the marketplace half of the shared outbox.
 *
 * Why it exists: the production drain in
 * `netlify/functions/process-price-check-notifications.ts` refuses to run in any
 * non-production Netlify context, which is correct — a preview must never take
 * production's schedule. But it also means a controlled preview can never prove
 * that Buy/Sell verification mail reaches a customer, or that the internal
 * notice reaches exactly the three approved addresses. This module is that
 * proof path, and nothing else.
 *
 * Two containment properties, both structural rather than conventional:
 *
 *  1. It hands `processNextNotification` only `marketplaceNotificationHandlers`,
 *     so the lease allowlist is the four Buy/Sell message types. A Price Check
 *     `RESULT_READY` row is not leasable here at all.
 *  2. It reserves every type in the full Civilon registry, so the orphan-reaping
 *     pass — which exists to dead-letter genuinely unowned messages — excludes
 *     `RESULT_READY` as well. A message owned by another workflow is left
 *     exactly where it is, for that workflow's own drain.
 */

/** Never more than this many messages in one manual call. */
export const MARKETPLACE_PREVIEW_DRAIN_LIMIT = 10;

export const MARKETPLACE_PREVIEW_NOTIFICATIONS_FLAG = "MARKETPLACE_PREVIEW_NOTIFICATIONS_ENABLED";

/**
 * Counts only.
 *
 * Deliberately carries no notification id, no aggregate id, no recipient, no
 * subject, no token, no provider message id and no failure code: this is an
 * operator telling a preview to flush a queue, and the answer they need is "how
 * many, and did any fail", not a description of who was e-mailed about what.
 */
export type MarketplacePreviewDrainSummary = {
  processed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  /** True when the queue emptied before the limit was reached. */
  drained: boolean;
};

/**
 * The three conditions, all required, all failing closed.
 *
 * `CONTEXT` must be present AND explicitly something other than `production`.
 * An absent `CONTEXT` is treated as production, matching the scheduled
 * function's own reasoning: Netlify can omit the variable from the production
 * runtime, so "missing" is never permission to run a preview-only tool.
 */
export function isMarketplacePreviewDrainEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  const context = env.CONTEXT?.trim();
  if (!context || context === "production") return false;
  if (env[MARKETPLACE_PREVIEW_NOTIFICATIONS_FLAG] !== "true") return false;
  return isMarketplaceEnabled(env);
}

/**
 * Drains at most `MARKETPLACE_PREVIEW_DRAIN_LIMIT` marketplace notifications.
 *
 * Stops early the moment the marketplace queue reports idle, so a preview
 * operator pressing the button twice does not spin. Delivery, retry backoff,
 * lease fencing and dead-lettering are entirely the shared dispatcher's, which
 * is the point: this adds an entry point, not a second set of semantics.
 */
export async function drainMarketplaceNotifications(
  db: PriceCheckDb,
  options: {
    provider?: TransactionalEmailProvider;
    now?: Date;
    limit?: number;
    handlers?: typeof marketplaceNotificationHandlers;
    reservedMessageTypes?: readonly string[];
  } = {},
): Promise<MarketplacePreviewDrainSummary> {
  const limit = Math.max(0, Math.min(options.limit ?? MARKETPLACE_PREVIEW_DRAIN_LIMIT, MARKETPLACE_PREVIEW_DRAIN_LIMIT));
  const handlers = options.handlers ?? marketplaceNotificationHandlers;
  const reservedMessageTypes = options.reservedMessageTypes ?? registeredNotificationTypes();

  const summary: MarketplacePreviewDrainSummary = {
    processed: 0,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
    drained: false,
  };

  for (let attempt = 0; attempt < limit; attempt += 1) {
    const result = await processNextNotification(db, {
      handlers,
      reservedMessageTypes,
      provider: options.provider,
      now: options.now,
      leaseOwner: `marketplace-preview-drain:${crypto.randomUUID()}`,
    });
    if (result.status === "idle") {
      summary.drained = true;
      return summary;
    }
    summary.processed += 1;
    if (result.status === "succeeded") summary.succeeded += 1;
    if (result.status === "retry") summary.retried += 1;
    if (result.status === "dead_letter") summary.deadLettered += 1;
  }

  return summary;
}
