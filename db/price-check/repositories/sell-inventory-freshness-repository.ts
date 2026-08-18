import "../server-boundary.ts";

import { and, eq, inArray, isNull } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import {
  auditEvents,
  marketplaceContacts,
  notificationOutbox,
  sellInventoryFreshnessChecks,
  sellSubmissions,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE,
  SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
  isSellInventoryFreshnessEligibleStatus,
  isSellInventoryFreshnessResponse,
  isSellInventoryFreshnessSubmissionKind,
  type SellInventoryFreshnessResponse,
} from "../domain/sell-inventory-freshness.ts";

/**
 * Staff-issued bulk-inventory freshness checks, and the seller's account-free
 * answer.
 *
 * Two transactions carry the whole workflow, and both are all-or-nothing:
 *
 *  - `issueSellInventoryFreshnessCheck` revokes any earlier live credential,
 *    writes the new one, records the audit event and enqueues the seller e-mail
 *    together. A failure anywhere leaves the previous credential live and no
 *    mail queued, rather than a seller holding a dead link or a check nobody was
 *    told about.
 *  - `recordSellInventoryFreshnessResponse` consumes the credential and writes
 *    the answer under a predicate that names the credential's own unanswered
 *    state, so two concurrent presses cannot both succeed.
 *
 * No plaintext credential reaches this layer in either direction: the caller
 * supplies a keyed hash and a derivation nonce, and the e-mail handler
 * re-derives the credential from the nonce at send time.
 *
 * Nothing here changes a Sell Submission's status, its business review, its
 * evidence review, or any certification, authenticity, airworthiness or
 * regulatory position, and nothing here obliges Civilon to buy. A response is
 * the seller's own statement and is stored as exactly that.
 */

export {
  SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE,
  SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
} from "../domain/sell-inventory-freshness.ts";
export const SELL_SUBMISSION_AGGREGATE_TYPE = "sell_submission";

/**
 * Why a queued freshness e-mail was terminalised without being sent. Recorded on
 * the outbox row so a staff or operational reader sees a cancellation rather
 * than an unexplained dead letter.
 */
export const SELL_INVENTORY_FRESHNESS_SUPERSEDED_CODE = "SELL_INVENTORY_FRESHNESS_SUPERSEDED";

export const SELL_INVENTORY_FRESHNESS_REQUESTED_ACTION = "SELL_SUBMISSION_INVENTORY_FRESHNESS_REQUESTED";
export const SELL_INVENTORY_FRESHNESS_REVOKED_ACTION = "SELL_SUBMISSION_INVENTORY_FRESHNESS_REVOKED";
export const SELL_INVENTORY_FRESHNESS_RESPONDED_ACTION = "SELL_SUBMISSION_INVENTORY_FRESHNESS_RESPONDED";

export type IssueSellInventoryFreshnessCheckInput = {
  sellSubmissionId: string;
  /** Keyed hash and derivation nonce only. The credential never reaches here. */
  keyedTokenHash: string;
  tokenDerivationNonce: string;
  expiresAt: Date;
  actor: { id: string };
  now?: Date;
};

export type IssueSellInventoryFreshnessCheckOutcome =
  | {
      ok: true;
      data: {
        checkId: string;
        expiresAt: Date;
        supersededCheckId: string | null;
      };
    }
  /** No such Sell Submission. */
  | { ok: false; reason: "not_found" }
  /** A single-part record. Freshness is a question about a list of things. */
  | { ok: false; reason: "not_bulk_inventory"; submissionKind: string }
  /** The record is not in a status on which Civilon asks the seller anything. */
  | { ok: false; reason: "ineligible_status"; currentStatus: string }
  /** No usable verified seller contact to send the check to. */
  | { ok: false; reason: "contact_unverified" };

/**
 * Issues one scoped freshness credential for one bulk-inventory Sell Submission.
 *
 * Three eligibility rules, all decided against the stored record inside the
 * transaction rather than from anything a browser sent:
 *
 *  - The submission kind must be `bulk_inventory`. "Is your inventory still
 *    available" is not a question about one part, and asking it of a single-part
 *    record would read as a form letter.
 *  - The status must be `verified` or `under_review`. A record still awaiting the
 *    seller's own e-mail confirmation has no confirmed address; an accepted,
 *    declined, closed, withdrawn or spam record has already been concluded. None
 *    of those statuses is changed by the refusal — the record is left exactly as
 *    it was found.
 *  - The seller contact must be VERIFIED and not deleted. That is deliberately
 *    the *contact* record, not the submission's `verified_at`, which the schema
 *    also stamps when an ADMIN performs the operational verification override:
 *    e-mailing a supplier on the strength of a staff override would mean writing
 *    to an address nobody ever confirmed.
 */
export async function issueSellInventoryFreshnessCheck(
  db: PriceCheckDb,
  input: IssueSellInventoryFreshnessCheckInput,
): Promise<IssueSellInventoryFreshnessCheckOutcome> {
  const now = input.now ?? new Date();
  if (input.expiresAt.valueOf() <= now.valueOf()) {
    throw new Error("SELL_INVENTORY_FRESHNESS_EXPIRY_INVALID");
  }

  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({
        id: sellSubmissions.id,
        status: sellSubmissions.status,
        submissionKind: sellSubmissions.submissionKind,
        contactId: sellSubmissions.contactId,
        contactVerificationState: marketplaceContacts.verificationState,
        contactDeletedAt: marketplaceContacts.deletedAt,
      })
      .from(sellSubmissions)
      .innerJoin(marketplaceContacts, eq(sellSubmissions.contactId, marketplaceContacts.id))
      .where(eq(sellSubmissions.id, input.sellSubmissionId))
      .limit(1);
    if (!record) return { ok: false as const, reason: "not_found" as const };
    if (!isSellInventoryFreshnessSubmissionKind(record.submissionKind)) {
      return {
        ok: false as const,
        reason: "not_bulk_inventory" as const,
        submissionKind: record.submissionKind,
      };
    }
    if (!isSellInventoryFreshnessEligibleStatus(record.status)) {
      return {
        ok: false as const,
        reason: "ineligible_status" as const,
        currentStatus: record.status,
      };
    }
    if (record.contactVerificationState !== "VERIFIED" || record.contactDeletedAt) {
      return { ok: false as const, reason: "contact_unverified" as const };
    }

    // Supersede first. The partial unique index allows exactly one live check
    // per submission, so this is not a courtesy — a second live credential
    // cannot be written while an earlier one stands, and revoking it here is
    // what makes the earlier emailed link stop working the moment a new one is
    // issued.
    const [superseded] = await tx
      .update(sellInventoryFreshnessChecks)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(
        eq(sellInventoryFreshnessChecks.sellSubmissionId, input.sellSubmissionId),
        isNull(sellInventoryFreshnessChecks.respondedAt),
        isNull(sellInventoryFreshnessChecks.revokedAt),
      ))
      .returning({ id: sellInventoryFreshnessChecks.id });

    const checkId = generateOrderedId();
    await tx.insert(sellInventoryFreshnessChecks).values({
      id: checkId,
      sellSubmissionId: input.sellSubmissionId,
      contactId: record.contactId,
      keyedTokenHash: input.keyedTokenHash,
      tokenDerivationNonce: input.tokenDerivationNonce,
      requestedByAdminUserId: input.actor.id,
      issuedAt: now,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    if (superseded) {
      // The superseded check's own e-mail, if it has not gone out yet.
      //
      // Revoking the check already makes the handler refuse to load it, so
      // nothing can send a live link for a dead credential — but a message left
      // `pending` would be leased, refused and rescheduled on every drain until
      // it exhausted its attempts. Terminalising it here, in the same
      // transaction that revokes the credential, turns that retry storm into one
      // recorded cancellation.
      //
      // Only `pending` and `failed` are touched. A `running` row belongs to a
      // worker that holds the lease, and taking it would break the lease
      // predicate that worker completes under; that message refuses to load and
      // fails honestly on its own. A `succeeded` row is history and is never
      // rewritten.
      await tx
        .update(notificationOutbox)
        .set({
          state: "dead_letter",
          leaseOwner: null,
          leaseExpiresAt: null,
          sanitizedFailureCode: SELL_INVENTORY_FRESHNESS_SUPERSEDED_CODE,
        })
        .where(and(
          eq(notificationOutbox.aggregateType, SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE),
          eq(notificationOutbox.aggregateId, superseded.id),
          eq(notificationOutbox.messageType, SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE),
          inArray(notificationOutbox.state, ["pending", "failed"]),
        ));

      await tx.insert(auditEvents).values({
        id: generateOrderedId(),
        aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
        aggregateId: input.sellSubmissionId,
        actorType: "ADMIN",
        actorId: input.actor.id,
        action: SELL_INVENTORY_FRESHNESS_REVOKED_ACTION,
        correlationId: `sell-inventory-freshness:${checkId}`,
        sanitizedMetadata: {
          inventoryFreshnessCheckId: superseded.id,
          supersededByCheckId: checkId,
        },
        createdAt: now,
      });
    }

    // Check id and expiry. Never the credential, never the URL, never the
    // seller's address, and nothing about the inventory itself.
    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: input.sellSubmissionId,
      actorType: "ADMIN",
      actorId: input.actor.id,
      action: SELL_INVENTORY_FRESHNESS_REQUESTED_ACTION,
      correlationId: `sell-inventory-freshness:${checkId}`,
      sanitizedMetadata: {
        inventoryFreshnessCheckId: checkId,
        expiresAt: input.expiresAt.toISOString(),
      },
      createdAt: now,
    });

    const [message] = await tx
      .insert(notificationOutbox)
      .values({
        id: generateOrderedId(),
        messageType: SELL_INVENTORY_FRESHNESS_MESSAGE_TYPE,
        aggregateType: SELL_INVENTORY_FRESHNESS_AGGREGATE_TYPE,
        aggregateId: checkId,
        recipientReference: record.contactId,
        templateVersion: "sell-inventory-freshness-v1",
        idempotencyKey: `sell-inventory-freshness:${checkId}:v1`,
        nextAttemptAt: now,
        createdAt: now,
      })
      .onConflictDoNothing({ target: notificationOutbox.idempotencyKey })
      .returning({ id: notificationOutbox.id });
    if (!message) throw new Error("SELL_INVENTORY_FRESHNESS_NOT_ENQUEUED");

    return {
      ok: true as const,
      data: {
        checkId,
        expiresAt: input.expiresAt,
        supersededCheckId: superseded?.id ?? null,
      },
    };
  });
}

/**
 * Everything the seller e-mail is allowed to know: where to send it, the Civilon
 * reference, the live credential's nonce and its expiry.
 *
 * No part number, quantity, price, currency, location, warehouse, line count,
 * inventory detail, filename, document content or company name is selected here,
 * so the template cannot leak what it was never handed.
 */
export async function loadSellInventoryFreshnessDelivery(
  db: PriceCheckDb,
  checkId: string,
  now = new Date(),
) {
  const [record] = await db
    .select({
      checkId: sellInventoryFreshnessChecks.id,
      sellSubmissionId: sellInventoryFreshnessChecks.sellSubmissionId,
      publicReference: sellSubmissions.publicReference,
      businessEmail: marketplaceContacts.businessEmail,
      tokenDerivationNonce: sellInventoryFreshnessChecks.tokenDerivationNonce,
      expiresAt: sellInventoryFreshnessChecks.expiresAt,
      respondedAt: sellInventoryFreshnessChecks.respondedAt,
      revokedAt: sellInventoryFreshnessChecks.revokedAt,
    })
    .from(sellInventoryFreshnessChecks)
    .innerJoin(sellSubmissions, eq(sellInventoryFreshnessChecks.sellSubmissionId, sellSubmissions.id))
    .innerJoin(marketplaceContacts, and(
      eq(sellInventoryFreshnessChecks.contactId, marketplaceContacts.id),
      eq(sellSubmissions.contactId, marketplaceContacts.id),
    ))
    .where(eq(sellInventoryFreshnessChecks.id, checkId))
    .limit(1);
  if (!record) throw new Error("SELL_INVENTORY_FRESHNESS_UNAVAILABLE");
  // A check that has since been superseded, answered or expired must not be
  // mailed: the link in that message would be dead on arrival. The dispatcher
  // retries and then dead-letters, which is the honest outcome.
  if (record.respondedAt || record.revokedAt || record.expiresAt.valueOf() <= now.valueOf()) {
    throw new Error("SELL_INVENTORY_FRESHNESS_UNAVAILABLE");
  }
  return record;
}

export type SellInventoryFreshnessSnapshot = {
  checkId: string;
  sellSubmissionId: string;
  publicReference: string;
  expiresAt: Date;
};

/**
 * Resolves a live credential to exactly what the seller page may render.
 *
 * Read-only and non-consuming: opening the page must not spend a single-use
 * credential, because corporate mail scanners, link previewers and browser
 * prefetchers all follow emailed links. Every rejection returns `null`, so a
 * caller guessing credentials learns nothing about which submissions exist.
 */
export async function findLiveSellInventoryFreshnessCheck(
  db: PriceCheckDb,
  input: { keyedTokenHash: string; now?: Date },
): Promise<SellInventoryFreshnessSnapshot | null> {
  const now = input.now ?? new Date();
  const [record] = await db
    .select({
      checkId: sellInventoryFreshnessChecks.id,
      sellSubmissionId: sellInventoryFreshnessChecks.sellSubmissionId,
      contactId: sellInventoryFreshnessChecks.contactId,
      submissionContactId: sellSubmissions.contactId,
      publicReference: sellSubmissions.publicReference,
      status: sellSubmissions.status,
      submissionKind: sellSubmissions.submissionKind,
      expiresAt: sellInventoryFreshnessChecks.expiresAt,
      respondedAt: sellInventoryFreshnessChecks.respondedAt,
      revokedAt: sellInventoryFreshnessChecks.revokedAt,
      attemptCount: sellInventoryFreshnessChecks.attemptCount,
      maxAttemptCount: sellInventoryFreshnessChecks.maxAttemptCount,
    })
    .from(sellInventoryFreshnessChecks)
    .innerJoin(sellSubmissions, eq(sellInventoryFreshnessChecks.sellSubmissionId, sellSubmissions.id))
    .where(eq(sellInventoryFreshnessChecks.keyedTokenHash, input.keyedTokenHash))
    .limit(1);
  if (!record) return null;
  if (record.respondedAt || record.revokedAt) return null;
  if (record.expiresAt.valueOf() <= now.valueOf()) return null;
  if (record.attemptCount >= record.maxAttemptCount) return null;
  // The credential must still name a record Civilon would ask about today. A
  // submission closed after the link went out is not one a seller should be
  // answering questions on.
  if (!isSellInventoryFreshnessEligibleStatus(record.status)) return null;
  if (!isSellInventoryFreshnessSubmissionKind(record.submissionKind)) return null;
  // The credential must name exactly this submission's contact. A mismatch is a
  // malformed row, never an opportunity.
  if (record.contactId !== record.submissionContactId) return null;
  return {
    checkId: record.checkId,
    sellSubmissionId: record.sellSubmissionId,
    publicReference: record.publicReference,
    expiresAt: record.expiresAt,
  };
}

export type RecordSellInventoryFreshnessResponseOutcome =
  | { outcome: "recorded"; checkId: string; reference: string }
  | { outcome: "unavailable" };

/**
 * Records the seller's answer against one live credential, in one transaction.
 *
 * Every rejection path returns the same opaque `unavailable`, so a caller
 * guessing credentials never learns whether another submission exists, whether a
 * credential belongs to someone else, or which of the checks refused them.
 *
 * Replay is refused uniformly, including a repeat of the *same* answer from the
 * same spent credential. Making that one case idempotent would mean answering
 * "does this credential's stored response equal the one you just sent?" to
 * whoever presents a spent credential, which is a comparison oracle against a
 * three-value space: a holder of a used link could learn the seller's answer by
 * trying each value and watching which one stopped refusing. The seller-visible
 * cost is that a double-press after a successful answer shows the ordinary
 * "this link cannot be used" panel; the page therefore drops the credential the
 * moment an answer is accepted, so an honest double-press never reaches here.
 *
 * The answer is written under a predicate that names the credential's own
 * unanswered, unrevoked state and its own attempt count, so two concurrent
 * presses cannot both succeed.
 */
export async function recordSellInventoryFreshnessResponse(
  db: PriceCheckDb,
  input: {
    keyedTokenHash: string;
    response: SellInventoryFreshnessResponse;
    now?: Date;
  },
): Promise<RecordSellInventoryFreshnessResponseOutcome> {
  const now = input.now ?? new Date();
  // Normalised at the boundary rather than merely validated upstream: a direct
  // caller must not be able to store a value outside the three the seller was
  // shown, and the database enum is the last line rather than the only one.
  if (!isSellInventoryFreshnessResponse(input.response)) return { outcome: "unavailable" };

  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({
        check: sellInventoryFreshnessChecks,
        submission: sellSubmissions,
      })
      .from(sellInventoryFreshnessChecks)
      .innerJoin(sellSubmissions, eq(sellInventoryFreshnessChecks.sellSubmissionId, sellSubmissions.id))
      .where(eq(sellInventoryFreshnessChecks.keyedTokenHash, input.keyedTokenHash))
      .limit(1);
    if (!record) return { outcome: "unavailable" as const };

    const { check, submission } = record;
    if (check.respondedAt || check.revokedAt) return { outcome: "unavailable" as const };
    if (check.expiresAt.valueOf() <= now.valueOf()) return { outcome: "unavailable" as const };
    if (check.attemptCount + 1 > check.maxAttemptCount) return { outcome: "unavailable" as const };
    // The credential must name exactly this submission and exactly this
    // submission's contact.
    if (check.sellSubmissionId !== submission.id) return { outcome: "unavailable" as const };
    if (check.contactId !== submission.contactId) return { outcome: "unavailable" as const };
    if (!isSellInventoryFreshnessEligibleStatus(submission.status)) {
      return { outcome: "unavailable" as const };
    }
    if (!isSellInventoryFreshnessSubmissionKind(submission.submissionKind)) {
      return { outcome: "unavailable" as const };
    }

    const [answered] = await tx
      .update(sellInventoryFreshnessChecks)
      .set({
        respondedAt: now,
        response: input.response,
        attemptCount: check.attemptCount + 1,
        updatedAt: now,
      })
      .where(and(
        eq(sellInventoryFreshnessChecks.id, check.id),
        eq(sellInventoryFreshnessChecks.attemptCount, check.attemptCount),
        isNull(sellInventoryFreshnessChecks.respondedAt),
        isNull(sellInventoryFreshnessChecks.revokedAt),
      ))
      .returning({ id: sellInventoryFreshnessChecks.id });
    if (!answered) return { outcome: "unavailable" as const };

    // The check id, the response code and the moment it arrived. Never an
    // inventory detail, never a filename, never the seller's address, and
    // nothing about what Civilon concludes from the answer — because Civilon
    // concludes nothing from it automatically.
    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: submission.id,
      actorType: "REQUESTER",
      actorId: submission.contactId,
      action: SELL_INVENTORY_FRESHNESS_RESPONDED_ACTION,
      correlationId: `sell-inventory-freshness:${check.id}`,
      sanitizedMetadata: {
        inventoryFreshnessCheckId: check.id,
        response: input.response,
        respondedAt: now.toISOString(),
      },
      createdAt: now,
    });

    return {
      outcome: "recorded" as const,
      checkId: check.id,
      reference: submission.publicReference,
    };
  });
}

/**
 * Completes one freshness outbox row under the caller's lease. Losing the lease
 * is an error, not a silent success, so a message cannot be marked sent by a
 * worker that no longer owns it.
 */
export async function markSellInventoryFreshnessNotificationSucceeded(
  db: PriceCheckDb,
  input: {
    checkId: string;
    sellSubmissionId: string;
    notificationId: string;
    messageType: string;
    leaseOwner: string;
    providerMessageId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [completed] = await tx
      .update(notificationOutbox)
      .set({
        state: "succeeded",
        sentAt: now,
        providerMessageId: input.providerMessageId,
        leaseOwner: null,
        leaseExpiresAt: null,
        sanitizedFailureCode: null,
      })
      .where(and(
        eq(notificationOutbox.id, input.notificationId),
        eq(notificationOutbox.aggregateId, input.checkId),
        eq(notificationOutbox.messageType, input.messageType),
        eq(notificationOutbox.state, "running"),
        eq(notificationOutbox.leaseOwner, input.leaseOwner),
      ))
      .returning({ id: notificationOutbox.id });
    if (!completed) throw new Error("SELL_INVENTORY_FRESHNESS_DELIVERY_LEASE_LOST");

    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: input.sellSubmissionId,
      actorType: "WORKER",
      actorId: null,
      action: "SELL_SUBMISSION_NOTIFICATION_SENT",
      correlationId: `sell-inventory-freshness-notification:${input.notificationId}`,
      sanitizedMetadata: {
        messageType: input.messageType,
        provider: "postmark",
        inventoryFreshnessCheckId: input.checkId,
      },
      createdAt: now,
    });
  });
}

/**
 * Records a delivery failure against the freshness check.
 *
 * The submission id is resolved from the check rather than trusted from the
 * caller, and a check that no longer resolves simply records nothing: a failure
 * note is not worth inventing an aggregate for.
 */
export async function recordSellInventoryFreshnessNotificationFailure(
  db: PriceCheckDb,
  input: {
    checkId: string;
    notificationId: string;
    messageType: string;
    code: string;
    deadLetter: boolean;
    now?: Date;
  },
) {
  const [record] = await db
    .select({ sellSubmissionId: sellInventoryFreshnessChecks.sellSubmissionId })
    .from(sellInventoryFreshnessChecks)
    .where(eq(sellInventoryFreshnessChecks.id, input.checkId))
    .limit(1);
  if (!record) return;
  await db.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
    aggregateId: record.sellSubmissionId,
    actorType: "WORKER",
    actorId: null,
    action: "SELL_SUBMISSION_NOTIFICATION_FAILED",
    correlationId: `sell-inventory-freshness-notification:${input.notificationId}`,
    sanitizedMetadata: {
      messageType: input.messageType,
      code: input.code,
      deadLetter: input.deadLetter,
      inventoryFreshnessCheckId: input.checkId,
    },
    createdAt: input.now ?? new Date(),
  });
}
