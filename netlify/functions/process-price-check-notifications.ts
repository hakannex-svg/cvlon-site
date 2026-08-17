import { processOneResultNotification } from "../../lib/price-check/email/worker.ts";
import { priceCheckDb } from "../../db/price-check/index.ts";

export default async function processPriceCheckNotifications() {
  if (process.env.CONTEXT !== "production" || process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED !== "true") {
    return new Response(null, { status: 204 });
  }

  for (let processed = 0; processed < 10; processed += 1) {
    const result = await processOneResultNotification(priceCheckDb);
    if (result.status === "idle" || result.status === "retry" || result.status === "dead_letter") break;
  }

  return Response.json({ ok: true });
}

export const config = { schedule: "* * * * *" };
