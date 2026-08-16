import "../../db/price-check/server-boundary.ts";

import {
  normalizeEmail,
  normalizePartNumber,
  normalizePhone,
  parseMoney,
  sanitizeAttribution,
} from "../../db/price-check/domain/normalization.ts";
import {
  conditionCodes,
  coreDispositions,
  currencyCodes,
  documentationCodes,
  PRICE_CHECK_SOURCE_PAGE,
  quoteStatuses,
  transactionTypes,
  warrantyUnits,
  type PriceCheckSubmission,
} from "./contract.ts";

const allowedFields = new Set([
  "idempotencyKey", "partNumber", "quantity", "quoteOrPurchased",
  "transactionType", "conditionCode", "unitPrice", "currencyCode", "aog",
  "description", "aircraftModel", "coreCharge", "coreDisposition",
  "exchangeFee", "freight", "transactionDate", "warrantyValue",
  "warrantyUnit", "warrantyText", "documentationCodes", "documentationOther",
  "attachmentHandles", "notes", "firstName", "lastName", "companyName", "businessEmail", "phone",
  "role", "country", "serviceAcknowledged", "sourcePage", "landingPage",
  "referrer", "utmSource", "utmMedium", "utmCampaign", "utmContent",
  "utmTerm", "website",
]);

type ValidationResult =
  | { success: true; data: PriceCheckSubmission }
  | { success: false; fieldErrors: Record<string, string> };

function clean(value: unknown, maximum: number, required = false) {
  if (value === null || value === undefined || value === "") {
    return required ? null : "";
  }
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\p{Cc}/gu, "").trim();
  if ((required && !normalized) || normalized.length > maximum) return null;
  return normalized;
}

function optionalMoney(value: unknown, field: string, errors: Record<string, string>) {
  const text = clean(value, 21);
  if (text === null) {
    errors[field] = "Enter a valid amount with no more than two decimal places.";
    return null;
  }
  if (!text) return null;
  try {
    const normalized = parseMoney(text);
    if (normalized.split(".")[0].length > 16) throw new Error("Money is too large.");
    return normalized;
  } catch {
    errors[field] = "Enter a non-negative amount with no more than two decimal places.";
    return null;
  }
}

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function member<T extends readonly string[]>(value: unknown, choices: T): T[number] | null {
  return typeof value === "string" && choices.includes(value) ? value as T[number] : null;
}

export function validatePriceCheckSubmission(raw: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, fieldErrors: { _form: "Submit a valid Price Check request." } };
  }
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    errors._form = "The request contains an unsupported field.";
  }

  const idempotencyKey = clean(value.idempotencyKey, 64, true);
  if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    errors._form = "Refresh the page and try the submission again.";
  }
  const partNumber = clean(value.partNumber, 160, true);
  if (!partNumber || !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(partNumber)) {
    errors.partNumber = "Enter a valid aircraft part number.";
  } else {
    try { normalizePartNumber(partNumber); } catch { errors.partNumber = "Enter a valid aircraft part number."; }
  }
  const quantity = clean(value.quantity, 16, true);
  if (!quantity || !/^\d+(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || Number(quantity) > 999_999_999.999) {
    errors.quantity = "Enter a quantity greater than zero.";
  }
  const quoteOrPurchased = member(value.quoteOrPurchased, quoteStatuses);
  if (!quoteOrPurchased) errors.quoteOrPurchased = "Select quote or already purchased.";
  const transactionType = member(value.transactionType, transactionTypes);
  if (!transactionType) errors.transactionType = "Select a transaction type.";
  const conditionCode = member(value.conditionCode, conditionCodes);
  if (!conditionCode) errors.conditionCode = "Select a condition.";
  const currencyCode = member(value.currencyCode, currencyCodes);
  if (!currencyCode) errors.currencyCode = "Select an approved currency.";
  if (typeof value.aog !== "boolean") errors.aog = "Select whether this is an AOG requirement.";

  const unitPrice = optionalMoney(value.unitPrice, "unitPrice", errors);
  if (!clean(value.unitPrice, 21, true)) errors.unitPrice = "Enter the quoted or purchased unit price.";
  const isExchange = transactionType === "exchange";
  const coreCharge = isExchange ? optionalMoney(value.coreCharge, "coreCharge", errors) : null;
  const exchangeFee = isExchange ? optionalMoney(value.exchangeFee, "exchangeFee", errors) : null;
  const freight = optionalMoney(value.freight, "freight", errors);
  const coreDisposition = isExchange ? member(value.coreDisposition, coreDispositions) : null;
  if (isExchange && !coreDisposition) errors.coreDisposition = "Select the stated core terms.";

  const transactionDate = clean(value.transactionDate, 10);
  if (transactionDate && !validCalendarDate(transactionDate)) {
    errors.transactionDate = "Enter a valid quote or purchase date.";
  }
  const warrantyValueText = clean(value.warrantyValue, 16);
  if (warrantyValueText && (!/^\d+(?:\.\d{1,2})?$/.test(warrantyValueText) || Number(warrantyValueText) < 0 || Number(warrantyValueText) > 9_999_999_999.99)) {
    errors.warrantyValue = "Enter a valid non-negative warranty value.";
  }
  const warrantyUnit = warrantyValueText ? member(value.warrantyUnit, warrantyUnits) : null;
  if (warrantyValueText && !warrantyUnit) errors.warrantyUnit = "Select a warranty unit.";

  const rawDocumentation = value.documentationCodes;
  const selectedDocumentation = Array.isArray(rawDocumentation)
    ? [...new Set(rawDocumentation.filter((entry): entry is string => typeof entry === "string"))]
    : [];
  if (!Array.isArray(rawDocumentation) || selectedDocumentation.length !== rawDocumentation.length || selectedDocumentation.some((code) => !documentationCodes.includes(code as (typeof documentationCodes)[number]))) {
    errors.documentationCodes = "Select only the available documentation requirements.";
  }
  const documentationOther = clean(value.documentationOther, 240);
  if (selectedDocumentation.includes("OTHER") && !documentationOther) {
    errors.documentationOther = "Describe the other documentation requirement.";
  }
  const attachmentHandles = Array.isArray(value.attachmentHandles)
    ? [...new Set(value.attachmentHandles.filter((entry): entry is string => typeof entry === "string"))]
    : [];
  if (value.attachmentHandles !== undefined && (!Array.isArray(value.attachmentHandles)
    || attachmentHandles.length !== value.attachmentHandles.length
    || attachmentHandles.length > 3
    || attachmentHandles.some((handle) => !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(handle)))) {
    errors.attachmentHandles = "Remove the affected upload and try again.";
  }

  const firstName = clean(value.firstName, 120, true);
  const lastName = clean(value.lastName, 120, true);
  const companyName = clean(value.companyName, 200, true);
  if (!firstName) errors.firstName = "Enter your first name.";
  if (!lastName) errors.lastName = "Enter your last name.";
  if (!companyName) errors.companyName = "Enter your company name.";
  const businessEmail = clean(value.businessEmail, 320, true);
  try { if (!businessEmail) throw new Error(); normalizeEmail(businessEmail); } catch { errors.businessEmail = "Enter a valid business email address."; }
  const phone = clean(value.phone, 80);
  if (value.aog === true && !phone) errors.phone = "Enter a phone number for this AOG Price Check.";
  if (phone) {
    try { normalizePhone(phone); } catch { errors.phone = "Enter a valid phone number."; }
  }
  const country = clean(value.country, 2);
  if (country && !/^[A-Za-z]{2}$/.test(country)) errors.country = "Use a two-letter country code.";
  if (value.serviceAcknowledged !== true) errors.serviceAcknowledged = "Acknowledge the service-processing disclosure.";
  if (value.sourcePage !== PRICE_CHECK_SOURCE_PAGE) errors.sourcePage = "The source page is invalid.";

  const description = clean(value.description, 500);
  const aircraftModel = clean(value.aircraftModel, 160);
  const warrantyText = clean(value.warrantyText, 500);
  const notes = clean(value.notes, 2000);
  const role = clean(value.role, 120);
  for (const [field, result] of Object.entries({ description, aircraftModel, warrantyText, notes, role, documentationOther })) {
    if (result === null) errors[field] = `The ${field === "notes" ? "notes" : "field"} is too long or invalid.`;
  }

  const attribution = sanitizeAttribution({
    landingPage: clean(value.landingPage, 500) || null,
    referrer: clean(value.referrer, 500) || null,
    utmSource: clean(value.utmSource, 160) || null,
    utmMedium: clean(value.utmMedium, 160) || null,
    utmCampaign: clean(value.utmCampaign, 160) || null,
    utmContent: clean(value.utmContent, 160) || null,
    utmTerm: clean(value.utmTerm, 160) || null,
  });

  if (Object.keys(errors).length > 0 || !idempotencyKey || !partNumber || !quantity || !quoteOrPurchased || !transactionType || !conditionCode || !unitPrice || !currencyCode || typeof value.aog !== "boolean" || !firstName || !lastName || !companyName || !businessEmail) {
    return { success: false, fieldErrors: errors };
  }

  return { success: true, data: {
    idempotencyKey, partNumber, quantity, quoteOrPurchased, transactionType,
    conditionCode, unitPrice, currencyCode, aog: value.aog,
    description: description || null, aircraftModel: aircraftModel || null,
    coreCharge, coreDisposition, exchangeFee, freight,
    transactionDate: transactionDate || null,
    warrantyValue: warrantyValueText || null, warrantyUnit,
    warrantyText: warrantyText || null,
    documentationCodes: selectedDocumentation as PriceCheckSubmission["documentationCodes"],
    documentationOther: documentationOther || null, attachmentHandles, notes: notes || null,
    firstName, lastName, companyName, businessEmail, phone: phone || null,
    role: role || null, country: country?.toUpperCase() || null,
    serviceAcknowledged: true, sourcePage: PRICE_CHECK_SOURCE_PAGE,
    landingPage: attribution.landingPage, referrer: attribution.referrerOrigin,
    utmSource: attribution.utmSource, utmMedium: attribution.utmMedium,
    utmCampaign: attribution.utmCampaign, utmContent: attribution.utmContent,
    utmTerm: attribution.utmTerm,
  } };
}
