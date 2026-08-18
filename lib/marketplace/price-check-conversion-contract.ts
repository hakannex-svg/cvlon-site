import {
  buyRequestConditionCodes,
  buyRequestFulfillmentPreferences,
  buyRequestUrgencies,
  type BuyRequestConditionCode,
  type BuyRequestFulfillmentPreference,
  type BuyRequestUrgency,
} from "./contract.ts";

export const PRICE_CHECK_BUY_REQUEST_SOURCE_PAGE = "/price-check/result";
export const PRICE_CHECK_BUY_REQUEST_SUBMIT_PATH = "/api/price-check/result/buy-request";
export const PRICE_CHECK_BUY_REQUEST_MAX_BODY_BYTES = 8 * 1024;

export {
  buyRequestConditionCodes,
  buyRequestFulfillmentPreferences,
  buyRequestUrgencies,
};

export type PriceCheckBuyRequestSubmission = {
  quantity: string;
  acceptableCondition: BuyRequestConditionCode;
  urgency: BuyRequestUrgency;
  neededByDate: string | null;
  deliveryCountry: string | null;
  deliveryPostalCode: string | null;
  deliveryCity: string | null;
  fulfillmentPreference: BuyRequestFulfillmentPreference;
  applicationNotes: string | null;
  phone: string | null;
  serviceAcknowledged: true;
  legalAcknowledged: true;
};

export type PriceCheckBuyRequestResponse =
  | { ok: true; reference: string; created: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
