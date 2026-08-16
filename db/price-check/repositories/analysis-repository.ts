import "../server-boundary.ts";

import { eq, max } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import {
  priceCheckAnalyses,
  priceCheckComparables,
  priceChecks,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";

export async function createAnalysisVersion(
  db: PriceCheckDb,
  input: Omit<typeof priceCheckAnalyses.$inferInsert, "id" | "version"> & {
    comparables: Array<
      Omit<typeof priceCheckComparables.$inferInsert, "analysisId" | "createdAt">
    >;
  },
) {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: max(priceCheckAnalyses.version) })
      .from(priceCheckAnalyses)
      .where(eq(priceCheckAnalyses.priceCheckId, input.priceCheckId));
    const version = (latest?.version ?? 0) + 1;
    const analysisId = generateOrderedId();
    const { comparables, ...analysisValues } = input;
    const [analysis] = await tx
      .insert(priceCheckAnalyses)
      .values({ ...analysisValues, id: analysisId, version })
      .returning();
    if (comparables.length > 0) {
      await tx.insert(priceCheckComparables).values(
        comparables.map((comparable) => ({ ...comparable, analysisId })),
      );
    }
    await tx
      .update(priceChecks)
      .set({ currentAnalysisId: analysisId, updatedAt: new Date() })
      .where(eq(priceChecks.id, input.priceCheckId));
    return analysis;
  });
}
