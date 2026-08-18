/**
 * Sell Parts to Civilon — public intake contract.
 *
 * A Sell Submission is a supplier offering parts *to Civilon*. It is its own
 * aggregate, deliberately not a mirrored Buy Request: the two sides carry
 * different commercial meaning and different disclosure risk.
 *
 * Rules encoded here:
 *   - No account and no signup. One email round-trip is the whole identity step.
 *   - Nothing submitted is ever published, listed, searched, or shown to a
 *     buyer. There is no public price and no public inventory surface.
 *   - A seller price is optional. Quote-on-request is the default, and a stated
 *     price is a private asking price, never a listing price.
 *   - Shipping to the Civilon New Jersey facility may be left unknown; Civilon
 *     decides supplier-direct or NJ routing later, off this form.
 *   - Nothing here records a certification, an airworthiness approval, an
 *     authenticity or fitness guarantee, or an acceptance of the offer.
 */
import { SELL_SUBMISSION_PAGE } from "./contract.ts";

export const SELL_SUBMISSION_SOURCE_PAGE = SELL_SUBMISSION_PAGE;
export const SELL_SUBMISSION_SUBMIT_PATH = "/api/marketplace/sell-submissions";

/**
 * Target of the emailed verification link: a page, not an endpoint, and the
 * same fragment-carried pattern the Buy Request uses. The credential lives in
 * the URL fragment, which browsers never put on the wire, so it cannot reach an
 * access log, a proxy log, a Referer header, or an analytics page-path. The
 * page (added in a later slice) reads the fragment, erases it, and posts the
 * credential to the API only on an explicit supplier action, so a mail scanner
 * following the link cannot activate anything.
 */
export const SELL_SUBMISSION_VERIFY_PATH = "/buy-sell-aircraft-parts/sell/verify";
export const SELL_SUBMISSION_VERIFY_API_PATH = "/api/marketplace/sell-submissions/verify";
export const SELL_SUBMISSION_VERIFY_FRAGMENT_KEY = "token";

export const SELL_SUBMISSION_MAX_BODY_BYTES = 24 * 1024;
/** A redeem body is one short credential; anything larger is not a redeem. */
export const SELL_SUBMISSION_VERIFY_MAX_BODY_BYTES = 2 * 1024;

export const sellSubmissionKinds = ["single_part", "bulk_inventory"] as const;

/**
 * Seller-stated condition of the goods being offered.
 *
 * "ANY" is deliberately absent even though the shared database enum carries it:
 * "any condition is acceptable" is a *buyer's* statement of tolerance, and a
 * seller asserting it about their own stock would be recorded as a condition
 * claim that means nothing. A seller who does not know states NOT_SURE, which
 * is also the default because a condition code is never required at intake.
 */
export const sellSubmissionConditionCodes = [
  "NOT_SURE",
  "NE",
  "NS",
  "OH",
  "SV",
  "AR",
] as const;

/** ISO 4217 codes the database check constraint accepts for an asking price. */
export const sellSubmissionCurrencyCodes = [
  "AUD",
  "CAD",
  "CHF",
  "EUR",
  "GBP",
  "JPY",
  "USD",
] as const;

export type SellSubmissionKind = (typeof sellSubmissionKinds)[number];
export type SellSubmissionConditionCode = (typeof sellSubmissionConditionCodes)[number];
export type SellSubmissionCurrencyCode = (typeof sellSubmissionCurrencyCodes)[number];

/**
 * The one upload field the intake owns.
 *
 * `attachmentHandles` carries opaque server-minted handles and nothing else —
 * no filename, no key, no session token, no URL. The session itself travels in
 * a host-only HttpOnly cookie, so a handle on its own is useless to anyone who
 * did not open the session that minted it.
 */
export const SELL_SUBMISSION_ATTACHMENT_FIELD = "attachmentHandles";

/** Opaque handles are ULIDs. Nothing else is a handle shape. */
export const SELL_SUBMISSION_HANDLE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Every other upload-shaped field name stays reserved and rejected.
 *
 * They are refused with their own message rather than silently ignored. An
 * ignored `uploadHandles` would let a client believe evidence had been attached
 * to an offer when nothing was stored, and an accepted `objectKey` or
 * `uploadSessionId` would let a client name storage the server is supposed to
 * choose. `attachmentHandles` is deliberately absent from this list — it is the
 * single allowlisted entry point, now that a backend exists to honour it.
 */
export const sellSubmissionReservedUploadFields = [
  "attachment",
  "attachmentId",
  "attachmentIds",
  "attachments",
  "document",
  "documentIds",
  "documents",
  "documentsSummary",
  "file",
  "files",
  "inventoryFile",
  "inventorySpreadsheet",
  "objectKey",
  "objectKeys",
  "photo",
  "photos",
  "upload",
  "uploadHandle",
  "uploadHandles",
  "uploadId",
  "uploadIds",
  "uploads",
  "uploadSessionId",
  "uploadToken",
] as const;

export type SellSubmissionInput = {
  idempotencyKey: string;
  /** Opaque handles only. Uploads are optional and never block a submission. */
  attachmentHandles: string[];
  submissionKind: SellSubmissionKind;
  partNumber: string | null;
  description: string | null;
  quantity: string | null;
  conditionCode: SellSubmissionConditionCode | null;
  estimatedLineItemCount: number | null;
  quoteOnRequest: boolean;
  askingUnitPrice: string | null;
  currencyCode: SellSubmissionCurrencyCode | null;
  canShipToNewJersey: boolean | null;
  locationCountry: string | null;
  locationStateRegion: string | null;
  locationCity: string | null;
  locationPostalCode: string | null;
  firstName: string;
  lastName: string;
  companyName: string;
  businessEmail: string;
  phone: string | null;
  serviceAcknowledged: true;
  legalAcknowledged: true;
  sourcePage: typeof SELL_SUBMISSION_SOURCE_PAGE;
  landingPage: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
};

export type SellSubmissionSubmitResponse =
  | { ok: true; reference: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type SellSubmissionVerifyResponse =
  | { ok: true; status: "verified" }
  | { ok: false; status: "unavailable" };

/**
 * Direct-to-storage authorization, shared with the browser.
 *
 * The client posts a declaration, receives one presigned form and one opaque
 * handle, and puts the file on storage itself. The session that ties the two
 * together lives in a host-only HttpOnly cookie the page cannot read, so the
 * browser holds no credential it could replay and no key it could name.
 */
export const MARKETPLACE_UPLOAD_AUTHORIZE_PATH = "/api/marketplace/uploads/authorize";

export type MarketplaceUploadAuthorization = {
  ok: true;
  handle: string;
  upload: { url: string; fields: Record<string, string> };
  expiresInSeconds: number;
  filename: string;
  size: number;
  purpose: string;
};

export type MarketplaceUploadAuthorizeResponse =
  | MarketplaceUploadAuthorization
  | { ok: false; error: string };
