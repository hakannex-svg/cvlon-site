import "@/db/price-check/server-boundary";

import { GetObjectCommand, GetObjectTaggingCommand } from "@aws-sdk/client-s3";
import { createUploadS3Client, getUploadStorageConfig } from "@/lib/price-check/uploads/config";
import { validateUploadedFile } from "@/lib/price-check/uploads/file-validation";

const allowedMime = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
type AllowedMime = typeof allowedMime[number];

export type CleanExtractionAttachment = {
  id: string;
  priceCheckId: string;
  objectKey: string;
  displayFilename: string;
  detectedMime: string | null;
  declaredMime: string | null;
  byteSize: string;
  contentDigest: string | null;
  scanState: string;
  deletedAt: Date | null;
};

export async function fetchVerifiedCleanAttachment(
  attachment: CleanExtractionAttachment,
  dependencies: { client?: ReturnType<typeof createUploadS3Client> } = {},
) {
  if (attachment.scanState !== "CLEAN" || attachment.deletedAt || !attachment.contentDigest) throw new Error("ATTACHMENT_NOT_CLEAN");
  const mime = attachment.detectedMime;
  if (!mime || !allowedMime.includes(mime as AllowedMime)) throw new Error("ATTACHMENT_TYPE_UNSUPPORTED");
  const config = getUploadStorageConfig();
  const client = dependencies.client ?? createUploadS3Client(config);
  const tags = await client.send(new GetObjectTaggingCommand({ Bucket: config.bucket, Key: attachment.objectKey }));
  if (tags.TagSet?.find((tag) => tag.Key === "GuardDutyMalwareScanStatus")?.Value !== "NO_THREATS_FOUND") throw new Error("ATTACHMENT_SCAN_EVIDENCE_MISSING");
  const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: attachment.objectKey }));
  if (!object.Body) throw new Error("ATTACHMENT_OBJECT_MISSING");
  const bytes = await object.Body.transformToByteArray();
  const verified = validateUploadedFile(bytes, mime);
  if (verified.byteSize !== Number(attachment.byteSize) || verified.contentDigest !== attachment.contentDigest) throw new Error("ATTACHMENT_INTEGRITY_MISMATCH");
  return { bytes, mime: verified.detectedMime, filename: attachment.displayFilename };
}
