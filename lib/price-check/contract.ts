export const PRICE_CHECK_SOURCE_PAGE = "/price-check";
export const PRICE_CHECK_MAX_BODY_BYTES = 64 * 1024;

export const currencyCodes = [
  "AUD",
  "CAD",
  "CHF",
  "EUR",
  "GBP",
  "JPY",
  "USD",
] as const;

export const transactionTypes = [
  "outright",
  "exchange",
  "repair",
  "not_sure",
] as const;

export const conditionCodes = ["NE", "NS", "OH", "SV", "AR", "NOT_SURE"] as const;
export const quoteStatuses = ["quote", "purchased"] as const;
export const coreDispositions = [
  "NOT_APPLICABLE",
  "REFUNDABLE",
  "FORFEITED",
  "UNCLEAR",
] as const;
export const warrantyUnits = [
  "DAYS",
  "MONTHS",
  "YEARS",
  "HOURS",
  "CYCLES",
  "OTHER",
] as const;
export const documentationCodes = [
  "FAA_8130_3",
  "EASA_FORM_1",
  "DUAL_RELEASE",
  "OEM_MANUFACTURER_COC",
  "MATERIAL_CERTIFICATION",
  "REMOVAL_RECORDS",
  "TEARDOWN_EVALUATION_REPORT",
  "TEST_REPORT",
  "OTHER",
  "NOT_SURE",
] as const;

export type CurrencyCode = (typeof currencyCodes)[number];
export type TransactionType = (typeof transactionTypes)[number];
export type ConditionCode = (typeof conditionCodes)[number];
export type QuoteStatus = (typeof quoteStatuses)[number];
export type CoreDisposition = (typeof coreDispositions)[number];
export type WarrantyUnit = (typeof warrantyUnits)[number];
export type DocumentationCode = (typeof documentationCodes)[number];

export type PriceCheckSubmission = {
  idempotencyKey: string;
  partNumber: string;
  quantity: string;
  quoteOrPurchased: QuoteStatus;
  transactionType: TransactionType;
  conditionCode: ConditionCode;
  unitPrice: string;
  currencyCode: CurrencyCode;
  aog: boolean;
  description: string | null;
  aircraftModel: string | null;
  coreCharge: string | null;
  coreDisposition: CoreDisposition | null;
  exchangeFee: string | null;
  freight: string | null;
  transactionDate: string | null;
  warrantyValue: string | null;
  warrantyUnit: WarrantyUnit | null;
  warrantyText: string | null;
  documentationCodes: DocumentationCode[];
  documentationOther: string | null;
  attachmentHandles: string[];
  notes: string | null;
  firstName: string;
  lastName: string;
  companyName: string;
  businessEmail: string;
  phone: string | null;
  role: string | null;
  country: string | null;
  serviceAcknowledged: true;
  sourcePage: typeof PRICE_CHECK_SOURCE_PAGE;
  landingPage: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
};

export type PriceCheckSubmitResponse =
  | { ok: true; reference: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
