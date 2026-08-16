import "../server-boundary.ts";

import { and, eq, isNull, max } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import { priceCheckResults, priceChecks } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";

export async function createApprovedResultVersion(
  db: PriceCheckDb,
  input: Omit<typeof priceCheckResults.$inferInsert, "id" | "version" | "createdAt">,
) {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: max(priceCheckResults.version) })
      .from(priceCheckResults)
      .where(eq(priceCheckResults.priceCheckId, input.priceCheckId));
    const version = (latest?.version ?? 0) + 1;
    const now = new Date();
    await tx
      .update(priceCheckResults)
      .set({ supersededAt: now })
      .where(
        and(
          eq(priceCheckResults.priceCheckId, input.priceCheckId),
          isNull(priceCheckResults.supersededAt),
        ),
      );
    const [result] = await tx
      .insert(priceCheckResults)
      .values({ ...input, id: generateOrderedId(), version })
      .returning();
    await tx
      .update(priceChecks)
      .set({ currentResultId: result.id, updatedAt: now })
      .where(eq(priceChecks.id, input.priceCheckId));
    return result;
  });
}
