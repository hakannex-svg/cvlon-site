import "../server-boundary.ts";

import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import {
  auditEvents,
  marketplacePendingUploads,
  marketplaceUploadSessions,
} from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  MARKETPLACE_UPLOAD_MAX_FILES,
  MARKETPLACE_UPLOAD_MAX_SESSION_BYTES,
  MARKETPLACE_UPLOAD_SESSION_SECONDS,
  type MarketplaceUploadMime,
  type MarketplaceUploadPurpose,
} from "../../../lib/marketplace/uploads/constants.ts";

export type MarketplaceUploadAggregate = "buy_request" | "sell_submission";

/**
 * Resolves an upload session from its keyed hash.
 *
 * The intended aggregate is part of the predicate, not a value read back and
 * compared later: a session opened for one side of the marketplace can never be
 * returned to the other, so a Sell submit can never adopt a session that was
 * authorized for a Buy Request.
 */
export async function findActiveMarketplaceUploadSession(
  db: PriceCheckDb,
  tokenHash: string,
  intendedAggregateType: MarketplaceUploadAggregate,
  now = new Date(),
) {
  const [session] = await db
    .select()
    .from(marketplaceUploadSessions)
    .where(and(
      eq(marketplaceUploadSessions.tokenHash, tokenHash),
      eq(marketplaceUploadSessions.intendedAggregateType, intendedAggregateType),
      gt(marketplaceUploadSessions.expiresAt, now),
    ))
    .limit(1);
  return session ?? null;
}

export type AuthorizeMarketplaceUploadInput = {
  session: { id: string; tokenHash: string } | null;
  tokenHash: string;
  intendedAggregateType: MarketplaceUploadAggregate;
  filename: string;
  mime: MarketplaceUploadMime;
  size: number;
  purpose: MarketplaceUploadPurpose;
  objectKey: string;
  now?: Date;
};

/**
 * Reserves one pending upload slot and returns its opaque handle.
 *
 * The count and byte ceilings are enforced inside the same UPDATE that
 * increments them, so twelve concurrent authorizations cannot each read
 * "eleven so far" and all succeed. The database check constraints are the
 * second line; this predicate is the first, and it is what turns a breach into
 * a clean refusal instead of a constraint violation.
 */
export async function authorizeMarketplacePendingUpload(
  db: PriceCheckDb,
  input: AuthorizeMarketplaceUploadInput,
) {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.valueOf() + MARKETPLACE_UPLOAD_SESSION_SECONDS * 1000);
  const handle = generateOrderedId();

  return db.transaction(async (tx) => {
    let sessionId: string;
    if (input.session) {
      const [updated] = await tx
        .update(marketplaceUploadSessions)
        .set({
          authorizedCount: sql`${marketplaceUploadSessions.authorizedCount} + 1`,
          expectedByteSize: sql`${marketplaceUploadSessions.expectedByteSize} + ${input.size}`,
          updatedAt: now,
        })
        .where(and(
          eq(marketplaceUploadSessions.id, input.session.id),
          eq(marketplaceUploadSessions.tokenHash, input.session.tokenHash),
          eq(marketplaceUploadSessions.intendedAggregateType, input.intendedAggregateType),
          gt(marketplaceUploadSessions.expiresAt, now),
          sql`${marketplaceUploadSessions.authorizedCount} < ${MARKETPLACE_UPLOAD_MAX_FILES}`,
          sql`${marketplaceUploadSessions.expectedByteSize} + ${input.size} <= ${MARKETPLACE_UPLOAD_MAX_SESSION_BYTES}`,
        ))
        .returning({ id: marketplaceUploadSessions.id });
      if (!updated) throw new Error("MARKETPLACE_UPLOAD_SESSION_LIMIT_REACHED");
      sessionId = updated.id;
    } else {
      sessionId = generateOrderedId();
      await tx.insert(marketplaceUploadSessions).values({
        id: sessionId,
        tokenHash: input.tokenHash,
        intendedAggregateType: input.intendedAggregateType,
        authorizedCount: 1,
        expectedByteSize: String(input.size),
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    await tx.insert(marketplacePendingUploads).values({
      id: handle,
      uploadSessionId: sessionId,
      objectKey: input.objectKey,
      displayFilename: input.filename,
      declaredMime: input.mime,
      expectedByteSize: String(input.size),
      purpose: input.purpose,
      state: "AUTHORIZED",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    // Handle, purpose, declared type and expected size only. The seller's
    // filename is deliberately absent: an audit row is not the place to keep a
    // second copy of what a supplier called their inventory list.
    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: "marketplace_upload_session",
      aggregateId: sessionId,
      actorType: "REQUESTER",
      actorId: null,
      action: "MARKETPLACE_UPLOAD_AUTHORIZED",
      correlationId: `marketplace-upload-authorized:${handle}`,
      sanitizedMetadata: {
        attachmentHandle: handle,
        purpose: input.purpose,
        declaredMime: input.mime,
        expectedByteSize: input.size,
      },
      createdAt: now,
    });

    return { handle, sessionId, expiresAt };
  });
}

/**
 * Returns the pending uploads a given session may still claim.
 *
 * Every isolation rule is in the predicate rather than in a later comparison:
 * the session must be live and must be the session that owns the row, the
 * session's intended aggregate must be the one being claimed, the row must not
 * have expired, and neither claim column may already be set. A handle that
 * fails any of these simply does not come back, and the caller's count check
 * turns that into a refusal.
 */
export async function findClaimableMarketplaceUploads(
  db: PriceCheckDb,
  input: {
    tokenHash: string;
    handles: string[];
    intendedAggregateType: MarketplaceUploadAggregate;
    now?: Date;
  },
) {
  if (input.handles.length === 0) return [];
  const now = input.now ?? new Date();
  return db
    .select({
      id: marketplacePendingUploads.id,
      uploadSessionId: marketplacePendingUploads.uploadSessionId,
      objectKey: marketplacePendingUploads.objectKey,
      displayFilename: marketplacePendingUploads.displayFilename,
      declaredMime: marketplacePendingUploads.declaredMime,
      expectedByteSize: marketplacePendingUploads.expectedByteSize,
      purpose: marketplacePendingUploads.purpose,
    })
    .from(marketplacePendingUploads)
    .innerJoin(
      marketplaceUploadSessions,
      eq(marketplacePendingUploads.uploadSessionId, marketplaceUploadSessions.id),
    )
    .where(and(
      eq(marketplaceUploadSessions.tokenHash, input.tokenHash),
      eq(marketplaceUploadSessions.intendedAggregateType, input.intendedAggregateType),
      gt(marketplaceUploadSessions.expiresAt, now),
      gt(marketplacePendingUploads.expiresAt, now),
      inArray(marketplacePendingUploads.id, input.handles),
      inArray(marketplacePendingUploads.state, ["AUTHORIZED", "UPLOADED"]),
      isNull(marketplacePendingUploads.claimedBuyRequestId),
      isNull(marketplacePendingUploads.claimedSellSubmissionId),
    ));
}
