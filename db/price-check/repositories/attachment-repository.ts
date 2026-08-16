import "../server-boundary.ts";

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { PriceCheckDb } from "../index.ts";
import { attachments, auditEvents } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";

export async function listPriceCheckAttachments(db: PriceCheckDb, priceCheckId: string) {
  return db.select().from(attachments)
    .where(and(eq(attachments.priceCheckId, priceCheckId), isNull(attachments.deletedAt)))
    .orderBy(attachments.createdAt);
}

export async function getPriceCheckAttachment(
  db: PriceCheckDb,
  priceCheckId: string,
  attachmentId: string,
) {
  const [attachment] = await db.select().from(attachments).where(and(
    eq(attachments.id, attachmentId),
    eq(attachments.priceCheckId, priceCheckId),
  )).limit(1);
  return attachment ?? null;
}

export async function recordAttachmentScanResult(
  db: PriceCheckDb,
  input: {
    attachmentId: string;
    priceCheckId: string;
    scanState: "CLEAN" | "REJECTED" | "FAILED";
    objectKey?: string;
    detectedMime?: string;
    byteSize?: number;
    contentDigest?: string;
    actorId: string | null;
    reasonCode?: string;
  },
) {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(attachments).set({
      scanState: input.scanState,
      objectKey: input.objectKey,
      detectedMime: input.detectedMime,
      byteSize: input.byteSize === undefined ? undefined : String(input.byteSize),
      contentDigest: input.contentDigest,
      updatedAt: new Date(),
    }).where(and(
      eq(attachments.id, input.attachmentId),
      eq(attachments.priceCheckId, input.priceCheckId),
      inArray(attachments.scanState, ["PENDING", "QUARANTINED", "FAILED"]),
    )).returning({ id: attachments.id });
    if (!updated) return null;
    const action = input.scanState === "CLEAN"
      ? "ATTACHMENT_SCAN_CLEAN"
      : input.scanState === "REJECTED"
        ? "ATTACHMENT_SCAN_REJECTED"
        : "ATTACHMENT_SCAN_FAILED";
    await tx.insert(auditEvents).values({
      id: generateOrderedId(),
      aggregateType: "price_check",
      aggregateId: input.priceCheckId,
      actorType: input.actorId ? "ADMIN" : "SYSTEM",
      actorId: input.actorId,
      action,
      correlationId: `${action.toLowerCase()}:${crypto.randomUUID()}`,
      sanitizedMetadata: {
        attachmentId: input.attachmentId,
        ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      },
    });
    return updated;
  });
}

export async function recordAttachmentViewAuthorized(
  db: PriceCheckDb,
  input: { attachmentId: string; priceCheckId: string; actorId: string },
) {
  await db.insert(auditEvents).values({
    id: generateOrderedId(), aggregateType: "price_check", aggregateId: input.priceCheckId,
    actorType: "ADMIN", actorId: input.actorId, action: "ATTACHMENT_VIEW_AUTHORIZED",
    correlationId: `attachment-view:${crypto.randomUUID()}`,
    sanitizedMetadata: { attachmentId: input.attachmentId },
  });
}
