import "../../db/price-check/server-boundary.ts";

import {
  normalizeEmail,
  normalizePartNumber,
  normalizePhone,
  sanitizeAttribution,
} from "../../db/price-check/domain/normalization.ts";
import { cleanIntakeField, memberOf } from "./field-sanitizer.ts";
import {
  BUY_REQUEST_SOURCE_PAGE,
  buyRequestConditionCodes,
  buyRequestFulfillmentPreferences,
  buyRequestUrgencies,
  isPhoneRequiredUrgency,
  type BuyRequestSubmission,
} from "./contract.ts";

/**
 * Strict allowlist. An unrecognised key is a rejected submission, not a silently
 * dropped field, so a client can never smuggle a column the intake does not own.
 */
const allowedFields = new Set([
  "idempotencyKey", "partNumber", "description", "quantity", "acceptableCondition",
  "urgency", "neededByDate", "deliveryCountry", "deliveryPostalCode", "deliveryCity",
  "fulfillmentPreference", "aircraftModel", "applicationNotes", "firstName", "lastName",
  "companyName", "businessEmail", "phone", "serviceAcknowledged", "legalAcknowledged",
  "sourcePage", "landingPage", "referrer", "utmSource", "utmMedium", "utmCampaign",
  "utmContent", "utmTerm", "website",
]);

type ValidationResult =
  | { success: true; data: BuyRequestSubmission }
  | { success: false; fieldErrors: Record<string, string> };

/**
 * Local aliases for the shared marketplace sanitizer. Buy and Sell intake must
 * strip and bound text identically, so the implementation lives in one module
 * and neither intake can quietly drift away from the other.
 */
const clean = cleanIntakeField;
const member = memberOf;

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateBuyRequestSubmission(raw: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, fieldErrors: { _form: "Submit a valid Buy Request." } };
  }
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    errors._form = "The request contains an unsupported field.";
  }

  const idempotencyKey = clean(value.idempotencyKey, 64, true);
  if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    errors._form = "Refresh the page and try the request again.";
  }

  // A buyer may not have a part number. Either a part number or a free-text
  // description is enough, and the database enforces the same rule.
  const partNumber = clean(value.partNumber, 160);
  if (partNumber === null || (partNumber && !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(partNumber))) {
    errors.partNumber = "Enter a valid aircraft part number, or describe the part instead.";
  } else if (partNumber) {
    try {
      normalizePartNumber(partNumber);
    } catch {
      errors.partNumber = "Enter a valid aircraft part number, or describe the part instead.";
    }
  }
  const description = clean(value.description, 500);
  if (description === null) errors.description = "Shorten the part description.";
  if (!partNumber && !description) {
    errors.partNumber = "Enter a part number or describe the part you need.";
  }

  const quantity = clean(value.quantity, 16, true);
  if (!quantity || !/^\d+(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || Number(quantity) > 999_999_999.999) {
    errors.quantity = "Enter a quantity greater than zero.";
  }
  const acceptableCondition = member(value.acceptableCondition, buyRequestConditionCodes);
  if (!acceptableCondition) errors.acceptableCondition = "Select an acceptable condition.";
  const urgency = member(value.urgency, buyRequestUrgencies);
  if (!urgency) errors.urgency = "Select how urgently the part is needed.";
  const fulfillmentPreference = member(value.fulfillmentPreference, buyRequestFulfillmentPreferences);
  if (!fulfillmentPreference) errors.fulfillmentPreference = "Select a delivery preference.";

  const neededByDate = clean(value.neededByDate, 10);
  if (neededByDate === null || (neededByDate && !validCalendarDate(neededByDate))) {
    errors.neededByDate = "Enter a valid needed-by date.";
  }

  const deliveryCountry = clean(value.deliveryCountry, 2);
  if (deliveryCountry === null || (deliveryCountry && !/^[A-Za-z]{2}$/.test(deliveryCountry))) {
    errors.deliveryCountry = "Use a two-letter country code.";
  }
  const deliveryPostalCode = clean(value.deliveryPostalCode, 24);
  if (deliveryPostalCode === null) errors.deliveryPostalCode = "Enter a shorter postal code.";
  const deliveryCity = clean(value.deliveryCity, 160);
  if (deliveryCity === null) errors.deliveryCity = "Enter a shorter city name.";

  const aircraftModel = clean(value.aircraftModel, 160);
  if (aircraftModel === null) errors.aircraftModel = "Enter a shorter aircraft or model.";
  const applicationNotes = clean(value.applicationNotes, 2000);
  if (applicationNotes === null) errors.applicationNotes = "The notes are too long or invalid.";

  const firstName = clean(value.firstName, 120, true);
  const lastName = clean(value.lastName, 120, true);
  const companyName = clean(value.companyName, 200, true);
  if (!firstName) errors.firstName = "Enter your first name.";
  if (!lastName) errors.lastName = "Enter your last name.";
  if (!companyName) errors.companyName = "Enter your company name.";
  const businessEmail = clean(value.businessEmail, 320, true);
  try {
    if (!businessEmail) throw new Error("Business email is required.");
    normalizeEmail(businessEmail);
  } catch {
    errors.businessEmail = "Enter a valid business email address.";
  }

  const phone = clean(value.phone, 80);
  if (phone === null) {
    errors.phone = "Enter a valid phone number.";
  } else if (phone) {
    try {
      normalizePhone(phone);
    } catch {
      errors.phone = "Enter a valid phone number.";
    }
  }
  // AOG and critical requirements are coordinated by phone, so the number stops
  // being optional the moment the buyer states that urgency.
  if (urgency && isPhoneRequiredUrgency(urgency) && !phone) {
    errors.phone = "Enter a phone number for an AOG or critical requirement.";
  }

  if (value.serviceAcknowledged !== true) {
    errors.serviceAcknowledged = "Acknowledge how Civilon will process this request.";
  }
  if (value.legalAcknowledged !== true) {
    errors.legalAcknowledged = "Acknowledge the Privacy Policy and Terms of Use.";
  }
  if (value.sourcePage !== BUY_REQUEST_SOURCE_PAGE) errors.sourcePage = "The source page is invalid.";

  const attribution = sanitizeAttribution({
    landingPage: clean(value.landingPage, 500) || null,
    referrer: clean(value.referrer, 500) || null,
    utmSource: clean(value.utmSource, 160) || null,
    utmMedium: clean(value.utmMedium, 160) || null,
    utmCampaign: clean(value.utmCampaign, 160) || null,
    utmContent: clean(value.utmContent, 160) || null,
    utmTerm: clean(value.utmTerm, 160) || null,
  });

  if (
    Object.keys(errors).length > 0
    || !idempotencyKey || !quantity || !acceptableCondition || !urgency
    || !fulfillmentPreference || !firstName || !lastName || !companyName || !businessEmail
  ) {
    return { success: false, fieldErrors: errors };
  }

  return {
    success: true,
    data: {
      idempotencyKey,
      partNumber: partNumber || null,
      description: description || null,
      quantity,
      acceptableCondition,
      urgency,
      neededByDate: neededByDate || null,
      deliveryCountry: deliveryCountry ? deliveryCountry.toUpperCase() : null,
      deliveryPostalCode: deliveryPostalCode || null,
      deliveryCity: deliveryCity || null,
      fulfillmentPreference,
      aircraftModel: aircraftModel || null,
      applicationNotes: applicationNotes || null,
      firstName,
      lastName,
      companyName,
      businessEmail,
      phone: phone || null,
      serviceAcknowledged: true,
      legalAcknowledged: true,
      sourcePage: BUY_REQUEST_SOURCE_PAGE,
      landingPage: attribution.landingPage,
      referrer: attribution.referrerOrigin,
      utmSource: attribution.utmSource,
      utmMedium: attribution.utmMedium,
      utmCampaign: attribution.utmCampaign,
      utmContent: attribution.utmContent,
      utmTerm: attribution.utmTerm,
    },
  };
}
