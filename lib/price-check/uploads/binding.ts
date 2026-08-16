import "../../../db/price-check/server-boundary.ts";

import { GetObjectAttributesCommand } from "@aws-sdk/client-s3";
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
    const attributes = await client.send(new GetObjectAttributesCommand({
      Bucket: config.bucket,
      Key: item.objectKey,
      ObjectAttributes: ["ObjectSize"],
    }));
    const byteSize = Number(attributes.ObjectSize ?? -1);
    if (!Number.isSafeInteger(byteSize)
      || byteSize !== Number(item.expectedByteSize)) {
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
