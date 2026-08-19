import { BUY_REQUEST_SOURCE_PAGE } from "./marketplace/contract.ts";
import { isMarketplaceEnabled } from "./marketplace/feature.ts";

/**
 * Where an ordinary "Start a part search" call to action goes.
 *
 * An ordinary part search is a Buy Request: the request reaches the database,
 * the admin queue and the email-verification workflow, instead of a Netlify
 * form submission nobody can follow up from a reference. The legacy anchor is
 * the fallback only while the marketplace flag is off, because with Buy intake
 * closed the Buy Request page answers 404 and the CTA would be a dead link.
 *
 * The fallback is a parameter because it differs by surface: global chrome has
 * no form of its own and falls back to the contact page, while an interior page
 * that still renders its own form falls back to that same-page anchor.
 */
export const LEGACY_PART_SEARCH_HREF = "/contact-us#rfq";
export const LEGACY_PART_SEARCH_ANCHOR = "#rfq";

export function partSearchHref(
  fallback: string = LEGACY_PART_SEARCH_HREF,
  env: Record<string, string | undefined> = process.env,
) {
  return isMarketplaceEnabled(env) ? BUY_REQUEST_SOURCE_PAGE : fallback;
}
