/**
 * Buy a Part from Civilon — public intake contract.
 *
 * Civilon buys and resells: a Buy Request asks Civilon to source a part, it is
 * not published, listed, or distributed to a supplier network. Nothing in this
 * contract records or implies confirmed availability, a certification, an
 * airworthiness approval, or an authenticity/fitness guarantee.
 */
export const MARKETPLACE_HUB_PAGE = "/buy-sell-aircraft-parts";
export const BUY_REQUEST_SOURCE_PAGE = "/buy-sell-aircraft-parts/buy";
export const BUY_REQUEST_SUBMIT_PATH = "/api/marketplace/buy-requests";
export const SELL_SUBMISSION_PAGE = "/buy-sell-aircraft-parts/sell";

/**
 * Target of the emailed verification link: a page, not an endpoint.
 *
 * The credential travels in the URL fragment, which browsers never put on the
 * wire. It therefore cannot appear in an access log, a proxy log, a Referer
 * header, or an analytics page-path. The page reads the fragment, erases it,
 * and posts the credential to BUY_REQUEST_VERIFY_API_PATH only when the
 * customer presses a button — so a mail scanner following the link cannot
 * activate anything.
 */
export const BUY_REQUEST_VERIFY_PATH = "/buy-sell-aircraft-parts/verify";
export const BUY_REQUEST_VERIFY_API_PATH = "/api/marketplace/buy-requests/verify";
export const BUY_REQUEST_VERIFY_FRAGMENT_KEY = "token";

export const BUY_REQUEST_MAX_BODY_BYTES = 24 * 1024;
/** A redeem body is one short credential; anything larger is not a redeem. */
export const BUY_REQUEST_VERIFY_MAX_BODY_BYTES = 2 * 1024;

export type BuyRequestVerifyResponse =
  | { ok: true; status: "verified" }
  | { ok: false; status: "unavailable" };

/**
 * Buyer-stated acceptable condition. "NOT_SURE" is the default because a buyer
 * is not required to know a condition code, and "ANY" is a deliberate, distinct
 * statement that several conditions are commercially acceptable.
 */
export const buyRequestConditionCodes = [
  "NOT_SURE",
  "ANY",
  "NE",
  "NS",
  "OH",
  "SV",
  "AR",
] as const;

export const buyRequestUrgencies = [
  "not_sure",
  "aog",
  "critical",
  "standard",
  "planned",
] as const;

export const buyRequestFulfillmentPreferences = [
  "not_sure",
  "door_delivery",
  "port_of_entry",
  "nj_pickup",
] as const;

/** Urgency levels where a reachable phone number is operationally required. */
export const phoneRequiredUrgencies = ["aog", "critical"] as const;

export type BuyRequestConditionCode = (typeof buyRequestConditionCodes)[number];
export type BuyRequestUrgency = (typeof buyRequestUrgencies)[number];
export type BuyRequestFulfillmentPreference =
  (typeof buyRequestFulfillmentPreferences)[number];

export function isPhoneRequiredUrgency(urgency: string) {
  return (phoneRequiredUrgencies as readonly string[]).includes(urgency);
}

export type BuyRequestSubmission = {
  idempotencyKey: string;
  partNumber: string | null;
  description: string | null;
  quantity: string;
  acceptableCondition: BuyRequestConditionCode;
  urgency: BuyRequestUrgency;
  neededByDate: string | null;
  deliveryCountry: string | null;
  deliveryPostalCode: string | null;
  deliveryCity: string | null;
  fulfillmentPreference: BuyRequestFulfillmentPreference;
  aircraftModel: string | null;
  applicationNotes: string | null;
  firstName: string;
  lastName: string;
  companyName: string;
  businessEmail: string;
  phone: string | null;
  serviceAcknowledged: true;
  legalAcknowledged: true;
  sourcePage: typeof BUY_REQUEST_SOURCE_PAGE;
  landingPage: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
};

export type BuyRequestSubmitResponse =
  | { ok: true; reference: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
