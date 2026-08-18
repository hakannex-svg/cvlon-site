import "../server-boundary.ts";

import { and, eq, inArray, isNull } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import {
  auditEvents,
  marketplaceAttachments,
  marketplaceContacts,
  marketplaceEvidenceRequests,
  marketplacePendingUploads,
  notificationOutbox,
  sellSubmissions,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  isSellEvidenceRequestCategory,
  type SellEvidenceRequestCategory,
} from "../domain/sell-evidence-request.ts";

/**
 * Staff-issued follow-up evidence requests, and the seller's account-free reply.
 *
 * Two transactions carry the whole workflow, and both are all-or-nothing:
 *
 *  - `issueSellEvidenceRequest` revokes any earlier live credential, writes the
 *    new one, records the audit event and enqueues the seller e-mail together.
 *    A failure anywhere leaves the previous credential live and no mail queued,
 *    rather than a seller holding a dead link or a request nobody was told about.
 *  - `redeemSellEvidenceRequest` consumes the credential, claims every pending
 *    upload, binds every attachment and records every audit row together. A
 *    partially valid batch binds nothing.
 *
 * No plaintext credential reaches this layer in either direction: the caller
 * supplies a keyed hash and a derivation nonce, and the e-mail handler re-derives
 * the credential from the nonce at send time.
 *
 * Nothing here writes a listing, a publication, a certification, an
 * airworthiness or regulatory approval, a supplier approval, or an authenticity
 * or fitness guarantee. Evidence arrives as private staff-reviewable files in
 * the existing `not_reviewed` state and nothing more.
 */

export const SELL_EVIDENCE_REQUEST_MESSAGE_TYPE = "SELL_SUBMISSION_EVIDENCE_REQUEST";
export const SELL_EVIDENCE_REQUEST_AGGREGATE_TYPE = "sell_evidence_request";
export const SELL_SUBMISSION_AGGREGATE_TYPE = "sell_submission";

export const SELL_EVIDENCE_REQUESTED_ACTION = "SELL_SUBMISSION_EVIDENCE_REQUESTED";
export const SELL_EVIDENCE_REVOKED_ACTION = "SELL_SUBMISSION_EVIDENCE_REQUEST_REVOKED";
export const SELL_EVIDENCE_SUBMITTED_ACTION = "SELL_SUBMISSION_EVIDENCE_SUBMITTED";
export const SELL_EVIDENCE_ATTACHMENT_BOUND_ACTION = "SELL_SUBMISSION_EVIDENCE_ATTACHMENT_BOUND";

/**
 * Statuses that end a Sell Submission. Asking a seller for more evidence on a
 * record Civilon has closed, declined, withdrawn or marked spam would be a
 * request Civilon cannot honour, so the issue path refuses them outright.
 */
export const SELL_EVIDENCE_TERMINAL_STATUSES = [
  "declined",
  "closed",
  "spam",
  "withdrawn",
] as const;

function isTerminal(status: string) {
  return (SELL_EVIDENCE_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export type IssueSellEvidenceRequestInput = {
  sellSubmissionId: string;
  categories: readonly SellEvidenceRequestCategory[];
  /** Keyed hash and derivation nonce only. The credential never reaches here. */
  keyedTokenHash: string;
  tokenDerivationNonce: string;
  expiresAt: Date;
  actor: { id: string };
  now?: Date;
};

export type IssueSellEvidenceRequestOutcome =
  | {
      ok: true;
      data: {
        requestId: string;
        categories: SellEvidenceRequestCategory[];
        expiresAt: Date;
        supersededRequestId: string | null;
      };
    }
  /** No such Sell Submission. */
  | { ok: false; reason: "not_found" }
  /** The record is closed, declined, withdrawn or spam. */
  | { ok: false; reason: "terminal_record"; currentStatus: string }
  /** No usable verified seller contact to send the request to. */
  | { ok: false; reason: "contact_unverified" };

/**
 * Issues one scoped credential for one Sell Submission.
 *
 * The seller contact must be VERIFIED. That is deliberately the *contact*
 * record, not the submission's `verified_at`, which the schema also stamps when
 * an ADMIN performs the operational verification override: sending a supplier a
 * link on the strength of a staff override would mean e-mailing an address
 * nobody ever confirmed.
 */
export async function issueSellEvidenceRequest(
  db: PriceCheckDb,
  input: IssueSellEvidenceRequestInput,
): Promise<IssueSellEvidenceRequestOutcome> {
  const now = input.now ?? new Date();
  const categories = [...input.categories];
  if (categories.length === 0 || !categories.every(isSellEvidenceRequestCategory)) {
    throw new Error("SELL_EVIDENCE_CATEGORIES_INVALID");
  }
  if (input.expiresAt.valueOf() <= now.valueOf()) {
    throw new Error("SELL_EVIDENCE_EXPIRY_INVALID");
  }

  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({
        id: sellSubmissions.id,
        status: sellSubmissions.status,
        contactId: sellSubmissions.contactId,
        contactVerificationState: marketplaceContacts.verificationState,
        contactDeletedAt: marketplaceContacts.deletedAt,
      })
      .from(sellSubmissions)
      .innerJoin(marketplaceContacts, eq(sellSubmissions.contactId, marketplaceContacts.id))
      .where(eq(sellSubmissions.id, input.sellSubmissionId))
      .limit(1);
    if (!record) return { ok: false as const, reason: "not_found" as const };
    if (isTerminal(record.status)) {
      return { ok: false as const, reason: "terminal_record" as const, currentStatus: record.status };
    }
    if (record.contactVerificationState !== "VERIFIED" || record.contactDeletedAt) {
      return { ok: false as const, reason: "contact_unverified" as const };
    }

    // Supersede first. The partial unique index allows exactly one live request
    // per submission, so this is not a courtesy — a second live credential
    // cannot be written while an earlier one stands, and revoking it here is
    // what makes the earlier emailed link stop working the moment a new one is
    // issued.
    const [superseded] = await tx
      .update(marketplaceEvidenceRequests)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(
        eq(marketplaceEvidenceRequests.sellSubmissionId, input.sellSubmissionId),
        isNull(marketplaceEvidenceRequests.consumedAt),
        isNull(marketplaceEvidenceRequests.revokedAt),
      ))
      .returning({ id: marketplaceEvidenceRequests.id });

    const requestId = generateOrderedId();
    await tx.insert(marketplaceEvidenceRequests).values({
      id: requestId,
      sellSubmissionId: input.sellSubmissionId,
      contactId: record.contactId,
      requestedCategories: categories,
      keyedTokenHash: input.keyedTokenHash,
      tokenDerivationNonce: input.tokenDerivationNonce,
      requestedByAdminUserId: input.actor.id,
      issuedAt: now,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    if (superseded) {
      await tx.insert(auditEvents).values({
        id: generateOrderedId(),
        aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
        aggregateId: input.sellSubmissionId,
        actorType: "ADMIN",
        actorId: input.actor.id,
        action: SELL_EVIDENCE_REVOKED_ACTION,
        correlationId: `sell-evidence-request:${requestId}`,
        sanitizedMetadata: {
          evidenceRequestId: superseded.id,
          supersededByRequestId: requestId,
        },
        createdAt: now,
      });
    }

    // Request id, categories and expiry. Never the credential, never the URL,
    // never the seller's address, and nothing about the offer itself.
    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: input.sellSubmissionId,
      actorType: "ADMIN",
      actorId: input.actor.id,
      action: SELL_EVIDENCE_REQUESTED_ACTION,
      correlationId: `sell-evidence-request:${requestId}`,
      sanitizedMetadata: {
        evidenceRequestId: requestId,
        categories,
        expiresAt: input.expiresAt.toISOString(),
      },
      createdAt: now,
    });

    const [message] = await tx
      .insert(notificationOutbox)
      .values({
        id: generateOrderedId(),
        messageType: SELL_EVIDENCE_REQUEST_MESSAGE_TYPE,
        aggregateType: SELL_EVIDENCE_REQUEST_AGGREGATE_TYPE,
        aggregateId: requestId,
        recipientReference: record.contactId,
        templateVersion: "sell-evidence-request-v1",
        idempotencyKey: `sell-evidence-request:${requestId}:v1`,
        nextAttemptAt: now,
        createdAt: now,
      })
      .onConflictDoNothing({ target: notificationOutbox.idempotencyKey })
      .returning({ id: notificationOutbox.id });
    if (!message) throw new Error("SELL_EVIDENCE_REQUEST_NOT_ENQUEUED");

    return {
      ok: true as const,
      data: {
        requestId,
        categories,
        expiresAt: input.expiresAt,
        supersededRequestId: superseded?.id ?? null,
      },
    };
  });
}

/**
 * Everything the seller e-mail is allowed to know: where to send it, the
 * Civilon reference, the live credential's nonce and its expiry, plus the
 * categories that were asked for.
 *
 * No part number, quantity, price, currency, location, inventory detail,
 * filename or document content is selected here, so the template cannot leak
 * what it was never handed.
 */
export async function loadSellEvidenceRequestDelivery(
  db: PriceCheckDb,
  evidenceRequestId: string,
  now = new Date(),
) {
  const [record] = await db
    .select({
      evidenceRequestId: marketplaceEvidenceRequests.id,
      sellSubmissionId: marketplaceEvidenceRequests.sellSubmissionId,
      publicReference: sellSubmissions.publicReference,
      businessEmail: marketplaceContacts.businessEmail,
      requestedCategories: marketplaceEvidenceRequests.requestedCategories,
      tokenDerivationNonce: marketplaceEvidenceRequests.tokenDerivationNonce,
      expiresAt: marketplaceEvidenceRequests.expiresAt,
      consumedAt: marketplaceEvidenceRequests.consumedAt,
      revokedAt: marketplaceEvidenceRequests.revokedAt,
    })
    .from(marketplaceEvidenceRequests)
    .innerJoin(sellSubmissions, eq(marketplaceEvidenceRequests.sellSubmissionId, sellSubmissions.id))
    .innerJoin(marketplaceContacts, and(
      eq(marketplaceEvidenceRequests.contactId, marketplaceContacts.id),
      eq(sellSubmissions.contactId, marketplaceContacts.id),
    ))
    .where(eq(marketplaceEvidenceRequests.id, evidenceRequestId))
    .limit(1);
  if (!record) throw new Error("SELL_EVIDENCE_REQUEST_UNAVAILABLE");
  // A request that has since been superseded, used or expired must not be
  // mailed: the link in that message would be dead on arrival. The dispatcher
  // retries and then dead-letters, which is the honest outcome.
  if (record.consumedAt || record.revokedAt || record.expiresAt.valueOf() <= now.valueOf()) {
    throw new Error("SELL_EVIDENCE_REQUEST_UNAVAILABLE");
  }
  return record;
}

export type SellEvidenceRequestSnapshot = {
  evidenceRequestId: string;
  sellSubmissionId: string;
  publicReference: string;
  categories: SellEvidenceRequestCategory[];
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
export async function findLiveSellEvidenceRequest(
  db: PriceCheckDb,
  input: { keyedTokenHash: string; now?: Date },
): Promise<SellEvidenceRequestSnapshot | null> {
  const now = input.now ?? new Date();
  const [record] = await db
    .select({
      evidenceRequestId: marketplaceEvidenceRequests.id,
      sellSubmissionId: marketplaceEvidenceRequests.sellSubmissionId,
      publicReference: sellSubmissions.publicReference,
      status: sellSubmissions.status,
      requestedCategories: marketplaceEvidenceRequests.requestedCategories,
      expiresAt: marketplaceEvidenceRequests.expiresAt,
      consumedAt: marketplaceEvidenceRequests.consumedAt,
      revokedAt: marketplaceEvidenceRequests.revokedAt,
      attemptCount: marketplaceEvidenceRequests.attemptCount,
      maxAttemptCount: marketplaceEvidenceRequests.maxAttemptCount,
    })
    .from(marketplaceEvidenceRequests)
    .innerJoin(sellSubmissions, eq(marketplaceEvidenceRequests.sellSubmissionId, sellSubmissions.id))
    .where(eq(marketplaceEvidenceRequests.keyedTokenHash, input.keyedTokenHash))
    .limit(1);
  if (!record) return null;
  if (record.consumedAt || record.revokedAt) return null;
  if (record.expiresAt.valueOf() <= now.valueOf()) return null;
  if (record.attemptCount >= record.maxAttemptCount) return null;
  if (isTerminal(record.status)) return null;
  const categories = record.requestedCategories.filter(isSellEvidenceRequestCategory);
  if (categories.length === 0) return null;
  return {
    evidenceRequestId: record.evidenceRequestId,
    sellSubmissionId: record.sellSubmissionId,
    publicReference: record.publicReference,
    categories,
    expiresAt: record.expiresAt,
  };
}

/**
 * One already-verified file, prepared outside the transaction exactly as the
 * initial intake prepares its own. Same shape as
 * `CreateSellSubmissionInput["attachments"]`, so the two paths cannot drift.
 */
export type PreparedSellEvidenceAttachment = {
  id: string;
  pendingUploadId: string;
  uploadSessionId: string;
  displayFilename: string;
  objectKey: string;
  declaredMime: string;
  detectedMime: string;
  purpose: string;
  byteSize: number;
};

export type RedeemSellEvidenceOutcome =
  | { outcome: "bound"; reference: string; attachmentIds: string[] }
  | { outcome: "unavailable" };

/**
 * Redeems a credential and binds every accepted file to the original Sell
 * Submission, in one transaction.
 *
 * Every rejection path returns the same opaque `unavailable`, so a caller
 * guessing credentials never learns whether another submission exists, whether
 * a handle belongs to someone else, or which of the checks refused them.
 *
 * The order of work matters. The credential is consumed under a predicate that
 * names its own unconsumed, unrevoked state and its own attempt count, so two
 * concurrent submissions cannot both succeed. Each pending upload is then
 * claimed under a predicate that requires it to be unclaimed and owned by the
 * session that minted it, so a handle is single-use and a batch containing one
 * already-used handle binds nothing at all.
 */
export async function redeemSellEvidenceRequest(
  db: PriceCheckDb,
  input: {
    keyedTokenHash: string;
    attachments: readonly PreparedSellEvidenceAttachment[];
    now?: Date;
  },
): Promise<RedeemSellEvidenceOutcome> {
  const now = input.now ?? new Date();
  // A follow-up submission of nothing is not a response. The initial offer is
  // already recorded and needs no evidence at all; this endpoint exists only to
  // carry files.
  if (input.attachments.length === 0) return { outcome: "unavailable" };

  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({
        request: marketplaceEvidenceRequests,
        submission: sellSubmissions,
      })
      .from(marketplaceEvidenceRequests)
      .innerJoin(sellSubmissions, eq(marketplaceEvidenceRequests.sellSubmissionId, sellSubmissions.id))
      .where(eq(marketplaceEvidenceRequests.keyedTokenHash, input.keyedTokenHash))
      .limit(1);
    if (!record) return { outcome: "unavailable" as const };

    const { request, submission } = record;
    if (request.consumedAt || request.revokedAt) return { outcome: "unavailable" as const };
    if (request.expiresAt.valueOf() <= now.valueOf()) return { outcome: "unavailable" as const };
    if (request.attemptCount + 1 > request.maxAttemptCount) return { outcome: "unavailable" as const };
    // The credential must name exactly this submission and exactly this
    // submission's contact. A mismatch is a malformed row, never an opportunity.
    if (request.sellSubmissionId !== submission.id) return { outcome: "unavailable" as const };
    if (request.contactId !== submission.contactId) return { outcome: "unavailable" as const };
    if (isTerminal(submission.status)) return { outcome: "unavailable" as const };

    // Every file must answer something that was actually asked for. A purpose
    // outside the request — including `OTHER`, which is never requestable — is
    // refused, and refusing it fails the whole batch rather than silently
    // dropping a file the seller believes they sent.
    const requested = new Set(request.requestedCategories);
    if (input.attachments.some((attachment) => !requested.has(attachment.purpose))) {
      return { outcome: "unavailable" as const };
    }

    const [consumed] = await tx
      .update(marketplaceEvidenceRequests)
      .set({
        consumedAt: now,
        attemptCount: request.attemptCount + 1,
        submittedAttachmentCount: input.attachments.length,
        updatedAt: now,
      })
      .where(and(
        eq(marketplaceEvidenceRequests.id, request.id),
        eq(marketplaceEvidenceRequests.attemptCount, request.attemptCount),
        isNull(marketplaceEvidenceRequests.consumedAt),
        isNull(marketplaceEvidenceRequests.revokedAt),
      ))
      .returning({ id: marketplaceEvidenceRequests.id });
    if (!consumed) return { outcome: "unavailable" as const };

    for (const attachment of input.attachments) {
      const [claimed] = await tx
        .update(marketplacePendingUploads)
        .set({
          state: "BOUND",
          claimedSellSubmissionId: submission.id,
          updatedAt: now,
        })
        .where(and(
          eq(marketplacePendingUploads.id, attachment.pendingUploadId),
          eq(marketplacePendingUploads.uploadSessionId, attachment.uploadSessionId),
          inArray(marketplacePendingUploads.state, ["AUTHORIZED", "UPLOADED"]),
          isNull(marketplacePendingUploads.claimedBuyRequestId),
          isNull(marketplacePendingUploads.claimedSellSubmissionId),
        ))
        .returning({ id: marketplacePendingUploads.id });
      // A handle is single-use. Aborting here rolls back the credential
      // consumption and every earlier claim, so a seller never ends up with a
      // spent link and half their evidence stored.
      if (!claimed) throw new Error("MARKETPLACE_UPLOAD_HANDLE_ALREADY_USED");
    }

    await tx.insert(marketplaceAttachments).values(input.attachments.map((attachment) => ({
      id: attachment.id,
      aggregateType: "sell_submission" as const,
      aggregateId: submission.id,
      buyRequestId: null,
      sellSubmissionId: submission.id,
      purpose: attachment.purpose as
        | "INVENTORY_SPREADSHEET"
        | "WAREHOUSE_BUSINESS_EVIDENCE"
        | "CUSTODY_PART_PHOTO"
        | "PART_NUMBER_SERIAL_PHOTO"
        | "RELEASE_SUPPORTING_DOCUMENT"
        | "OTHER",
      // The seller uploaded it, exactly as at initial intake. `ADMIN` would
      // claim a staff member produced the evidence, which is not what happened.
      uploadedByType: "CONTACT" as const,
      displayFilename: attachment.displayFilename,
      objectKey: attachment.objectKey,
      storageProvider: "AWS_S3",
      declaredMime: attachment.declaredMime,
      detectedMime: attachment.detectedMime,
      byteSize: String(attachment.byteSize),
      contentDigest: null,
      // Scanned clean and signature-verified before this transaction opened.
      // `quarantineReleasedAt` stays null: clean means staff may review it, not
      // that it leaves the private namespace. Nothing here is ever public.
      scanState: "CLEAN" as const,
      quarantineReleasedAt: null,
      // The default the column already carries, restated because it is the
      // point: new evidence arrives unreviewed and the existing per-file
      // control is what changes it.
      reviewState: "not_reviewed" as const,
      retentionClass: "MARKETPLACE_INTAKE_EVIDENCE" as const,
      sourcePendingUploadId: attachment.pendingUploadId,
      createdAt: now,
      updatedAt: now,
    })));

    const correlationId = `sell-evidence-request:${request.id}`;
    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: submission.id,
      actorType: "REQUESTER",
      actorId: submission.contactId,
      action: SELL_EVIDENCE_SUBMITTED_ACTION,
      correlationId,
      sanitizedMetadata: {
        evidenceRequestId: request.id,
        categories: [...request.requestedCategories],
        attachmentCount: input.attachments.length,
      },
      createdAt: now,
    });

    // Identifier, purpose, type and size — never the seller's filename, and
    // never anything read from inside the file.
    await tx.insert(auditEvents).values(input.attachments.map((attachment) => ({
      id: generateOrderedId(),
      aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: submission.id,
      actorType: "REQUESTER" as const,
      actorId: submission.contactId,
      action: SELL_EVIDENCE_ATTACHMENT_BOUND_ACTION,
      correlationId,
      sanitizedMetadata: {
        evidenceRequestId: request.id,
        attachmentId: attachment.id,
        purpose: attachment.purpose,
        detectedMime: attachment.detectedMime,
        byteSize: attachment.byteSize,
        retentionClass: "MARKETPLACE_INTAKE_EVIDENCE",
      },
      createdAt: now,
    })));

    return {
      outcome: "bound" as const,
      reference: submission.publicReference,
      attachmentIds: input.attachments.map((attachment) => attachment.id),
    };
  });
}

/**
 * Completes one evidence-request outbox row under the caller's lease. Losing
 * the lease is an error, not a silent success, so a message cannot be marked
 * sent by a worker that no longer owns it.
 */
export async function markSellEvidenceNotificationSucceeded(
  db: PriceCheckDb,
  input: {
    evidenceRequestId: string;
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
        eq(notificationOutbox.aggregateId, input.evidenceRequestId),
        eq(notificationOutbox.messageType, input.messageType),
        eq(notificationOutbox.state, "running"),
        eq(notificationOutbox.leaseOwner, input.leaseOwner),
      ))
      .returning({ id: notificationOutbox.id });
    if (!completed) throw new Error("SELL_EVIDENCE_DELIVERY_LEASE_LOST");

    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
      aggregateId: input.sellSubmissionId,
      actorType: "WORKER",
      actorId: null,
      action: "SELL_SUBMISSION_NOTIFICATION_SENT",
      correlationId: `sell-evidence-notification:${input.notificationId}`,
      sanitizedMetadata: {
        messageType: input.messageType,
        provider: "postmark",
        evidenceRequestId: input.evidenceRequestId,
      },
      createdAt: now,
    });
  });
}

/**
 * Records a delivery failure against the evidence request.
 *
 * The submission id is resolved from the request rather than trusted from the
 * caller, and a request that no longer resolves simply records nothing: a
 * failure note is not worth inventing an aggregate for.
 */
export async function recordSellEvidenceNotificationFailure(
  db: PriceCheckDb,
  input: {
    evidenceRequestId: string;
    notificationId: string;
    messageType: string;
    code: string;
    deadLetter: boolean;
    now?: Date;
  },
) {
  const [record] = await db
    .select({ sellSubmissionId: marketplaceEvidenceRequests.sellSubmissionId })
    .from(marketplaceEvidenceRequests)
    .where(eq(marketplaceEvidenceRequests.id, input.evidenceRequestId))
    .limit(1);
  if (!record) return;
  await db.insert(auditEvents).values({
    id: generateOrderedId(),
    aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
    aggregateId: record.sellSubmissionId,
    actorType: "WORKER",
    actorId: null,
    action: "SELL_SUBMISSION_NOTIFICATION_FAILED",
    correlationId: `sell-evidence-notification:${input.notificationId}`,
    sanitizedMetadata: {
      messageType: input.messageType,
      code: input.code,
      deadLetter: input.deadLetter,
      evidenceRequestId: input.evidenceRequestId,
    },
    createdAt: input.now ?? new Date(),
  });
}
