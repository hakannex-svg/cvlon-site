import {
  DEFAULT_SUPPLIER_AVAILABILITY,
  isSupplierAvailabilityState,
  isSupplierResponseStatus,
  isSupplierSourceKind,
  supplierConditionCodes,
  supplierResponseCurrencies,
  type SupplierAvailabilityState,
  type SupplierResponseStatusValue,
  type SupplierSourceKind,
} from "../../../db/price-check/domain/supplier-response-policy.ts";
import { isRecordId, type ValidationResult } from "./validation.ts";

/**
 * Strict input validation for internal supplier responses.
 *
 * The registered-versus-nonregistered combination is settled here, before the
 * database sees it, so `supplier_responses_supplier_kind_chk` is a backstop
 * rather than the error message a staff member reads.
 *
 * Nothing in this module accepts a file, an attachment handle or a storage key.
 * The current attachment schema cannot bind a file to a supplier response, so
 * supplier documentation is a text summary and only a text summary.
 */

export const SUPPLIER_NAME_MAX = 200;
export const SUPPLIER_CONTACT_MAX = 320;
export const SUPPLIER_PART_NUMBER_MAX = 160;
export const SUPPLIER_LOCATION_MAX = 240;
export const SUPPLIER_TEXT_MAX = 2000;
export const SUPPLIER_LEAD_TIME_MAX_DAYS = 3650;
export const SUPPLIER_QUANTITY_MAX = 1_000_000_000;
export const SUPPLIER_COST_MAX = 100_000_000;

// eslint-disable-next-line no-control-regex -- deliberate control-character class
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function reject(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function unknownKeys(body: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(body).filter((key) => !allowed.includes(key));
}

/** Trims, collapses CRLF and refuses control characters. `null` when absent. */
function optionalText(value: unknown, max: number, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return reject(`${field} must be text.`);
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { ok: true, value: null };
  if (normalized.length > max) return reject(`Keep ${field} under ${max} characters.`);
  if (CONTROL_CHARACTERS.test(normalized)) return reject(`Remove control characters from ${field}.`);
  return { ok: true, value: normalized };
}

/** A decimal string the numeric column can take, or `null`. */
function optionalDecimal(value: unknown, max: number, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(numeric)) return reject(`${field} must be a number.`);
  if (numeric < 0) return reject(`${field} cannot be negative.`);
  if (numeric > max) return reject(`${field} is out of range.`);
  return { ok: true, value: numeric.toFixed(3).replace(/\.?0+$/, "") || "0" };
}

function optionalInteger(value: unknown, max: number, field: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isInteger(numeric)) return reject(`${field} must be a whole number.`);
  if (numeric < 0) return reject(`${field} cannot be negative.`);
  if (numeric > max) return reject(`${field} is out of range.`);
  return { ok: true, value: numeric };
}

export type SupplierResponseInput = {
  supplierKind: SupplierSourceKind;
  supplierContactId: string | null;
  supplierNameSnapshot: string | null;
  supplierContactSnapshot: string | null;
  supplierCountry: string | null;
  offeredPartNumber: string | null;
  statedCondition: string | null;
  quantityAvailable: string | null;
  supplierUnitCost: string | null;
  currencyCode: string | null;
  quoteOnRequest: boolean;
  availabilityState: SupplierAvailabilityState;
  locationText: string | null;
  leadTimeDays: number | null;
  documentsSummary: string | null;
  shippingNotes: string | null;
  expiresAt: Date | null;
};

const ALLOWED_KEYS = [
  "supplierKind", "supplierContactId", "supplierNameSnapshot", "supplierContactSnapshot",
  "supplierCountry", "offeredPartNumber", "statedCondition", "quantityAvailable",
  "supplierUnitCost", "currencyCode", "quoteOnRequest", "availabilityState",
  "locationText", "leadTimeDays", "documentsSummary", "shippingNotes", "expiresAt",
] as const;

export function validateSupplierResponse(raw: unknown): ValidationResult<SupplierResponseInput> {
  const body = asObject(raw);
  if (!body) return reject("A request body is required.");
  if (unknownKeys(body, ALLOWED_KEYS).length) return reject("Unexpected fields were rejected.");

  if (!isSupplierSourceKind(body.supplierKind)) return reject("Choose whether the supplier is registered.");
  const supplierKind = body.supplierKind;

  const name = optionalText(body.supplierNameSnapshot, SUPPLIER_NAME_MAX, "the supplier name");
  if (!name.ok) return name;
  const contactSnapshot = optionalText(body.supplierContactSnapshot, SUPPLIER_CONTACT_MAX, "the supplier contact");
  if (!contactSnapshot.ok) return contactSnapshot;

  // The two kinds are mutually exclusive, and each has exactly one identity
  // source. Deciding this here means the database constraint never has to
  // produce a message for a human.
  let supplierContactId: string | null = null;
  if (supplierKind === "registered_contact") {
    if (!isRecordId(body.supplierContactId)) return reject("Choose a registered supplier contact.");
    supplierContactId = body.supplierContactId;
  } else {
    if (body.supplierContactId !== undefined && body.supplierContactId !== null && body.supplierContactId !== "") {
      return reject("A nonregistered supplier cannot reference a registered contact.");
    }
    if (!name.value) return reject("Enter the supplier company or name.");
  }

  const country = optionalText(body.supplierCountry, 2, "the supplier country");
  if (!country.ok) return country;
  const supplierCountry = country.value ? country.value.toUpperCase() : null;
  if (supplierCountry && !/^[A-Z]{2}$/.test(supplierCountry)) return reject("Use a two-letter country code.");

  const partNumber = optionalText(body.offeredPartNumber, SUPPLIER_PART_NUMBER_MAX, "the offered part number");
  if (!partNumber.ok) return partNumber;

  let statedCondition: string | null = null;
  if (body.statedCondition !== undefined && body.statedCondition !== null && body.statedCondition !== "") {
    if (typeof body.statedCondition !== "string" || !(supplierConditionCodes as readonly string[]).includes(body.statedCondition)) {
      return reject("Choose a valid condition.");
    }
    statedCondition = body.statedCondition;
  }

  const quantity = optionalDecimal(body.quantityAvailable, SUPPLIER_QUANTITY_MAX, "the quantity available");
  if (!quantity.ok) return quantity;
  const cost = optionalDecimal(body.supplierUnitCost, SUPPLIER_COST_MAX, "the supplier unit cost");
  if (!cost.ok) return cost;

  let currencyCode: string | null = null;
  if (body.currencyCode !== undefined && body.currencyCode !== null && body.currencyCode !== "") {
    if (typeof body.currencyCode !== "string" || !(supplierResponseCurrencies as readonly string[]).includes(body.currencyCode)) {
      return reject("Choose a supported currency.");
    }
    currencyCode = body.currencyCode;
  }
  // `supplier_responses_cost_currency_chk`: a cost without a currency is a
  // number nobody can act on.
  if (cost.value !== null && !currencyCode) return reject("Choose a currency for the supplier cost.");

  if (body.quoteOnRequest !== undefined && typeof body.quoteOnRequest !== "boolean") {
    return reject("Quote on request must be yes or no.");
  }
  // Default true: a supplier who has not given a number has not given a number.
  const quoteOnRequest = body.quoteOnRequest === undefined ? cost.value === null : body.quoteOnRequest;
  // `supplier_responses_quote_on_request_chk`.
  if (!quoteOnRequest && cost.value === null) return reject("Record a supplier cost, or leave it as quote on request.");

  let availabilityState: SupplierAvailabilityState = DEFAULT_SUPPLIER_AVAILABILITY;
  if (body.availabilityState !== undefined && body.availabilityState !== null && body.availabilityState !== "") {
    if (!isSupplierAvailabilityState(body.availabilityState)) return reject("Choose a valid availability claim.");
    availabilityState = body.availabilityState;
  }

  const location = optionalText(body.locationText, SUPPLIER_LOCATION_MAX, "the supplier location");
  if (!location.ok) return location;
  const leadTime = optionalInteger(body.leadTimeDays, SUPPLIER_LEAD_TIME_MAX_DAYS, "the lead time");
  if (!leadTime.ok) return leadTime;
  const documents = optionalText(body.documentsSummary, SUPPLIER_TEXT_MAX, "the documentation summary");
  if (!documents.ok) return documents;
  const shipping = optionalText(body.shippingNotes, SUPPLIER_TEXT_MAX, "the shipping notes");
  if (!shipping.ok) return shipping;

  let expiresAt: Date | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
    if (typeof body.expiresAt !== "string") return reject("Enter a valid expiry date.");
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.valueOf())) return reject("Enter a valid expiry date.");
    expiresAt = parsed;
  }

  return {
    ok: true,
    data: {
      supplierKind,
      supplierContactId,
      supplierNameSnapshot: name.value,
      supplierContactSnapshot: contactSnapshot.value,
      supplierCountry,
      offeredPartNumber: partNumber.value,
      statedCondition,
      quantityAvailable: quantity.value,
      supplierUnitCost: cost.value,
      currencyCode,
      quoteOnRequest,
      availabilityState,
      locationText: location.value,
      leadTimeDays: leadTime.value,
      documentsSummary: documents.value,
      shippingNotes: shipping.value,
      expiresAt,
    },
  };
}

export type SupplierResponseStatusInput = {
  expectedStatus: SupplierResponseStatusValue;
  to: SupplierResponseStatusValue;
};

export function validateSupplierResponseStatus(raw: unknown): ValidationResult<SupplierResponseStatusInput> {
  const body = asObject(raw);
  if (!body) return reject("A request body is required.");
  if (unknownKeys(body, ["expectedStatus", "to"]).length) return reject("Unexpected fields were rejected.");
  if (!isSupplierResponseStatus(body.expectedStatus)) return reject("The current status is not recognised.");
  if (!isSupplierResponseStatus(body.to)) return reject("Choose a valid status.");
  if (body.expectedStatus === body.to) return reject("The response is already in that status.");
  return { ok: true, data: { expectedStatus: body.expectedStatus, to: body.to } };
}
