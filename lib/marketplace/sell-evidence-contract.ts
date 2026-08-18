/**
 * Follow-up seller evidence — public contract.
 *
 * The shape shared between the seller's browser and the server. Everything it
 * names is deliberately small:
 *
 *   - No account, no signup, no password. One emailed link is the whole
 *     identity step, exactly as the initial submission works.
 *   - The page never learns anything about the offer. It is told the Civilon
 *     reference and the requested category labels, and nothing else: no part
 *     number, quantity, price, inventory, location, filename, or buyer.
 *   - Evidence remains optional in the commercial sense — Civilon already has
 *     the offer, and nothing here is required for Civilon to have received it.
 *     A follow-up *submission* must carry at least one finished file, because a
 *     submission of nothing is not a response.
 *   - Nothing submitted is published, listed, searched, or shown to a buyer,
 *     and neither the upload nor Civilon's review certifies, authenticates,
 *     approves airworthiness, constitutes regulatory approval, or guarantees
 *     authenticity or fitness. Documentation varies by part and source.
 */
import {
  sellEvidenceCategoryLabels,
  type SellEvidenceRequestCategory,
} from "../../db/price-check/domain/sell-evidence-request.ts";

/**
 * Target of the emailed link: a page, not an endpoint. The credential travels
 * in the URL fragment for the same reason every other Civilon credential does —
 * a fragment is never transmitted, so it cannot reach an access log, a CDN log,
 * a Referer header, or an analytics page-path. The page reads it, erases it,
 * and sends it to Civilon only on an explicit seller action, so a mail scanner
 * following the link cannot spend it.
 */
export const SELL_EVIDENCE_PAGE_PATH = "/buy-sell-aircraft-parts/sell/evidence";
export const SELL_EVIDENCE_FRAGMENT_KEY = "token";
export const SELL_EVIDENCE_VIEW_API_PATH = "/api/marketplace/sell-evidence/view";
export const SELL_EVIDENCE_SUBMIT_API_PATH = "/api/marketplace/sell-evidence/submit";

/** A view body is one credential; a submit body is one credential plus handles. */
export const SELL_EVIDENCE_VIEW_MAX_BODY_BYTES = 2 * 1024;
export const SELL_EVIDENCE_SUBMIT_MAX_BODY_BYTES = 4 * 1024;

/** Opaque server-minted upload handles are ULIDs, as at initial intake. */
export const SELL_EVIDENCE_HANDLE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * What the page is allowed to render.
 *
 * The reference is already known to the seller — it is in the e-mail they
 * opened — and the labels are the request itself. Nothing else crosses this
 * boundary, so the page cannot leak an offer detail it was never given.
 */
export type SellEvidenceRequestView = {
  reference: string;
  categories: SellEvidenceRequestCategory[];
  expiresAt: string;
};

export type SellEvidenceViewResponse =
  | { ok: true; request: SellEvidenceRequestView }
  | { ok: false; status: "unavailable" };

export type SellEvidenceSubmitResponse =
  | { ok: true; status: "received" }
  | { ok: false; status: "unavailable" }
  | { ok: false; status: "retry"; error: string }
  | { ok: false; status: "rejected"; error: string };

export function sellEvidenceCategoryLabel(category: SellEvidenceRequestCategory) {
  return sellEvidenceCategoryLabels[category];
}
