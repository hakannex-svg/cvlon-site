import "../server-boundary.ts";

import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import { processingJobs } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";

export async function enqueueJob(
  db: PriceCheckDb,
  input: Omit<
    typeof processingJobs.$inferInsert,
    "id" | "state" | "attemptCount" | "createdAt"
  >,
) {
  const [job] = await db
    .insert(processingJobs)
    .values({ ...input, id: generateOrderedId() })
    .onConflictDoNothing({ target: processingJobs.idempotencyKey })
    .returning();
  return job ?? null;
}

export async function leaseNextJob(
  db: PriceCheckDb,
  input: { leaseOwner: string; now: Date; leaseUntil: Date },
) {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: processingJobs.id })
      .from(processingJobs)
      .where(
        and(
          inArray(processingJobs.state, ["pending", "failed"]),
          lte(processingJobs.nextAttemptAt, input.now),
          or(
            isNull(processingJobs.leaseExpiresAt),
            lte(processingJobs.leaseExpiresAt, input.now),
          ),
        ),
      )
      .orderBy(asc(processingJobs.nextAttemptAt), asc(processingJobs.createdAt))
      .limit(1);
    if (!candidate) return null;

    const [leased] = await tx
      .update(processingJobs)
      .set({
        state: "running",
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: input.leaseUntil,
        startedAt: input.now,
      })
      .where(
        and(
          eq(processingJobs.id, candidate.id),
          inArray(processingJobs.state, ["pending", "failed"]),
          or(
            isNull(processingJobs.leaseExpiresAt),
            lte(processingJobs.leaseExpiresAt, input.now),
          ),
        ),
      )
      .returning();
    if (!leased) return null;

    const [counted] = await tx
      .update(processingJobs)
      .set({ attemptCount: leased.attemptCount + 1 })
      .where(
        and(
          eq(processingJobs.id, leased.id),
          eq(processingJobs.leaseOwner, input.leaseOwner),
          eq(processingJobs.state, "running"),
        ),
      )
      .returning();
    return counted ?? null;
  });
}

export async function completeJob(
  db: PriceCheckDb,
  input: { id: string; leaseOwner: string; completedAt: Date },
) {
  const [completed] = await db
    .update(processingJobs)
    .set({
      state: "succeeded",
      completedAt: input.completedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      sanitizedErrorCode: null,
    })
    .where(
      and(
        eq(processingJobs.id, input.id),
        eq(processingJobs.state, "running"),
        eq(processingJobs.leaseOwner, input.leaseOwner),
      ),
    )
    .returning();
  return completed ?? null;
}

export async function failJob(
  db: PriceCheckDb,
  input: {
    id: string;
    leaseOwner: string;
    nextAttemptAt: Date;
    sanitizedErrorCode: string;
    deadLetter?: boolean;
  },
) {
  const [failed] = await db
    .update(processingJobs)
    .set({
      state: input.deadLetter ? "dead_letter" : "failed",
      nextAttemptAt: input.nextAttemptAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      sanitizedErrorCode: input.sanitizedErrorCode,
    })
    .where(
      and(
        eq(processingJobs.id, input.id),
        eq(processingJobs.state, "running"),
        eq(processingJobs.leaseOwner, input.leaseOwner),
      ),
    )
    .returning();
  return failed ?? null;
}
