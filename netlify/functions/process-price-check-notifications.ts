import { processOneResultNotification } from "../../lib/price-check/email/worker.ts";
import { priceCheckDb } from "../../db/price-check/index.ts";
import { isMarketplaceEnabled } from "../../lib/marketplace/feature.ts";

export default async function processPriceCheckNotifications() {
  // Scheduled functions only run from the published deploy, but Netlify can omit
  // CONTEXT from that runtime. Reject explicit non-production contexts while
  // allowing the protected production schedule when CONTEXT is absent.
  const priceCheckDisabled = process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED !== "true";
  const marketplaceDisabled = !isMarketplaceEnabled();
  // The drain is shared, so it may run when either workflow is enabled. Each
  // message is still dispatched only to its own registered workflow handler.
  if ((process.env.CONTEXT && process.env.CONTEXT !== "production") || (priceCheckDisabled && marketplaceDisabled)) {
    return new Response(null, { status: 204 });
  }

  for (let processed = 0; processed < 10; processed += 1) {
    const result = await processOneResultNotification(priceCheckDb);
    if (result.status === "idle" || result.status === "retry" || result.status === "dead_letter") break;
  }

  return Response.json({ ok: true });
}

export const config = { schedule: "* * * * *" };
