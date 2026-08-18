import {
  DEFAULT_BUYER_OFFER_DELIVERY,
  buyerOfferConditionCodes,
  buyerOfferCurrencies,
  isBuyerOfferDeliveryOption,
  isBuyerOfferStatus,
  type BuyerOfferDeliveryOption,
  type BuyerOfferStatusValue,
} from "../../../db/price-check/domain/buyer-offer-policy.ts";
import { isRecordId, type ValidationResult } from "./validation.ts";

/**
 * Strict input validation for Civilon's buyer offers.
 *
 * The sale price is entered explicitly by a staff member. There is deliberately
 * no markup, margin or threshold arithmetic here: the commercial rule (15%, or
 * 8% above $50k) has an unresolved basis — unit price or line total, and in
 * which currency after conversion — and encoding a guess would produce prices
 * nobody authorised. Until that basis is written down, staff type the number.
 *
 * No supplier field is accepted. `selectedSupplierResponseId` is the single
 * internal pointer, is validated against the parent, and never leaves the
 * server-side detail read.
 */

export const OFFER_TEXT_MAX = 2000;
export const OFFER_LEAD_TIME_MAX_DAYS = 3650;
export const OFFER_PRICE_MAX = 100_000_000;
export const OFFER_QUANTITY_MAX = 1_000_000_000;

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

function optionalText(value: unknown, max: number, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return reject(`${field} must be text.`);
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { ok: true, value: null };
  if (normalized.length > max) return reject(`Keep ${field} under ${max} characters.`);
  if (CONTROL_CHARACTERS.test(normalized)) return reject(`Remove control characters from ${field}.`);
  return { ok: true, value: normalized };
}

function decimal(value: unknown, max: number, field: string, { positive = false } = {}): { ok: true; value: string } | { ok: false; error: string } {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(numeric)) return reject(`Enter ${field}.`);
  if (positive ? numeric <= 0 : numeric < 0) {
    return reject(positive ? `${field} must be greater than zero.` : `${field} cannot be negative.`);
  }
  if (numeric > max) return reject(`${field} is out of range.`);
  return { ok: true, value: numeric.toFixed(2) };
}

export type BuyerOfferInput = {
  civilonSaleUnitPrice: string;
  currencyCode: string;
  quantity: string;
  statedCondition: string | null;
  documentsSummary: string | null;
  deliveryOption: BuyerOfferDeliveryOption;
  shippingAndExportScope: string | null;
  leadTimeDays: number | null;
  expiresAt: Date | null;
  /** Internal staff pointer only. Never rendered to a buyer. */
  selectedSupplierResponseId: string | null;
};

const ALLOWED_KEYS = [
  "civilonSaleUnitPrice", "currencyCode", "quantity", "statedCondition",
  "documentsSummary", "deliveryOption", "shippingAndExportScope",
  "leadTimeDays", "expiresAt", "selectedSupplierResponseId",
] as const;

export function validateBuyerOffer(raw: unknown): ValidationResult<BuyerOfferInput> {
  const body = asObject(raw);
  if (!body) return reject("A request body is required.");
  if (unknownKeys(body, ALLOWED_KEYS).length) return reject("Unexpected fields were rejected.");

  const price = decimal(body.civilonSaleUnitPrice, OFFER_PRICE_MAX, "the Civilon sale price");
  if (!price.ok) return price;
  const quantity = decimal(body.quantity, OFFER_QUANTITY_MAX, "the quantity", { positive: true });
  if (!quantity.ok) return quantity;

  if (typeof body.currencyCode !== "string" || !(buyerOfferCurrencies as readonly string[]).includes(body.currencyCode)) {
    return reject("Choose a supported currency.");
  }
  const currencyCode = body.currencyCode;

  let statedCondition: string | null = null;
  if (body.statedCondition !== undefined && body.statedCondition !== null && body.statedCondition !== "") {
    if (typeof body.statedCondition !== "string" || !(buyerOfferConditionCodes as readonly string[]).includes(body.statedCondition)) {
      return reject("Choose a valid condition.");
    }
    statedCondition = body.statedCondition;
  }

  // The four buyer-facing destinations, and only those. `supplier_direct` is
  // not one of them and is not in the schema enum either.
  let deliveryOption: BuyerOfferDeliveryOption = DEFAULT_BUYER_OFFER_DELIVERY;
  if (body.deliveryOption !== undefined && body.deliveryOption !== null && body.deliveryOption !== "") {
    if (!isBuyerOfferDeliveryOption(body.deliveryOption)) return reject("Choose a buyer delivery option.");
    deliveryOption = body.deliveryOption;
  }

  const documents = optionalText(body.documentsSummary, OFFER_TEXT_MAX, "the documentation summary");
  if (!documents.ok) return documents;
  const scope = optionalText(body.shippingAndExportScope, OFFER_TEXT_MAX, "the shipping and export scope");
  if (!scope.ok) return scope;

  let leadTimeDays: number | null = null;
  if (body.leadTimeDays !== undefined && body.leadTimeDays !== null && body.leadTimeDays !== "") {
    const numeric = typeof body.leadTimeDays === "number" ? body.leadTimeDays : Number(String(body.leadTimeDays).trim());
    if (!Number.isInteger(numeric)) return reject("The lead time must be a whole number of days.");
    if (numeric < 0) return reject("The lead time cannot be negative.");
    if (numeric > OFFER_LEAD_TIME_MAX_DAYS) return reject("The lead time is out of range.");
    leadTimeDays = numeric;
  }

  let expiresAt: Date | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
    if (typeof body.expiresAt !== "string") return reject("Enter a valid expiry date.");
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.valueOf())) return reject("Enter a valid expiry date.");
    expiresAt = parsed;
  }

  let selectedSupplierResponseId: string | null = null;
  if (body.selectedSupplierResponseId !== undefined && body.selectedSupplierResponseId !== null && body.selectedSupplierResponseId !== "") {
    if (!isRecordId(body.selectedSupplierResponseId)) return reject("Choose a valid supplier response.");
    selectedSupplierResponseId = body.selectedSupplierResponseId;
  }

  return {
    ok: true,
    data: {
      civilonSaleUnitPrice: price.value,
      currencyCode,
      quantity: quantity.value,
      statedCondition,
      documentsSummary: documents.value,
      deliveryOption,
      shippingAndExportScope: scope.value,
      leadTimeDays,
      expiresAt,
      selectedSupplierResponseId,
    },
  };
}

export type BuyerOfferStatusInput = { expectedStatus: BuyerOfferStatusValue; to: BuyerOfferStatusValue };

export type BuyerOfferDeliveryInput = { expectedStatus: "draft" };

export function validateBuyerOfferDelivery(raw: unknown): ValidationResult<BuyerOfferDeliveryInput> {
  const body = asObject(raw);
  if (!body) return reject("A request body is required.");
  if (unknownKeys(body, ["expectedStatus"]).length) return reject("Unexpected fields were rejected.");
  if (body.expectedStatus !== "draft") return reject("Only a draft offer can be sent.");
  return { ok: true, data: { expectedStatus: "draft" } };
}

export function validateBuyerOfferStatus(raw: unknown): ValidationResult<BuyerOfferStatusInput> {
  const body = asObject(raw);
  if (!body) return reject("A request body is required.");
  if (unknownKeys(body, ["expectedStatus", "to"]).length) return reject("Unexpected fields were rejected.");
  if (!isBuyerOfferStatus(body.expectedStatus)) return reject("The current status is not recognised.");
  if (!isBuyerOfferStatus(body.to)) return reject("Choose a valid status.");
  if (body.expectedStatus === body.to) return reject("The offer is already in that status.");
  return { ok: true, data: { expectedStatus: body.expectedStatus, to: body.to } };
}
