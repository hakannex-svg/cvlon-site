export function isPriceCheckEnabled() {
  return process.env.NEXT_PUBLIC_PRICE_CHECK_ENABLED === "true";
}
