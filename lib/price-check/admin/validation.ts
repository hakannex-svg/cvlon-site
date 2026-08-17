import {
  conditionCodes,
  currencyCodes,
  documentationCodes,
  transactionTypes,
} from "../contract.ts";
import type { ReviewedTransactionInput } from "../../../db/price-check/repositories/admin-repository.ts";

type ValidationResult<T> = { success: true; data: T } | { success: false; errors: Record<string, string> };

const allowedKeys = new Set([
  "originalPartNumber", "description", "quantity", "quoteOrPurchased", "transactionType",
  "conditionCode", "unitPrice", "currencyCode", "coreCharge", "coreDisposition",
  "exchangeFee", "freight", "transactionDate", "aircraftModel", "aog", "warrantyValue",
  "warrantyUnit", "warrantyText", "documentationCodes", "notes", "changeReason",
]);

const moneyPattern = /^\d{1,15}(?:\.\d{1,2})?$/;
const quantityPattern = /^\d{1,9}(?:\.\d{1,3})?$/;
const partPattern = new RegExp("^[A-Za-z0-9][A-Za-z0-9 ._/-]{1,158}$");

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nullableText(value: unknown, max: number) {
  const result = text(value, max);
  return result || null;
}

function validDate(value: string | null) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateReviewedTransaction(raw: unknown): ValidationResult<ReviewedTransactionInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { success: false, errors: { _form: "The revision could not be read." } };
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return { success: false, errors: { _form: "Unexpected revision fields were rejected." } };
  const errors: Record<string, string> = {};
  const originalPartNumber = text(record.originalPartNumber, 160);
  const quantity = text(record.quantity, 20);
  const unitPrice = text(record.unitPrice, 24);
  const currencyCode = text(record.currencyCode, 3).toUpperCase();
  const transactionType = record.transactionType;
  const conditionCode = record.conditionCode;
  const quoteOrPurchased = record.quoteOrPurchased;
  const changeReason = text(record.changeReason, 500);
  const documentation = Array.isArray(record.documentationCodes)
    ? [...new Set(record.documentationCodes.filter((code): code is string => typeof code === "string"))]
    : [];

  if (!partPattern.test(originalPartNumber)) errors.originalPartNumber = "Enter a valid aircraft part number.";
  if (!quantityPattern.test(quantity) || Number(quantity) <= 0) errors.quantity = "Quantity must be greater than zero.";
  if (!moneyPattern.test(unitPrice) || Number(unitPrice) <= 0) errors.unitPrice = "Enter a positive unit price with up to two decimals.";
  if (!currencyCodes.includes(currencyCode as typeof currencyCodes[number])) errors.currencyCode = "Choose an approved currency.";
  if (!transactionTypes.includes(transactionType as typeof transactionTypes[number])) errors.transactionType = "Choose a valid transaction type.";
  if (!conditionCodes.includes(conditionCode as typeof conditionCodes[number])) errors.conditionCode = "Choose a valid condition.";
  if (quoteOrPurchased !== "quote" && quoteOrPurchased !== "purchased") errors.quoteOrPurchased = "Choose quote or purchased.";
  if (documentation.some((code) => !documentationCodes.includes(code as typeof documentationCodes[number]))) errors.documentationCodes = "Choose valid documentation requirements.";
  if (changeReason.length < 3) errors.changeReason = "A change reason is required.";
  const transactionDate = nullableText(record.transactionDate, 10);
  if (!validDate(transactionDate)) errors.transactionDate = "Enter a valid transaction date.";
  for (const key of ["coreCharge", "exchangeFee", "freight"] as const) {
    const value = nullableText(record[key], 24);
    if (value && !moneyPattern.test(value)) errors[key] = "Use a non-negative amount with up to two decimals.";
  }
  if (Object.keys(errors).length) return { success: false, errors };

  const transactionIsExchange = transactionType === "exchange";
  return {
    success: true,
    data: {
      originalPartNumber,
      description: nullableText(record.description, 1200),
      quantity,
      quoteOrPurchased: quoteOrPurchased as ReviewedTransactionInput["quoteOrPurchased"],
      transactionType: transactionType as ReviewedTransactionInput["transactionType"],
      conditionCode: conditionCode as ReviewedTransactionInput["conditionCode"],
      unitPrice,
      currencyCode,
      coreCharge: transactionIsExchange ? nullableText(record.coreCharge, 24) : null,
      coreDisposition: transactionIsExchange && ["REFUNDABLE", "FORFEITED", "UNCLEAR", "NOT_APPLICABLE"].includes(String(record.coreDisposition)) ? record.coreDisposition as ReviewedTransactionInput["coreDisposition"] : null,
      exchangeFee: transactionIsExchange ? nullableText(record.exchangeFee, 24) : null,
      freight: nullableText(record.freight, 24),
      transactionDate,
      aircraftModel: nullableText(record.aircraftModel, 160),
      aog: record.aog === true,
      warrantyValue: nullableText(record.warrantyValue, 20),
      warrantyUnit: ["DAYS", "MONTHS", "YEARS", "HOURS", "CYCLES", "OTHER"].includes(String(record.warrantyUnit)) ? record.warrantyUnit as ReviewedTransactionInput["warrantyUnit"] : null,
      warrantyText: nullableText(record.warrantyText, 500),
      documentationCodes: documentation,
      notes: nullableText(record.notes, 2000),
      changeReason,
    },
  };
}

export function validateInformationRequest(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { success: false as const, errors: { _form: "The request could not be read." } };
  const record = raw as Record<string, unknown>;
  const allowed = new Set(["category", "customerNote", "internalNote"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { success: false as const, errors: { _form: "Unexpected fields were rejected." } };
  const category = text(record.category, 80);
  const customerNote = text(record.customerNote, 1000);
  const internalNote = text(record.internalNote, 1000);
  const errors: Record<string, string> = {};
  if (!category) errors.category = "Choose a reason category.";
  if (!customerNote) errors.customerNote = "Add the clarification requested from the customer.";
  if (Object.keys(errors).length) return { success: false as const, errors };
  return { success: true as const, data: { category, customerNote, internalNote: internalNote || null } };
}
