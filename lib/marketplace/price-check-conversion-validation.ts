import "../../db/price-check/server-boundary.ts";

import { normalizePhone } from "../../db/price-check/domain/normalization.ts";
import { cleanIntakeField, memberOf } from "./field-sanitizer.ts";
import { isPhoneRequiredUrgency } from "./contract.ts";
import {
  buyRequestConditionCodes,
  buyRequestFulfillmentPreferences,
  buyRequestUrgencies,
  type PriceCheckBuyRequestSubmission,
} from "./price-check-conversion-contract.ts";

const allowedFields = new Set([
  "quantity",
  "acceptableCondition",
  "urgency",
  "neededByDate",
  "deliveryCountry",
  "deliveryPostalCode",
  "deliveryCity",
  "fulfillmentPreference",
  "applicationNotes",
  "phone",
  "serviceAcknowledged",
  "legalAcknowledged",
  "website",
]);

type ValidationResult =
  | { success: true; data: PriceCheckBuyRequestSubmission }
  | { success: false; fieldErrors: Record<string, string> };

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validates only the short confirmation fields. Contact identity, part number,
 * aircraft and Price Check/result ids are intentionally absent: the server
 * derives those from the authenticated private-result session.
 */
export function validatePriceCheckBuyRequestSubmission(raw: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, fieldErrors: { _form: "Submit valid Buy Request details." } };
  }
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    errors._form = "The request contains an unsupported field.";
  }
  if (typeof value.website === "string" && value.website.trim()) {
    errors._form = "The request could not be accepted.";
  }

  const quantity = cleanIntakeField(value.quantity, 16, true);
  if (!quantity || !/^\d+(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || Number(quantity) > 999_999_999.999) {
    errors.quantity = "Enter a quantity greater than zero.";
  }
  const acceptableCondition = memberOf(value.acceptableCondition, buyRequestConditionCodes);
  if (!acceptableCondition) errors.acceptableCondition = "Select an acceptable condition.";
  const urgency = memberOf(value.urgency, buyRequestUrgencies);
  if (!urgency) errors.urgency = "Select how urgently the part is needed.";
  const fulfillmentPreference = memberOf(value.fulfillmentPreference, buyRequestFulfillmentPreferences);
  if (!fulfillmentPreference) errors.fulfillmentPreference = "Select a delivery preference.";

  const neededByDate = cleanIntakeField(value.neededByDate, 10);
  if (neededByDate === null || (neededByDate && !validCalendarDate(neededByDate))) {
    errors.neededByDate = "Enter a valid needed-by date.";
  }
  const deliveryCountry = cleanIntakeField(value.deliveryCountry, 2);
  if (deliveryCountry === null || (deliveryCountry && !/^[A-Za-z]{2}$/.test(deliveryCountry))) {
    errors.deliveryCountry = "Use a two-letter country code.";
  }
  const deliveryPostalCode = cleanIntakeField(value.deliveryPostalCode, 24);
  if (deliveryPostalCode === null) errors.deliveryPostalCode = "Enter a shorter postal code.";
  const deliveryCity = cleanIntakeField(value.deliveryCity, 160);
  if (deliveryCity === null) errors.deliveryCity = "Enter a shorter city name.";
  const applicationNotes = cleanIntakeField(value.applicationNotes, 2000);
  if (applicationNotes === null) errors.applicationNotes = "The notes are too long or invalid.";

  const phone = cleanIntakeField(value.phone, 80);
  if (phone === null) {
    errors.phone = "Enter a valid phone number.";
  } else if (phone) {
    try {
      normalizePhone(phone);
    } catch {
      errors.phone = "Enter a valid phone number.";
    }
  }

  if (value.serviceAcknowledged !== true) {
    errors.serviceAcknowledged = "Acknowledge how Civilon will process this request.";
  }
  if (value.legalAcknowledged !== true) {
    errors.legalAcknowledged = "Acknowledge the Privacy Policy and Terms of Use.";
  }

  if (
    Object.keys(errors).length
    || !quantity
    || !acceptableCondition
    || !urgency
    || !fulfillmentPreference
  ) {
    return { success: false, fieldErrors: errors };
  }

  return {
    success: true,
    data: {
      quantity,
      acceptableCondition,
      urgency,
      neededByDate: neededByDate || null,
      deliveryCountry: deliveryCountry ? deliveryCountry.toUpperCase() : null,
      deliveryPostalCode: deliveryPostalCode || null,
      deliveryCity: deliveryCity || null,
      fulfillmentPreference,
      applicationNotes: applicationNotes || null,
      phone: phone || null,
      serviceAcknowledged: true,
      legalAcknowledged: true,
    },
  };
}

/** Server-side backstop after requester data is loaded from the Price Check. */
export function conversionHasRequiredPhone(
  submission: PriceCheckBuyRequestSubmission,
  requesterHasPhone: boolean,
) {
  return !isPhoneRequiredUrgency(submission.urgency) || Boolean(submission.phone) || requesterHasPhone;
}
