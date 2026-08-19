import { priceCheckDb } from "../../db/price-check/index.ts";
import { isMarketplaceEnabled, isSellSubmissionEnabled } from "../../lib/marketplace/feature.ts";
import { runSellInventoryFreshnessCadence } from "../../lib/marketplace/sell-inventory-freshness-cadence-service.ts";

/**
 * The bulk-inventory freshness producer, twice in the same working morning.
 *
 * Three gates, all failing closed:
 *
 *  - Scheduled functions only run from the published deploy, but Netlify can
 *    omit CONTEXT from that runtime. An explicit non-production context is
 *    refused; an absent one is allowed, which is the same reading the existing
 *    notification drain uses rather than a second convention.
 *  - Buy & Sell must be enabled, and Sell intake must be enabled on top of it.
 *    Both, because a seller-facing e-mail is a Sell-side act and Sell is the
 *    switch operations closes when something on the supplier side is wrong.
 *  - The producer's own batch ceiling, in the service.
 *
 * A refusal returns 204 and writes nothing at all — no check, no audit row, no
 * queued message.
 *
 * Nothing is delivered here. Each ask leaves a row in the shared outbox and the
 * existing minute worker sends it, so there is one sender, one retry policy and
 * one lease.
 */
export default async function processSellInventoryFreshnessCadence() {
  const contextRefused = Boolean(process.env.CONTEXT) && process.env.CONTEXT !== "production";
  const featureRefused = !isMarketplaceEnabled() || !isSellSubmissionEnabled();
  if (contextRefused || featureRefused) {
    console.info(JSON.stringify({
      event: "sell_inventory_freshness_cadence",
      outcome: "refused",
      contextRefused,
      featureRefused,
    }));
    return new Response(null, { status: 204 });
  }

  // Counts and fixed reason codes. No identifier of any kind reaches this body,
  // which is the same rule the summary itself is built under.
  const summary = await runSellInventoryFreshnessCadence(priceCheckDb);
  // Scheduled functions do not retain a response body. Keep one sanitized,
  // count-only log entry so operations can prove a zero-due run as readily as
  // a run that issued reminders, without logging a seller or submission id.
  console.info(JSON.stringify({
    event: "sell_inventory_freshness_cadence",
    outcome: "completed",
    ...summary,
  }));
  return Response.json({ ok: true, ...summary });
}

/**
 * 13:17 and 14:17 UTC daily — 09:17 and 10:17 in New York while Eastern
 * daylight time is in force. The second pass is a same-morning platform retry:
 * the live-link and due-date guards make it a no-op after a successful first
 * pass, while a missed first invocation no longer delays the cadence a day.
 * Both remain in the seller's working morning, and the odd minute keeps them
 * off the hour every other scheduled job runs on.
 */
export const config = { schedule: "17 13,14 * * *" };
