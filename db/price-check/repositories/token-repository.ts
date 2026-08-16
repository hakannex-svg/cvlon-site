import "../server-boundary.ts";

import type { PriceCheckDb } from "../index.ts";
import { resultAccessTokens } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";

export async function createResultAccessTokenMetadata(
  db: PriceCheckDb,
  input: Omit<typeof resultAccessTokens.$inferInsert, "id">,
) {
  const [token] = await db
    .insert(resultAccessTokens)
    .values({ ...input, id: generateOrderedId() })
    .returning();
  return token;
}
