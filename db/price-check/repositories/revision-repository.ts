import "../server-boundary.ts";

import { eq, max } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import { priceCheckRevisions } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";

export async function createPriceCheckRevision(
  db: PriceCheckDb,
  input: {
    priceCheckId: string;
    normalizedSnapshot: Record<string, unknown>;
    changeReason: string;
    actorType: "REQUESTER" | "ADMIN" | "SYSTEM" | "WORKER";
    actorId?: string | null;
    sourceExtractionId?: string | null;
  },
) {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: max(priceCheckRevisions.version) })
      .from(priceCheckRevisions)
      .where(eq(priceCheckRevisions.priceCheckId, input.priceCheckId));
    const version = (latest?.version ?? 0) + 1;
    const [revision] = await tx
      .insert(priceCheckRevisions)
      .values({
        id: generateOrderedId(),
        priceCheckId: input.priceCheckId,
        version,
        normalizedSnapshot: input.normalizedSnapshot,
        changeReason: input.changeReason,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        sourceExtractionId: input.sourceExtractionId ?? null,
      })
      .returning();
    return revision;
  });
}
