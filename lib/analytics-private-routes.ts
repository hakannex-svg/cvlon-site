/**
 * The single list of routes optional analytics must never touch.
 *
 * The analytics bootstrap and the consent UI each used to carry their own
 * hand-maintained copy of this list, and two copies drift: the secure seller
 * evidence and inventory-freshness pages were reachable only from an emailed
 * link, yet neither list named them, so a previously granted consent could
 * re-arm the loader and raise the consent dialog on a page Civilon addressed to
 * one recipient. One list cannot drift against itself.
 *
 * Client-safe on purpose: literal strings, no environment read, no server
 * import, so both client components can import it without pulling anything
 * further into the browser bundle. The paths are restated here rather than
 * imported from their route contracts for the same reason; a test asserts the
 * restatement still matches every contract constant.
 */
export const PRIVATE_ANALYTICS_ROUTES = [
  "/admin",
  "/price-check/result",
  "/buy-sell-aircraft-parts/verify",
  "/buy-sell-aircraft-parts/offer",
  "/buy-sell-aircraft-parts/sell/verify",
  "/buy-sell-aircraft-parts/sell/evidence",
  "/buy-sell-aircraft-parts/sell/availability",
] as const;

/**
 * True for a private route and everything beneath it.
 *
 * Matching is exact-or-child so a private child never makes its public parent
 * private: /buy-sell-aircraft-parts/sell stays a public intake page despite its
 * private evidence and availability children, and /price-check stays public
 * despite /price-check/result.
 */
export function isPrivateAnalyticsRoute(path: string) {
  return PRIVATE_ANALYTICS_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}
