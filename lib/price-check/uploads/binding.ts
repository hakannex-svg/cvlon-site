import "../../../db/price-check/server-boundary.ts";

import { GetObjectTaggingCommand } from "@aws-sdk/client-s3";
import type { PriceCheckDb } from "../../../db/price-check/index.ts";
import { generateOrderedId } from "../../../db/price-check/domain/identifiers.ts";
import { findClaimablePendingUploads } from "../../../db/price-check/repositories/upload-repository.ts";
import { createUploadS3Client, getUploadStorageConfig } from "./config.ts";
import { hashUploadSessionToken } from "./session.ts";

export async function prepareVerifiedAttachments(
  db: PriceCheckDb,
  handles: string[],
  uploadSessionToken: string | null | undefined,
) {
  if (handles.length === 0) return [];
  if (!uploadSessionToken) throw new Error("The upload session expired. Remove the document and upload it again.");
  const unique = [...new Set(handles)];
  if (unique.length !== handles.length || unique.length > 3) {
    throw new Error("The attachment handles are invalid or duplicated.");
  }
  const pending = await findClaimablePendingUploads(
    db,
    hashUploadSessionToken(uploadSessionToken),
    unique,
  );
  if (pending.length !== unique.length) {
    throw new Error("An uploaded document is expired, invalid or already used.");
  }
  const byId = new Map(pending.map((item) => [item.id, item]));
  const config = getUploadStorageConfig();
  const client = createUploadS3Client(config);
  const verified = [];
  for (const handle of unique) {
    const item = byId.get(handle)!;
    // This exact-key call proves that S3 accepted an object without granting
    // any pre-scan content-read permission. Actual bytes and size are verified
    // after GuardDuty applies a clean tag, before staff access is possible.
    await client.send(new GetObjectTaggingCommand({
      Bucket: config.bucket,
      Key: item.objectKey,
    }));
    const byteSize = Number(item.expectedByteSize);
    if (!Number.isSafeInteger(byteSize) || byteSize < 1) {
      throw new Error("An uploaded document could not be verified. Remove it and upload it again.");
    }
    verified.push({
      id: generateOrderedId(),
      pendingUploadId: item.id,
      uploadSessionId: item.uploadSessionId,
      displayFilename: item.displayFilename,
      objectKey: item.objectKey,
      declaredMime: item.declaredMime,
      byteSize,
    });
  }
  return verified;
}
