import "../server-boundary.ts";

import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import { auditEvents, pendingUploads, uploadSessions } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  PRICE_CHECK_UPLOAD_MAX_FILES,
  PRICE_CHECK_UPLOAD_MAX_SESSION_BYTES,
  PRICE_CHECK_UPLOAD_SESSION_SECONDS,
  type PriceCheckUploadMime,
} from "../../../lib/price-check/uploads/constants.ts";

export async function findActiveUploadSession(
  db: PriceCheckDb,
  tokenHash: string,
  now = new Date(),
) {
  const [session] = await db.select().from(uploadSessions).where(and(
    eq(uploadSessions.tokenHash, tokenHash),
    gt(uploadSessions.expiresAt, now),
  )).limit(1);
  return session ?? null;
}

export type AuthorizePendingUploadInput = {
  session: { id: string; tokenHash: string } | null;
  tokenHash: string;
  filename: string;
  mime: PriceCheckUploadMime;
  size: number;
  objectKey: string;
  now?: Date;
};

export async function authorizePendingUpload(
  db: PriceCheckDb,
  input: AuthorizePendingUploadInput,
) {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.valueOf() + PRICE_CHECK_UPLOAD_SESSION_SECONDS * 1000);
  const handle = generateOrderedId();
  return db.transaction(async (tx) => {
    let sessionId: string;
    if (input.session) {
      const [updated] = await tx.update(uploadSessions).set({
        authorizedCount: sql`${uploadSessions.authorizedCount} + 1`,
        expectedByteSize: sql`${uploadSessions.expectedByteSize} + ${input.size}`,
        updatedAt: now,
      }).where(and(
        eq(uploadSessions.id, input.session.id),
        eq(uploadSessions.tokenHash, input.session.tokenHash),
        gt(uploadSessions.expiresAt, now),
        sql`${uploadSessions.authorizedCount} < ${PRICE_CHECK_UPLOAD_MAX_FILES}`,
        sql`${uploadSessions.expectedByteSize} + ${input.size} <= ${PRICE_CHECK_UPLOAD_MAX_SESSION_BYTES}`,
      )).returning({ id: uploadSessions.id });
      if (!updated) throw new Error("This upload session already has the maximum allowed documents.");
      sessionId = updated.id;
    } else {
      sessionId = generateOrderedId();
      await tx.insert(uploadSessions).values({
        id: sessionId,
        tokenHash: input.tokenHash,
        authorizedCount: 1,
        expectedByteSize: String(input.size),
        expiresAt,
      });
    }
    await tx.insert(pendingUploads).values({
      id: handle,
      uploadSessionId: sessionId,
      objectKey: input.objectKey,
      displayFilename: input.filename,
      declaredMime: input.mime,
      expectedByteSize: String(input.size),
      state: "AUTHORIZED",
      expiresAt,
    });
    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: "upload_session",
      aggregateId: sessionId,
      actorType: "REQUESTER",
      actorId: null,
      action: "UPLOAD_AUTHORIZED",
      correlationId: `upload-authorized:${crypto.randomUUID()}`,
      sanitizedMetadata: { attachmentHandle: handle, declaredMime: input.mime, expectedByteSize: input.size },
    });
    return { handle, sessionId, expiresAt };
  });
}

export async function findClaimablePendingUploads(
  db: PriceCheckDb,
  tokenHash: string,
  handles: string[],
  now = new Date(),
) {
  if (handles.length === 0) return [];
  return db.select({
    id: pendingUploads.id,
    uploadSessionId: pendingUploads.uploadSessionId,
    objectKey: pendingUploads.objectKey,
    displayFilename: pendingUploads.displayFilename,
    declaredMime: pendingUploads.declaredMime,
    expectedByteSize: pendingUploads.expectedByteSize,
  }).from(pendingUploads)
    .innerJoin(uploadSessions, eq(pendingUploads.uploadSessionId, uploadSessions.id))
    .where(and(
      eq(uploadSessions.tokenHash, tokenHash),
      gt(uploadSessions.expiresAt, now),
      gt(pendingUploads.expiresAt, now),
      inArray(pendingUploads.id, handles),
      inArray(pendingUploads.state, ["AUTHORIZED", "UPLOADED"]),
      isNull(pendingUploads.claimedPriceCheckId),
    ));
}
