import "../../db/price-check/server-boundary.ts";

import type { PriceCheckDb } from "../../db/price-check/index.ts";
import {
  loadBuyerOfferCustomerRecord,
  recordBuyerOfferResponse,
} from "../../db/price-check/repositories/buyer-offer-repository.ts";
import { buildBuyerOfferSnapshot } from "./buyer-offer-snapshot.ts";
import {
  buyerOfferTokenMatches,
  parseBuyerOfferToken,
} from "./buyer-offer-token.ts";
import type { BuyerOfferDecision } from "./buyer-offer-contract.ts";

function snapshot(record: NonNullable<Awaited<ReturnType<typeof loadBuyerOfferCustomerRecord>>>) {
  return buildBuyerOfferSnapshot({
    reference: record.reference,
    version: record.version,
    saleUnitPrice: record.civilonSaleUnitPrice,
    currencyCode: record.currencyCode,
    quantity: record.quantity,
    statedCondition: record.statedCondition,
    documentsSummary: record.documentsSummary,
    deliveryOption: record.deliveryOption,
    shippingAndExportScope: record.shippingAndExportScope,
    leadTimeDays: record.leadTimeDays,
    expiresAt: record.expiresAt,
  });
}

async function authenticatedRecord(db: PriceCheckDb, token: string, tokenKey: string, now: Date) {
  const parsed = parseBuyerOfferToken(token);
  if (!parsed) return null;
  const record = await loadBuyerOfferCustomerRecord(db, parsed.buyerOfferId, now);
  if (!record) return null;
  const binding = {
    buyerOfferId: record.buyerOfferId,
    version: record.version,
    sentAt: record.sentAt,
    expiresAt: record.expiresAt,
  };
  if (!buyerOfferTokenMatches(tokenKey, binding, token)) return null;
  return { record, binding };
}

export async function viewBuyerOffer(
  db: PriceCheckDb,
  input: { token: string; tokenKey: string; now?: Date },
) {
  const authenticated = await authenticatedRecord(db, input.token, input.tokenKey, input.now ?? new Date());
  if (!authenticated) return { outcome: "unavailable" as const };
  return {
    outcome: "available" as const,
    offer: snapshot(authenticated.record),
    status: authenticated.record.status === "sent" ? "awaiting_response" as const : authenticated.record.status,
  };
}

export async function respondToBuyerOffer(
  db: PriceCheckDb,
  input: { token: string; tokenKey: string; decision: BuyerOfferDecision; now?: Date },
) {
  const now = input.now ?? new Date();
  const authenticated = await authenticatedRecord(db, input.token, input.tokenKey, now);
  if (!authenticated) return { outcome: "unavailable" as const };
  return recordBuyerOfferResponse(db, {
    ...authenticated.binding,
    decision: input.decision,
    now,
  });
}
