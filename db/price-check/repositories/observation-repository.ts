import "../server-boundary.ts";

import { and, desc, eq } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import { priceObservations } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  normalizePartNumber,
  parseMoney,
  validateCurrencyCode,
} from "../domain/normalization.ts";

export async function createAuthorizedObservation(
  db: PriceCheckDb,
  input: Omit<typeof priceObservations.$inferInsert, "id" | "normalizedPartNumber" | "unitPrice" | "currencyCode"> & {
    originalPartNumber: string;
    unitPrice: string | number;
    currencyCode: string;
  },
) {
  const [observation] = await db
    .insert(priceObservations)
    .values({
      ...input,
      id: generateOrderedId(),
      normalizedPartNumber: normalizePartNumber(input.originalPartNumber),
      unitPrice: parseMoney(input.unitPrice),
      currencyCode: validateCurrencyCode(input.currencyCode),
    })
    .returning();
  return observation;
}

export function findEligibleObservations(db: PriceCheckDb, partNumber: string) {
  return db
    .select()
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.normalizedPartNumber, normalizePartNumber(partNumber)),
        eq(priceObservations.verificationState, "VERIFIED"),
        eq(priceObservations.permittedUseState, "INTERNAL_ANALYSIS"),
      ),
    )
    .orderBy(desc(priceObservations.observationDate));
}
