import {
  BUYER_OFFER_DISCLOSURE,
  type BuyerOfferDeliveryOption,
} from "../../db/price-check/domain/buyer-offer-policy.ts";

/**
 * The buyer-facing shape of a Civilon offer.
 *
 * A pure function with a frozen key set. It is the only offer object accepted
 * by the customer email and public response surface, so neither can receive
 * supplier identity, supplier cost, supplier documents, internal routing, or
 * the internal `selected_supplier_response_id` pointer.
 *
 * The key set is the guarantee. A test freezes it and compares exactly, so
 * adding a field here is a deliberate, visible act rather than a mistake.
 */

export const BUYER_OFFER_SNAPSHOT_KEYS = Object.freeze([
  "reference",
  "version",
  "saleUnitPrice",
  "currencyCode",
  "quantity",
  "statedCondition",
  "documentsSummary",
  "deliveryOption",
  "shippingAndExportScope",
  "leadTimeDays",
  "expiresAt",
  "disclosure",
] as const);

export type BuyerOfferSnapshotKey = (typeof BUYER_OFFER_SNAPSHOT_KEYS)[number];

export type BuyerOfferSnapshot = {
  /** The Buy Request's public reference. Never an internal id. */
  reference: string;
  version: number;
  saleUnitPrice: string;
  currencyCode: string;
  quantity: string;
  statedCondition: string | null;
  documentsSummary: string | null;
  deliveryOption: BuyerOfferDeliveryOption;
  shippingAndExportScope: string | null;
  leadTimeDays: number | null;
  expiresAt: string | null;
  disclosure: string;
};

/**
 * Builds the buyer-facing snapshot.
 *
 * Takes only the fields it emits. It cannot leak a supplier field because it is
 * never handed one: the parameter type has no supplier property, and the
 * function reads nothing else.
 */
export function buildBuyerOfferSnapshot(input: {
  reference: string;
  version: number;
  saleUnitPrice: string;
  currencyCode: string;
  quantity: string;
  statedCondition: string | null;
  documentsSummary: string | null;
  deliveryOption: BuyerOfferDeliveryOption;
  shippingAndExportScope: string | null;
  leadTimeDays: number | null;
  expiresAt: Date | null;
}): Readonly<BuyerOfferSnapshot> {
  return Object.freeze({
    reference: input.reference,
    version: input.version,
    saleUnitPrice: input.saleUnitPrice,
    currencyCode: input.currencyCode,
    quantity: input.quantity,
    statedCondition: input.statedCondition,
    documentsSummary: input.documentsSummary,
    deliveryOption: input.deliveryOption,
    shippingAndExportScope: input.shippingAndExportScope,
    leadTimeDays: input.leadTimeDays,
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    disclosure: BUYER_OFFER_DISCLOSURE,
  });
}
