import "../../db/price-check/server-boundary.ts";

import { createResultSession, verifyResultSession } from "../../db/price-check/domain/customer-result.ts";

export const RESULT_SESSION_COOKIE = "__Host-civilon_price_result";

export function resultTokenKey() {
  const key = process.env.PRICE_CHECK_RESULT_TOKEN_KEY ?? "";
  if (key.length < 32) throw new Error("Result access is unavailable.");
  return key;
}

export { createResultSession, verifyResultSession };
