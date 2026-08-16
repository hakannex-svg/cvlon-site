import "../server-boundary.ts";

import type { PriceCheckDb } from "../index.ts";
import { sourcingOpportunities } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";

export async function createSourcingOpportunity(
  db: PriceCheckDb,
  input: Omit<typeof sourcingOpportunities.$inferInsert, "id" | "createdAt" | "updatedAt">,
) {
  const [opportunity] = await db
    .insert(sourcingOpportunities)
    .values({ ...input, id: generateOrderedId() })
    .onConflictDoNothing({ target: sourcingOpportunities.sourceResultId })
    .returning();
  return opportunity ?? null;
}
