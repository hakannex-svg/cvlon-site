import "../server-boundary.ts";

import { sql } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import { auditEvents, notificationOutbox } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE,
  SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX,
  SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC,
  SELL_INVENTORY_FRESHNESS_CADENCE_MS,
  SELL_INVENTORY_FRESHNESS_ELIGIBLE_STATUSES,
  SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
  SELL_INVENTORY_FRESHNESS_SUBMISSION_KIND,
  type SellInventoryFreshnessCadenceCheck,
  isSellInventoryFreshnessEligibleStatus,
  isSellInventoryFreshnessSubmissionKind,
  sellInventoryFreshnessCadenceDecision,
  sellInventoryFreshnessStopResponses,
} from "../domain/sell-inventory-freshness.ts";
import {
  SELL_INVENTORY_FRESHNESS_REQUESTED_ACTION,
  SELL_INVENTORY_FRESHNESS_REVOKED_ACTION,
  SELL_SUBMISSION_AGGREGATE_TYPE,
} from "./sell-inventory-freshness-repository.ts";

/**
 * The autonomous half of bulk-inventory freshness: which records are due, and
 * the one transaction that asks about one of them.
 *
 * Deliberately a separate module from the staff-issued path. The manual
 * repository supersedes whatever it finds, live or not, and must: a staff member
 * asking again means "the link I sent is no longer the one I want answered".
 *
 * The producer here may never do that. A seller may be holding a live link at
 * the moment a timer fires, and a schedule that quietly killed it would turn an
 * honest reply into "this link cannot be used". The one existing row it may ever
 * write to is a credential that has *already expired* — and by the time the
 * 45-day cadence comes round, a 14-day link has been dead for a month, so there
 * is no such thing here as retiring one somebody could still use. That
 * retirement exists for exactly one reason: the partial unique index allows one
 * unanswered, unrevoked row per submission, and the slot has to be free before
 * the next ask can be written.
 *
 * Three things keep that narrow:
 *
 *  - the cadence rule refuses to be due at all while a live credential exists,
 *    so the retirement is never even reached for one;
 *  - the UPDATE names `expires_at <= now` itself, so a live row cannot be
 *    matched even if the rule above were wrong;
 *  - the retirement and the new ask are one transaction, so a retirement can
 *    never be left behind by an ask that did not happen.
 *
 * The source scan in the tests asserts that the only UPDATE in this file is that
 * one statement, with that predicate, because the rule is easier to state than
 * to notice missing.
 *
 * Two mechanisms keep concurrent producers, and a producer racing a staff
 * member, from ever becoming an error:
 *
 *  - `FOR UPDATE OF sell_submissions SKIP LOCKED` on the record being asked
 *    about, so two runs divide the batch rather than fight over it. A record
 *    another writer holds is left for the next run and reported as `locked`.
 *  - `ON CONFLICT ("sell_submission_id") WHERE responded_at IS NULL AND
 *    revoked_at IS NULL DO NOTHING`, which names the partial unique index that
 *    already enforces one live check per submission. The loser of a race writes
 *    nothing and reports `live_check`. A unique violation is never raised and
 *    therefore never caught: the conflict is part of the statement, not an
 *    exception handled as ordinary flow.
 *
 * The conflict target is written as raw parameterised SQL rather than through
 * the query builder because the installed Drizzle build (1.0.0-beta.22) accepts
 * `onConflictDoNothing({ target, targetWhere })` and then emits
 * `on conflict ("sell_submission_id") do nothing` — silently dropping the
 * predicate that makes the partial index inferrable. That statement does not
 * merely behave differently; Postgres refuses it outright, because no unmatched
 * index exists. The SQL here is the SQL that runs.
 *
 * No plaintext credential reaches this layer: the caller supplies a keyed hash
 * and a derivation nonce, exactly as the manual path does, and the e-mail
 * handler re-derives the credential from the nonce at send time.
 */

/**
 * Timestamps are read as epoch milliseconds rather than as driver-mapped dates.
 *
 * A raw statement's timestamps come back through whatever type parser the
 * process happens to have installed — this build's returns the Postgres text
 * form rather than a `Date` — so the cadence rule would be deciding on a parse
 * rather than on an instant. A float8 of milliseconds is exact to the
 * millisecond well beyond any date this workflow will see, and means the same
 * thing under every driver.
 */
const toDate = (value: unknown) => new Date(Number(value));
const toNullableDate = (value: unknown) =>
  value === null || value === undefined ? null : new Date(Number(value));

const statusList = sql.join(
  SELL_INVENTORY_FRESHNESS_ELIGIBLE_STATUSES.map((status) => sql`${status}`),
  sql`, `,
);
const stopResponseList = sql.join(
  sellInventoryFreshnessStopResponses.map((response) => sql`${response}`),
  sql`, `,
);

/**
 * The submissions a scheduled run may ask about, oldest-due first.
 *
 * Read-only, and a pre-filter rather than an authority: whatever this returns is
 * decided again, inside the transaction that writes, against the rows as they
 * are at that instant. The predicate is here so a scan does not have to load
 * every bulk record into memory to find the handful that are due; the rule it
 * mirrors lives in `sellInventoryFreshnessCadenceDecision`, and the tests hold
 * the two against each other over a matrix of stored states.
 *
 * Eligibility is the manual path's, unchanged and re-stated in SQL: the one
 * bulk-inventory kind, the two live statuses, a contact that confirmed its own
 * address and has not been deleted. The `verified_at` stamp on the submission is
 * deliberately not consulted — an ADMIN override sets it, and a schedule must
 * not write to an address nobody confirmed.
 *
 * The ordering is total: due date, then the date the seller submitted, then the
 * id. Two runs over the same data select the same records in the same order.
 */
export async function selectDueSellInventoryFreshnessSubmissions(
  db: PriceCheckDb,
  input: { now?: Date; limit?: number } = {},
): Promise<readonly string[]> {
  const now = input.now ?? new Date();
  // Clamped to a whole number inside the ceiling before it is bound: a limit is
  // the one value here a caller supplies, and `LIMIT` will not take a fraction
  // or a NaN.
  const requested = Number.isFinite(input.limit)
    ? Math.floor(input.limit as number)
    : SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX;
  const limit = Math.max(0, Math.min(requested, SELL_INVENTORY_FRESHNESS_CADENCE_BATCH_MAX));
  if (limit === 0) return [];
  // The cadence boundary as an instant rather than an interval: due means the
  // anchor is at or before `now - 45 days`, which is the same inclusive
  // comparison `sellInventoryFreshnessCadenceDecision` makes, off the same
  // constant, rather than a second arithmetic in the database's dialect.
  const cadenceThreshold = new Date(now.valueOf() - SELL_INVENTORY_FRESHNESS_CADENCE_MS);

  const due = await db.execute(sql`
    select s."id" as "id"
    from "sell_submissions" s
    join "marketplace_contacts" c on c."id" = s."contact_id"
    left join lateral (
      select
        k."id" as "id",
        k."issued_at" as "issued_at",
        k."responded_at" as "responded_at",
        k."response"::text as "response"
      from "sell_inventory_freshness_checks" k
      where k."sell_submission_id" = s."id"
      order by k."issued_at" desc, k."id" desc
      limit 1
    ) latest on true
    where s."submission_kind"::text = ${SELL_INVENTORY_FRESHNESS_SUBMISSION_KIND}
      and s."status"::text in (${statusList})
      and c."verification_state"::text = ${"VERIFIED"}
      and c."deleted_at" is null
      and not exists (
        select 1
        from "sell_inventory_freshness_checks" live
        where live."sell_submission_id" = s."id"
          and live."responded_at" is null
          and live."revoked_at" is null
          and live."expires_at" > ${now.toISOString()}::timestamptz
      )
      and (latest."response" is null or latest."response" not in (${stopResponseList}))
      and (
        latest."id" is null
        or coalesce(latest."responded_at", latest."issued_at") <= ${cadenceThreshold.toISOString()}::timestamptz
      )
      and (
        select count(*)::int
        from (
          select bool_and(
            k2."requested_by_admin_user_id" is null
            and k2."responded_at" is null
            and k2."expires_at" <= ${now.toISOString()}::timestamptz
          ) over (
            order by k2."issued_at" desc, k2."id" desc
            rows between unbounded preceding and current row
          ) as "lapsed_run"
          from "sell_inventory_freshness_checks" k2
          where k2."sell_submission_id" = s."id"
        ) runs
        where runs."lapsed_run"
      ) < ${SELL_INVENTORY_FRESHNESS_CADENCE_MAX_LAPSED_AUTOMATIC}
    order by
      coalesce(latest."responded_at", latest."issued_at") asc nulls first,
      s."submitted_at" asc,
      s."id" asc
    limit ${limit}
  `);

  return due.rows.map((row: Record<string, unknown>) => String(row.id));
}

export type IssueAutomaticSellInventoryFreshnessCheckInput = {
  sellSubmissionId: string;
  /** Keyed hash and derivation nonce only. The credential never reaches here. */
  keyedTokenHash: string;
  tokenDerivationNonce: string;
  expiresAt: Date;
  now?: Date;
};

export type IssueAutomaticSellInventoryFreshnessCheckOutcome =
  | {
      ok: true;
      checkId: string;
      /** The expired credential this ask retired to free the slot, if there was one. */
      retiredCheckId: string | null;
    }
  | {
      ok: false;
      reason:
        | "locked"
        | "ineligible"
        | "live_check"
        | "stop_response"
        | "lapsed_backoff"
        | "not_due";
    };

/**
 * Thrown, and caught at this function's own boundary, when the record's one
 * index slot was taken between this transaction's decision and its insert.
 *
 * It exists so a losing race writes *nothing*: the retirement of an expired
 * credential is part of asking again, and if the ask does not happen the
 * retirement must not either. Throwing rolls the whole transaction back; the
 * catch turns it into the ordinary `live_check` refusal.
 *
 * It is not a database error and carries no database error: the insert itself
 * uses `ON CONFLICT DO NOTHING`, so no unique violation is ever raised, and none
 * is ever caught and reinterpreted as success.
 */
class SellInventoryFreshnessSlotTaken extends Error {
  constructor() {
    super("SELL_INVENTORY_FRESHNESS_SLOT_TAKEN");
    this.name = "SellInventoryFreshnessSlotTaken";
  }
}

/**
 * Asks one seller, on the cadence, in one transaction.
 *
 * Everything is decided inside that transaction, under the submission's own row
 * lock, from the stored rows: the batch query's opinion is not trusted, because
 * a staff member may have issued a check, a seller may have answered one, or the
 * record may have been closed in the milliseconds since it was selected.
 * Eligibility — kind, status, contact — is re-decided there too, before anything
 * at all is written, so nothing is ever retired on a record that has stopped
 * qualifying.
 *
 * Success writes up to four rows together:
 *
 *  - the retirement of an expired standing credential, if one was holding the
 *    record's single index slot. Only ever a credential that has *already
 *    expired*: by the time the 45-day cadence comes round, a 14-day link has
 *    been dead for a month, and stamping `revoked_at` on it is bookkeeping that
 *    releases the slot rather than the withdrawal of anything a seller could
 *    use. A live credential is never touched — the cadence rule refuses to be
 *    due at all while one exists, and the retirement statement's own predicate
 *    names the expiry a second time.
 *  - the retirement's audit event, in the manual path's revoke vocabulary;
 *  - the new check;
 *  - one WORKER audit event with a null actor id, and the shared outbox message
 *    the existing minute worker delivers.
 *
 * Any failure leaves none of them. Each audit event carries ids, an expiry and
 * nothing else: no reference, no contact, no address, no part, no file, no
 * price, no location, no credential, no URL.
 *
 * Every refusal writes nothing at all and names a fixed category.
 */
export async function issueAutomaticSellInventoryFreshnessCheck(
  db: PriceCheckDb,
  input: IssueAutomaticSellInventoryFreshnessCheckInput,
): Promise<IssueAutomaticSellInventoryFreshnessCheckOutcome> {
  const now = input.now ?? new Date();
  if (input.expiresAt.valueOf() <= now.valueOf()) {
    throw new Error("SELL_INVENTORY_FRESHNESS_EXPIRY_INVALID");
  }

  try {
    return await issueAutomaticInTransaction(db, input, now);
  } catch (error) {
    if (error instanceof SellInventoryFreshnessSlotTaken) {
      return { ok: false as const, reason: "live_check" as const };
    }
    throw error;
  }
}

async function issueAutomaticInTransaction(
  db: PriceCheckDb,
  input: IssueAutomaticSellInventoryFreshnessCheckInput,
  now: Date,
): Promise<IssueAutomaticSellInventoryFreshnessCheckOutcome> {
  return db.transaction(async (tx) => {
    // The record, held for the length of this transaction. A record another
    // writer already holds is skipped rather than waited for: a scheduled run
    // has a whole batch to get through, and the next run will find it again.
    const locked = await tx.execute(sql`
      select
        s."id" as "id",
        s."contact_id" as "contact_id",
        s."status"::text as "status",
        s."submission_kind"::text as "submission_kind",
        c."verification_state"::text as "verification_state",
        c."deleted_at" as "deleted_at"
      from "sell_submissions" s
      join "marketplace_contacts" c on c."id" = s."contact_id"
      where s."id" = ${input.sellSubmissionId}
      for update of s skip locked
    `);
    const record = locked.rows[0] as {
      id: string;
      contact_id: string;
      status: string;
      submission_kind: string;
      verification_state: string;
      deleted_at: unknown;
    } | undefined;
    // No row means the record is held by another writer, or is no longer there
    // at all. Both are "not this run's to ask about", and neither is worth
    // distinguishing in a summary that carries no identifiers.
    if (!record) return { ok: false as const, reason: "locked" as const };

    if (
      !isSellInventoryFreshnessSubmissionKind(record.submission_kind)
      || !isSellInventoryFreshnessEligibleStatus(record.status)
      || record.verification_state !== "VERIFIED"
      || Boolean(record.deleted_at)
    ) {
      return { ok: false as const, reason: "ineligible" as const };
    }

    const history = await tx.execute(sql`
      select
        k."id" as "id",
        k."requested_by_admin_user_id" as "requested_by_admin_user_id",
        (extract(epoch from k."issued_at") * 1000)::float8 as "issued_at_ms",
        (extract(epoch from k."expires_at") * 1000)::float8 as "expires_at_ms",
        (extract(epoch from k."responded_at") * 1000)::float8 as "responded_at_ms",
        (extract(epoch from k."revoked_at") * 1000)::float8 as "revoked_at_ms",
        k."response"::text as "response"
      from "sell_inventory_freshness_checks" k
      where k."sell_submission_id" = ${input.sellSubmissionId}
    `);
    const checks: SellInventoryFreshnessCadenceCheck[] = history.rows.map(
      (stored: Record<string, unknown>) => ({
        id: String(stored.id),
        requestedByAdminUserId: stored.requested_by_admin_user_id === null
          ? null
          : String(stored.requested_by_admin_user_id),
        issuedAt: toDate(stored.issued_at_ms),
        expiresAt: toDate(stored.expires_at_ms),
        respondedAt: toNullableDate(stored.responded_at_ms),
        revokedAt: toNullableDate(stored.revoked_at_ms),
        response: stored.response === null ? null : String(stored.response),
      }),
    );

    const decision = sellInventoryFreshnessCadenceDecision(checks, now);
    if (!decision.due) return { ok: false as const, reason: decision.reason };

    const checkId = generateOrderedId();

    // Retire the dead credential holding the record's one index slot, if there
    // is one.
    //
    // The predicate is the whole safety argument, and it is stated in SQL rather
    // than inferred from the decision above: `expires_at <= now` means only a
    // credential that has already expired can be matched, so a live link cannot
    // be revoked by this statement even if every rule above were wrong. It runs
    // under the submission's row lock, and `updated_at` moves with `revoked_at`
    // exactly as the manual path's supersede does.
    const retired = await tx.execute(sql`
      update "sell_inventory_freshness_checks"
      set "revoked_at" = ${now.toISOString()}::timestamptz,
          "updated_at" = ${now.toISOString()}::timestamptz
      where "sell_submission_id" = ${input.sellSubmissionId}
        and "responded_at" is null
        and "revoked_at" is null
        and "expires_at" <= ${now.toISOString()}::timestamptz
      returning "id"
    `);
    const retiredCheckId = retired.rows.length === 0
      ? null
      : String((retired.rows[0] as Record<string, unknown>).id);

    if (retiredCheckId) {
      // The manual path's revoke vocabulary, under the worker's identity: the
      // same action, the same correlation shape and the same two metadata keys,
      // so one reader of the audit trail sees one kind of event whether a staff
      // member replaced a link or the schedule retired an expired one.
      await tx.insert(auditEvents).values({
        id: generateOrderedId(),
        aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
        aggregateId: input.sellSubmissionId,
        actorType: "WORKER",
        actorId: null,
        action: SELL_INVENTORY_FRESHNESS_REVOKED_ACTION,
        correlationId: `sell-inventory-freshness:${checkId}`,
        sanitizedMetadata: {
          inventoryFreshnessCheckId: retiredCheckId,
          supersededByCheckId: checkId,
        },
        createdAt: now,
      });
    }

    // The conflict target names the partial unique index by its own predicate.
    // A concurrent writer that got there first — another producer, or a staff
    // member issuing by hand — takes the row, and this statement writes nothing
    // and raises nothing.
    const inserted = await tx.execute(sql`
      insert into "sell_inventory_freshness_checks" (
        "id", "sell_submission_id", "contact_id", "keyed_token_hash",
        "token_derivation_nonce", "requested_by_admin_user_id",
        "issued_at", "expires_at", "created_at", "updated_at"
      )
      values (
        ${checkId},
        ${input.sellSubmissionId},
        ${record.contact_id},
        ${input.keyedTokenHash},
        ${input.tokenDerivationNonce},
        null,
        ${now.toISOString()}::timestamptz,
        ${input.expiresAt.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz
      )
      on conflict ("sell_submission_id")
        where "responded_at" is null and "revoked_at" is null
      do nothing
      returning "id"
    `);
    // Someone else took the slot between the decision and this insert. Nothing
    // is issued — and because the retirement above belongs to an ask that is not
    // going to happen, the whole transaction is rolled back rather than leaving
    // a credential retired for nobody.
    if (inserted.rows.length === 0) throw new SellInventoryFreshnessSlotTaken();

    // WORKER with a null actor id: nobody asked for this one. That pairing is
    // the whole of the automatic/manual distinction in the audit trail, and it
    // matches `requested_by_admin_user_id` being null on the check itself.
    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: input.sellSubmissionId,
      actorType: "WORKER",
      actorId: null,
      action: SELL_INVENTORY_FRESHNESS_REQUESTED_ACTION,
      correlationId: `sell-inventory-freshness:${checkId}`,
      sanitizedMetadata: {
        inventoryFreshnessCheckId: checkId,
        expiresAt: input.expiresAt.toISOString(),
      },
      createdAt: now,
    });

    // The same message type, aggregate, template and idempotency key the manual
    // path enqueues, so the existing minute worker and the existing handler
    // deliver an automatic check without knowing it is one.
    const [message] = await tx
      .insert(notificationOutbox)
      .values({
        id: generateOrderedId(),
        messageType: SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
        aggregateType: SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE,
        aggregateId: checkId,
        recipientReference: record.contact_id,
        templateVersion: "sell-inventory-freshness-v1",
        idempotencyKey: `sell-inventory-freshness:${checkId}:v1`,
        nextAttemptAt: now,
        createdAt: now,
      })
      .onConflictDoNothing({ target: notificationOutbox.idempotencyKey })
      .returning({ id: notificationOutbox.id });
    // The check id is minted in this transaction, so a collision here is not a
    // race that can be tolerated — it is an invariant that has already broken,
    // and rolling the whole transaction back is the only honest answer.
    if (!message) throw new Error("SELL_INVENTORY_FRESHNESS_NOT_ENQUEUED");

    return { ok: true as const, checkId, retiredCheckId };
  });
}
