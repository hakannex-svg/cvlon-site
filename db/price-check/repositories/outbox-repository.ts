import "../server-boundary.ts";

import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import { notificationOutbox } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";

export async function enqueueNotification(
  db: PriceCheckDb,
  input: Omit<
    typeof notificationOutbox.$inferInsert,
    "id" | "state" | "attemptCount" | "createdAt"
  >,
) {
  const [message] = await db
    .insert(notificationOutbox)
    .values({ ...input, id: generateOrderedId() })
    .onConflictDoNothing({ target: notificationOutbox.idempotencyKey })
    .returning();
  return message ?? null;
}

export async function leaseNextNotification(
  db: PriceCheckDb,
  input: { leaseOwner: string; now: Date; leaseUntil: Date },
) {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: notificationOutbox.id })
      .from(notificationOutbox)
      .where(
        and(
          inArray(notificationOutbox.state, ["pending", "failed"]),
          lte(notificationOutbox.nextAttemptAt, input.now),
          or(
            isNull(notificationOutbox.leaseExpiresAt),
            lte(notificationOutbox.leaseExpiresAt, input.now),
          ),
        ),
      )
      .orderBy(
        asc(notificationOutbox.nextAttemptAt),
        asc(notificationOutbox.createdAt),
      )
      .limit(1);
    if (!candidate) return null;

    const [leased] = await tx
      .update(notificationOutbox)
      .set({
        state: "running",
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: input.leaseUntil,
      })
      .where(
        and(
          eq(notificationOutbox.id, candidate.id),
          inArray(notificationOutbox.state, ["pending", "failed"]),
          or(
            isNull(notificationOutbox.leaseExpiresAt),
            lte(notificationOutbox.leaseExpiresAt, input.now),
          ),
        ),
      )
      .returning();
    if (!leased) return null;
    const [counted] = await tx
      .update(notificationOutbox)
      .set({ attemptCount: leased.attemptCount + 1 })
      .where(
        and(
          eq(notificationOutbox.id, leased.id),
          eq(notificationOutbox.leaseOwner, input.leaseOwner),
          eq(notificationOutbox.state, "running"),
        ),
      )
      .returning();
    return counted ?? null;
  });
}

export async function completeNotification(
  db: PriceCheckDb,
  input: {
    id: string;
    leaseOwner: string;
    sentAt: Date;
    providerMessageId?: string | null;
  },
) {
  const [completed] = await db
    .update(notificationOutbox)
    .set({
      state: "succeeded",
      sentAt: input.sentAt,
      providerMessageId: input.providerMessageId ?? null,
      leaseOwner: null,
      leaseExpiresAt: null,
      sanitizedFailureCode: null,
    })
    .where(
      and(
        eq(notificationOutbox.id, input.id),
        eq(notificationOutbox.state, "running"),
        eq(notificationOutbox.leaseOwner, input.leaseOwner),
      ),
    )
    .returning();
  return completed ?? null;
}

export async function failNotification(
  db: PriceCheckDb,
  input: {
    id: string;
    leaseOwner: string;
    nextAttemptAt: Date;
    sanitizedFailureCode: string;
    deadLetter?: boolean;
  },
) {
  const [failed] = await db
    .update(notificationOutbox)
    .set({
      state: input.deadLetter ? "dead_letter" : "failed",
      nextAttemptAt: input.nextAttemptAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      sanitizedFailureCode: input.sanitizedFailureCode,
    })
    .where(
      and(
        eq(notificationOutbox.id, input.id),
        eq(notificationOutbox.state, "running"),
        eq(notificationOutbox.leaseOwner, input.leaseOwner),
      ),
    )
    .returning();
  return failed ?? null;
}
