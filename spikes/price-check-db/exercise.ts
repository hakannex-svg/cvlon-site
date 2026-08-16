import { and, eq } from "drizzle-orm";

import { civilonDbProbe } from "./schema.ts";
import { priceCheckProbeDb } from "./index.ts";

const ROLLBACK_SENTINEL = "civilon-db-probe-rollback";

export async function runCompatibilityExercise(probeKey: string) {
  const inserted = await priceCheckProbeDb
    .insert(civilonDbProbe)
    .values({ probeKey, probeValue: "inserted" })
    .returning();

  const initialRead = await priceCheckProbeDb
    .select()
    .from(civilonDbProbe)
    .where(eq(civilonDbProbe.probeKey, probeKey));

  const updated = await priceCheckProbeDb
    .update(civilonDbProbe)
    .set({ probeValue: "updated" })
    .where(eq(civilonDbProbe.probeKey, probeKey))
    .returning();

  let duplicateConstraintRejected = false;
  try {
    await priceCheckProbeDb
      .insert(civilonDbProbe)
      .values({ probeKey, probeValue: "duplicate" });
  } catch {
    duplicateConstraintRejected = true;
  }

  const rollbackKey = `${probeKey}-rollback`;
  try {
    await priceCheckProbeDb.transaction(async (tx) => {
      await tx
        .insert(civilonDbProbe)
        .values({ probeKey: rollbackKey, probeValue: "must-not-commit" });
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK_SENTINEL) {
      throw error;
    }
  }

  const rollbackRows = await priceCheckProbeDb
    .select()
    .from(civilonDbProbe)
    .where(eq(civilonDbProbe.probeKey, rollbackKey));

  const jobKey = `${probeKey}-job`;
  await priceCheckProbeDb
    .insert(civilonDbProbe)
    .values({ probeKey: jobKey, probeValue: "pending" })
    .onConflictDoNothing({ target: civilonDbProbe.probeKey });

  const firstJobAttempt = await leaseAndCompleteJob(jobKey);
  const duplicateJobAttempt = await leaseAndCompleteJob(jobKey);

  return {
    adapter: "drizzle-orm/netlify-db",
    inserted: inserted.length === 1,
    read: initialRead.length === 1 && initialRead[0]?.probeValue === "inserted",
    updated: updated.length === 1 && updated[0]?.probeValue === "updated",
    duplicateConstraintRejected,
    rollback: rollbackRows.length === 0,
    job: {
      firstAttemptCompleted: firstJobAttempt,
      duplicateAttemptSkipped: !duplicateJobAttempt,
    },
  };
}

async function leaseAndCompleteJob(jobKey: string) {
  return priceCheckProbeDb.transaction(async (tx) => {
    const leased = await tx
      .update(civilonDbProbe)
      .set({ probeValue: "leased" })
      .where(
        and(
          eq(civilonDbProbe.probeKey, jobKey),
          eq(civilonDbProbe.probeValue, "pending"),
        ),
      )
      .returning();

    if (leased.length !== 1) {
      return false;
    }

    await tx
      .update(civilonDbProbe)
      .set({ probeValue: "completed" })
      .where(
        and(
          eq(civilonDbProbe.probeKey, jobKey),
          eq(civilonDbProbe.probeValue, "leased"),
        ),
      );

    return true;
  });
}
