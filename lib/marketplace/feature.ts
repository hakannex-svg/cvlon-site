/**
 * Buy & Sell intake is gated independently of Price Check so neither workflow
 * can be exposed as a side effect of enabling the other. Fails closed: any
 * value other than the exact string "true" leaves the workflow disabled.
 */
export function isMarketplaceEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NEXT_PUBLIC_MARKETPLACE_ENABLED === "true";
}

/**
 * Sell intake carries its own switch on top of the marketplace switch.
 *
 * Both must be "true". The Sell slice is deliberately narrower than Buy today —
 * no supplier-facing page, no evidence uploads — so it must be possible to run
 * Buy intake in production while Sell stays dark, and to close Sell alone if a
 * supplier-side problem appears. Price Check is unaffected by either flag.
 * Fails closed: any value other than the exact string "true" leaves Sell off.
 */
export function isSellSubmissionEnabled(env: Record<string, string | undefined> = process.env) {
  return isMarketplaceEnabled(env) && env.NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED === "true";
}
