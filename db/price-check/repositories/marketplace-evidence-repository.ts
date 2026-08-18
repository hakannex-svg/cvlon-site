import "../server-boundary.ts";

import { and, eq, isNull } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import { marketplaceAttachments } from "../schema.ts";
import { appendAuditEvent } from "./audit-repository.ts";

/**
 * The one place a marketplace storage key may be read.
 *
 * Deliberately a separate module from `marketplace-admin-repository.ts`: the
 * detail projections that feed staff pages must never be able to reach an
 * object key, and keeping the key out of that file entirely lets the tests
 * assert it as a whole-file property rather than a per-query convention.
 *
 * Nothing here is reachable from a page or a component. Only the server-side
 * download route imports it.
 */

export const SELL_EVIDENCE_VIEW_ACTION = "SELL_SUBMISSION_EVIDENCE_VIEW_AUTHORIZED";
export const SELL_SUBMISSION_AGGREGATE_TYPE = "sell_submission";

export type SellEvidenceObject = {
  id: string;
  sellSubmissionId: string;
  objectKey: string;
  displayFilename: string;
  declaredMime: string | null;
  detectedMime: string | null;
  byteSize: string;
  scanState: string;
};

/**
 * Record-bound lookup: the parent id is part of the predicate, so an attachment
 * id on its own is not a capability. A row belonging to another Sell
 * Submission, to a Buy Request, or a soft-deleted row simply does not exist as
 * far as this function is concerned — the caller gets `null` and cannot tell
 * which of those it was.
 */
export async function getSellSubmissionEvidenceObject(
  db: PriceCheckDb,
  sellSubmissionId: string,
  attachmentId: string,
): Promise<SellEvidenceObject | null> {
  const [row] = await db.select({
    id: marketplaceAttachments.id,
    sellSubmissionId: marketplaceAttachments.sellSubmissionId,
    objectKey: marketplaceAttachments.objectKey,
    displayFilename: marketplaceAttachments.displayFilename,
    declaredMime: marketplaceAttachments.declaredMime,
    detectedMime: marketplaceAttachments.detectedMime,
    byteSize: marketplaceAttachments.byteSize,
    scanState: marketplaceAttachments.scanState,
  }).from(marketplaceAttachments)
    .where(and(
      eq(marketplaceAttachments.id, attachmentId),
      eq(marketplaceAttachments.sellSubmissionId, sellSubmissionId),
      eq(marketplaceAttachments.aggregateType, SELL_SUBMISSION_AGGREGATE_TYPE),
      eq(marketplaceAttachments.aggregateId, sellSubmissionId),
      isNull(marketplaceAttachments.deletedAt),
    ))
    .limit(1);
  if (!row || !row.sellSubmissionId) return null;
  return { ...row, sellSubmissionId: row.sellSubmissionId };
}

/**
 * Records that a named staff member was authorized to open a named attachment.
 *
 * The metadata carries the attachment id and nothing else: no filename, no
 * object key, no bucket, no contact detail, no document content and no signed
 * URL. The audit row is evidence that access happened, not a second copy of the
 * thing accessed.
 */
export async function recordSellEvidenceViewAuthorized(
  db: PriceCheckDb,
  input: { sellSubmissionId: string; attachmentId: string; actorId: string },
) {
  return appendAuditEvent(db, {
    aggregateType: SELL_SUBMISSION_AGGREGATE_TYPE,
    aggregateId: input.sellSubmissionId,
    actorType: "ADMIN",
    actorId: input.actorId,
    action: SELL_EVIDENCE_VIEW_ACTION,
    correlationId: `${SELL_EVIDENCE_VIEW_ACTION}:${crypto.randomUUID()}`,
    sanitizedMetadata: { attachmentId: input.attachmentId },
  });
}
