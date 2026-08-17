import "../../../db/price-check/server-boundary.ts";

import { randomBytes } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
} from "@aws-sdk/client-s3";
import type { PriceCheckDb } from "../../../db/price-check/index.ts";
import {
  listPriceCheckAttachments,
  recordAttachmentScanResult,
} from "../../../db/price-check/repositories/attachment-repository.ts";
import { createUploadS3Client, getUploadStorageConfig } from "./config.ts";
import { validateUploadedFile } from "./file-validation.ts";

const SCAN_TAG = "GuardDutyMalwareScanStatus";

export function guardDutyScanDecision(status: string | undefined) {
  if (!status) return "PENDING" as const;
  if (status === "NO_THREATS_FOUND") return "CLEAN" as const;
  if (status === "THREATS_FOUND") return "REJECTED" as const;
  return "FAILED" as const;
}

function copySource(bucket: string, key: string) {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function reconcilePriceCheckAttachments(
  db: PriceCheckDb,
  priceCheckId: string,
  actorId: string | null,
) {
  const config = getUploadStorageConfig();
  const client = createUploadS3Client(config);
  const records = await listPriceCheckAttachments(db, priceCheckId);
  const results: Array<{ id: string; state: string }> = [];
  for (const attachment of records) {
    if (!["PENDING", "QUARANTINED", "FAILED"].includes(attachment.scanState)) continue;
    try {
      const tags = await client.send(new GetObjectTaggingCommand({ Bucket: config.bucket, Key: attachment.objectKey }));
      const scanStatus = tags.TagSet?.find((tag) => tag.Key === SCAN_TAG)?.Value;
      const decision = guardDutyScanDecision(scanStatus);
      if (decision === "PENDING") { results.push({ id: attachment.id, state: "PENDING" }); continue; }
      if (decision === "REJECTED") {
        await recordAttachmentScanResult(db, {
          attachmentId: attachment.id, priceCheckId, scanState: "REJECTED", actorId,
          reasonCode: "THREATS_FOUND",
        });
        results.push({ id: attachment.id, state: "REJECTED" });
        continue;
      }
      if (decision === "FAILED") {
        await recordAttachmentScanResult(db, {
          attachmentId: attachment.id, priceCheckId, scanState: "FAILED", actorId,
          reasonCode: scanStatus!.slice(0, 80),
        });
        results.push({ id: attachment.id, state: "FAILED" });
        continue;
      }
      const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: attachment.objectKey }));
      if (!object.Body) throw new Error("EMPTY_OBJECT");
      const bytes = await object.Body.transformToByteArray();
      let verified;
      try {
        verified = validateUploadedFile(bytes, attachment.declaredMime ?? "");
      } catch {
        await recordAttachmentScanResult(db, {
          attachmentId: attachment.id, priceCheckId, scanState: "REJECTED", actorId,
          reasonCode: "CONTENT_VALIDATION_FAILED",
        });
        results.push({ id: attachment.id, state: "REJECTED" });
        continue;
      }
      const boundKey = `bound/${randomBytes(32).toString("base64url")}`;
      await client.send(new CopyObjectCommand({
        Bucket: config.bucket,
        Key: boundKey,
        CopySource: copySource(config.bucket, attachment.objectKey),
        MetadataDirective: "COPY",
        TaggingDirective: "COPY",
      }));
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: attachment.objectKey }));
      await recordAttachmentScanResult(db, {
        attachmentId: attachment.id,
        priceCheckId,
        scanState: "CLEAN",
        objectKey: boundKey,
        detectedMime: verified.detectedMime,
        byteSize: verified.byteSize,
        contentDigest: verified.contentDigest,
        actorId,
      });
      results.push({ id: attachment.id, state: "CLEAN" });
    } catch {
      await recordAttachmentScanResult(db, {
        attachmentId: attachment.id, priceCheckId, scanState: "FAILED", actorId,
        reasonCode: "RECONCILIATION_ERROR",
      });
      results.push({ id: attachment.id, state: "FAILED" });
    }
  }
  return results;
}
