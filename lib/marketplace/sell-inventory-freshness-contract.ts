/**
 * Bulk-inventory freshness — public contract.
 *
 * The shape shared between the seller's browser and the server, and it is
 * deliberately the smallest surface any Civilon credential has:
 *
 *   - No account, no signup, no password. One emailed link is the whole
 *     identity step, exactly as the initial submission and the evidence
 *     follow-up work.
 *   - The page is told the Civilon reference and an expiry, and nothing else.
 *     Not the inventory, not a filename, not a line count, not a price, not a
 *     warehouse or location, not the company name, not a buyer. A page that is
 *     never handed those cannot show them to whoever is looking over the
 *     seller's shoulder.
 *   - The seller's answer is one of exactly three values. There is no free-text
 *     field, so there is nowhere for a part number, a price or a third party's
 *     name to be typed into a record that deliberately holds none of them.
 *   - An answer is the seller's own statement at a moment in time. It changes no
 *     workflow status, no business or evidence review, and no certification,
 *     authenticity, airworthiness or regulatory position. Availability remains
 *     subject to confirmation, and offers are at Civilon's discretion.
 */
import {
  sellInventoryFreshnessResponseLabels,
  type SellInventoryFreshnessResponse,
} from "../../db/price-check/domain/sell-inventory-freshness.ts";

/**
 * Target of the emailed link: a page, not an endpoint. The credential travels
 * in the URL fragment for the same reason every other Civilon credential does —
 * a fragment is never transmitted, so it cannot reach an access log, a CDN log,
 * a Referer header, or an analytics page-path. The page reads it, erases it,
 * and sends it to Civilon only on an explicit seller action, so a mail scanner
 * following the link cannot spend it.
 *
 * The public route says "availability" because that is the seller's word for
 * what they are being asked. The internal vocabulary is "inventory freshness",
 * which is Civilon's word for why it is being asked.
 */
export const SELL_INVENTORY_FRESHNESS_PAGE_PATH = "/buy-sell-aircraft-parts/sell/availability";
export const SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY = "token";
export const SELL_INVENTORY_FRESHNESS_VIEW_API_PATH = "/api/marketplace/sell-availability/view";
export const SELL_INVENTORY_FRESHNESS_RESPOND_API_PATH = "/api/marketplace/sell-availability/respond";

/** A view body is one credential; a respond body is one credential plus one word. */
export const SELL_INVENTORY_FRESHNESS_VIEW_MAX_BODY_BYTES = 2 * 1024;
export const SELL_INVENTORY_FRESHNESS_RESPOND_MAX_BODY_BYTES = 2 * 1024;

/**
 * What the page is allowed to render.
 *
 * The reference is already known to the seller — it is in the e-mail they
 * opened — and the expiry is a fact about the link itself. Nothing else crosses
 * this boundary, so the page cannot leak an inventory detail it was never
 * given.
 */
export type SellInventoryFreshnessView = {
  reference: string;
  expiresAt: string;
};

export type SellInventoryFreshnessViewResponse =
  | { ok: true; check: SellInventoryFreshnessView }
  | { ok: false; status: "unavailable" };

export type SellInventoryFreshnessRespondResponse =
  | { ok: true; status: "recorded" }
  | { ok: false; status: "unavailable" };

export function sellInventoryFreshnessResponseLabel(
  response: SellInventoryFreshnessResponse,
) {
  return sellInventoryFreshnessResponseLabels[response];
}
