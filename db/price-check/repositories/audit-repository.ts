import "../server-boundary.ts";

import type { PriceCheckDb } from "../index.ts";
import { auditEvents } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";

export async function appendAuditEvent(
  db: PriceCheckDb,
  input: Omit<typeof auditEvents.$inferInsert, "id" | "createdAt">,
) {
  const [event] = await db
    .insert(auditEvents)
    .values({ ...input, id: generateOrderedId() })
    .returning();
  return event;
}
