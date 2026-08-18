import "../../db/price-check/server-boundary.ts";

import {
  normalizeEmail,
  normalizePartNumber,
  normalizePhone,
  parseMoney,
  sanitizeAttribution,
} from "../../db/price-check/domain/normalization.ts";
import { cleanIntakeField, memberOf } from "./field-sanitizer.ts";
import { MARKETPLACE_UPLOAD_MAX_FILES } from "./uploads/constants.ts";
import {
  SELL_SUBMISSION_HANDLE_PATTERN,
  SELL_SUBMISSION_SOURCE_PAGE,
  sellSubmissionConditionCodes,
  sellSubmissionCurrencyCodes,
  sellSubmissionKinds,
  sellSubmissionReservedUploadFields,
  type SellSubmissionInput,
} from "./sell-contract.ts";

const clean = cleanIntakeField;
const member = memberOf;

/**
 * Strict allowlist. An unrecognised key is a rejected submission, not a
 * silently dropped field, so a client can never smuggle a column the intake
 * does not own — `status`, `assignedAdminUserId` and `notes` included.
 */
const allowedFields = new Set([
  "idempotencyKey", "attachmentHandles",
  "submissionKind", "partNumber", "description", "quantity",
  "conditionCode", "estimatedLineItemCount", "quoteOnRequest", "askingUnitPrice",
  "currencyCode", "canShipToNewJersey", "locationCountry", "locationStateRegion",
  "locationCity", "locationPostalCode", "firstName", "lastName", "companyName",
  "businessEmail", "phone", "serviceAcknowledged", "legalAcknowledged", "sourcePage",
  "landingPage", "referrer", "utmSource", "utmMedium", "utmCampaign", "utmContent",
  "utmTerm", "website",
]);

const reservedUploadFields = new Set<string>(sellSubmissionReservedUploadFields);

/**
 * Fields that only mean something for one submission mode. A bulk inventory
 * list has no single part number, no single quantity and no single unit price;
 * a single part has no line-item count. Sending one anyway is refused rather
 * than dropped, so a client cannot believe a value was recorded when it was not.
 */
const singlePartOnlyFields = [
  "partNumber",
  "quantity",
  "conditionCode",
  "askingUnitPrice",
  "currencyCode",
] as const;

type ValidationResult =
  | { success: true; data: SellSubmissionInput }
  | { success: false; fieldErrors: Record<string, string> };

/** Present means "the client sent something", not "the client sent a value". */
function supplied(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  return candidate !== undefined && candidate !== null && candidate !== "";
}

/**
 * A non-negative whole count, accepted as a number or as the digit string a
 * plain HTML form would post. Nothing else — a float, a sign, an exponent or a
 * padded string is a malformed count, not a value to coerce.
 */
function wholeCount(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d{1,9}$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return parsed >= 0 && parsed <= maximum ? parsed : null;
}

export function validateSellSubmission(raw: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, fieldErrors: { _form: "Submit a valid Sell Submission." } };
  }
  const value = raw as Record<string, unknown>;

  // Upload handles are refused by name until the upload slice exists. Silently
  // ignoring them would let a seller believe their evidence was attached.
  if (Object.keys(value).some((key) => reservedUploadFields.has(key))) {
    errors.uploads = "Attachments cannot be submitted yet. Send the details as text for now.";
  }
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    errors._form = "The submission contains an unsupported field.";
  }

  const idempotencyKey = clean(value.idempotencyKey, 64, true);
  if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    errors._form = "Refresh the page and try the submission again.";
  }

  /*
   * Uploads are optional and must never stand between a seller and a fast
   * submission: an absent, empty or malformed handle list is a field error on
   * the attachments alone, and every other rule below still runs.
   *
   * A handle is opaque and server-minted. Nothing here dereferences one — the
   * shape check exists so an obviously forged value ("../../object-key") never
   * reaches a query, and ownership is proved later against the session cookie.
   */
  const rawHandles = value.attachmentHandles;
  let attachmentHandles: string[] = [];
  if (rawHandles !== undefined && rawHandles !== null) {
    const candidates = Array.isArray(rawHandles) ? rawHandles : null;
    const strings = candidates?.filter((entry): entry is string => typeof entry === "string") ?? [];
    const unique = [...new Set(strings)];
    if (
      !candidates
      || strings.length !== candidates.length
      || unique.length !== candidates.length
      || unique.length > MARKETPLACE_UPLOAD_MAX_FILES
      || unique.some((handle) => !SELL_SUBMISSION_HANDLE_PATTERN.test(handle))
    ) {
      errors.attachmentHandles = "Remove the affected file and upload it again.";
    } else {
      attachmentHandles = unique;
    }
  }

  const submissionKind = member(value.submissionKind, sellSubmissionKinds);
  if (!submissionKind) {
    errors.submissionKind = "Choose whether you are offering a single part or a bulk inventory list.";
  }
  const isBulk = submissionKind === "bulk_inventory";
  const isSinglePart = submissionKind === "single_part";

  if (isBulk) {
    for (const field of singlePartOnlyFields) {
      if (supplied(value, field)) {
        errors[field] = "This detail belongs to a single part, not a bulk inventory list.";
      }
    }
    // Quote-on-request cannot be switched off without a unit price, and a bulk
    // list has no unit price to give. Refusing here keeps the payload from ever
    // reaching a state the database check constraint would have to catch.
    if (value.quoteOnRequest === false) {
      errors.quoteOnRequest = "A bulk inventory list is priced on request. Prices are agreed per line later.";
    }
  }
  if (isSinglePart && supplied(value, "estimatedLineItemCount")) {
    errors.estimatedLineItemCount = "A line-item count applies to a bulk inventory list.";
  }

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

  const description = clean(value.description, 2000);
  if (description === null) errors.description = "Shorten the description.";

  const quantity = clean(value.quantity, 16);
  if (
    quantity === null
    || (quantity && (!/^\d+(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || Number(quantity) > 999_999_999.999))
  ) {
    errors.quantity = "Enter a quantity greater than zero, or leave it blank.";
  }

  const conditionCode = supplied(value, "conditionCode")
    ? member(value.conditionCode, sellSubmissionConditionCodes)
    : "NOT_SURE";
  if (!conditionCode) errors.conditionCode = "Select the condition of the part, or choose Not sure.";

  const estimatedLineItemCount = wholeCount(value.estimatedLineItemCount, 1_000_000);
  if (estimatedLineItemCount === null) {
    errors.estimatedLineItemCount = "Enter roughly how many line items the list contains.";
  }

  // Quote-on-request is the default: a supplier is never obliged to state a
  // price to start a conversation, and no price stated here is ever published.
  let quoteOnRequest = true;
  if (value.quoteOnRequest !== undefined && value.quoteOnRequest !== null) {
    if (typeof value.quoteOnRequest !== "boolean") {
      errors.quoteOnRequest = "Choose whether you want to quote on request.";
    } else {
      quoteOnRequest = value.quoteOnRequest;
    }
  }

  const rawPrice = clean(value.askingUnitPrice, 24);
  let askingUnitPrice: string | null = null;
  if (rawPrice === null) {
    errors.askingUnitPrice = "Enter a valid asking unit price.";
  } else if (rawPrice) {
    try {
      askingUnitPrice = parseMoney(rawPrice);
    } catch {
      errors.askingUnitPrice = "Enter a valid asking unit price.";
    }
  }
  const rawCurrency = clean(value.currencyCode, 3);
  const currencyCode = rawCurrency
    ? member(rawCurrency.toUpperCase(), sellSubmissionCurrencyCodes)
    : null;
  if (rawCurrency && !currencyCode) errors.currencyCode = "Select a supported currency.";

  if (!quoteOnRequest) {
    if (!askingUnitPrice && !errors.askingUnitPrice) {
      errors.askingUnitPrice = "Enter an asking unit price, or leave pricing as quote on request.";
    }
    if (!currencyCode && !errors.currencyCode) {
      errors.currencyCode = "Select the currency of your asking price.";
    }
  } else {
    // A price with quote-on-request left on is contradictory input, not a
    // preference to guess at.
    if (askingUnitPrice) {
      errors.askingUnitPrice = "Turn off quote on request to state an asking price.";
    }
    if (currencyCode) {
      errors.currencyCode = "Turn off quote on request to state an asking price.";
    }
  }

  // Unknown is a first-class answer. Civilon decides supplier-direct shipping or
  // New Jersey routing later, and forcing a guess here would record a logistics
  // commitment the supplier never made.
  let canShipToNewJersey: boolean | null = null;
  if (value.canShipToNewJersey !== undefined && value.canShipToNewJersey !== null) {
    if (typeof value.canShipToNewJersey !== "boolean") {
      errors.canShipToNewJersey = "Choose whether you can ship to New Jersey, or leave it unanswered.";
    } else {
      canShipToNewJersey = value.canShipToNewJersey;
    }
  }

  const locationCountry = clean(value.locationCountry, 2);
  if (locationCountry === null || (locationCountry && !/^[A-Za-z]{2}$/.test(locationCountry))) {
    errors.locationCountry = "Use a two-letter country code.";
  }
  const locationStateRegion = clean(value.locationStateRegion, 160);
  if (locationStateRegion === null) errors.locationStateRegion = "Enter a shorter state or region.";
  const locationCity = clean(value.locationCity, 160);
  if (locationCity === null) errors.locationCity = "Enter a shorter city name.";
  const locationPostalCode = clean(value.locationPostalCode, 24);
  if (locationPostalCode === null) errors.locationPostalCode = "Enter a shorter postal code.";

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

  // A supplier offer is never urgent by construction, so a phone number stays
  // optional in every mode. There is no urgency field to make it required.
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

  if (value.serviceAcknowledged !== true) {
    errors.serviceAcknowledged = "Acknowledge how Civilon will review this submission.";
  }
  if (value.legalAcknowledged !== true) {
    errors.legalAcknowledged = "Acknowledge the Privacy Policy and Terms of Use.";
  }
  if (value.sourcePage !== SELL_SUBMISSION_SOURCE_PAGE) errors.sourcePage = "The source page is invalid.";

  // Each mode needs enough substance to be actionable. The database enforces the
  // single-part rule too; the bulk rule is an intake rule, because a bulk row
  // with neither a description nor a count is an empty record.
  if (isSinglePart && !partNumber && !description) {
    errors.partNumber = "Enter a part number or describe the part you are offering.";
  }
  if (isBulk && !description && !estimatedLineItemCount) {
    errors.description = "Describe the inventory, or estimate how many line items it contains.";
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

  if (
    Object.keys(errors).length > 0
    || !idempotencyKey || !submissionKind || !conditionCode
    || !firstName || !lastName || !companyName || !businessEmail
  ) {
    return { success: false, fieldErrors: errors };
  }

  return {
    success: true,
    data: {
      idempotencyKey,
      attachmentHandles,
      submissionKind,
      // Mode is enforced a second time on the way out. Even if a rule above were
      // bypassed, a bulk payload physically cannot carry single-part values.
      partNumber: isBulk ? null : partNumber || null,
      description: description || null,
      quantity: isBulk ? null : quantity || null,
      conditionCode: isBulk ? null : conditionCode,
      estimatedLineItemCount: isBulk ? estimatedLineItemCount || null : null,
      quoteOnRequest: isBulk ? true : quoteOnRequest,
      askingUnitPrice: isBulk ? null : askingUnitPrice,
      currencyCode: isBulk ? null : currencyCode,
      canShipToNewJersey,
      locationCountry: locationCountry ? locationCountry.toUpperCase() : null,
      locationStateRegion: locationStateRegion || null,
      locationCity: locationCity || null,
      locationPostalCode: locationPostalCode || null,
      firstName,
      lastName,
      companyName,
      businessEmail,
      phone: phone || null,
      serviceAcknowledged: true,
      legalAcknowledged: true,
      sourcePage: SELL_SUBMISSION_SOURCE_PAGE,
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
