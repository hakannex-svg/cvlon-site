import "../../../db/price-check/server-boundary.ts";

import { S3Client } from "@aws-sdk/client-s3";

export type UploadStorageConfig = {
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export function getUploadStorageConfig(): UploadStorageConfig {
  const region = process.env.PRICE_CHECK_UPLOAD_AWS_REGION?.trim()
    || process.env.AWS_REGION?.trim();
  const bucket = process.env.PRICE_CHECK_UPLOAD_BUCKET?.trim();
  const accessKeyId = process.env.PRICE_CHECK_UPLOAD_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.PRICE_CHECK_UPLOAD_AWS_SECRET_ACCESS_KEY?.trim();
  if (!region || !bucket) throw new Error("Price Check upload storage is not configured.");
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error("Price Check upload storage credentials are incomplete.");
  }
  return { region, bucket, accessKeyId, secretAccessKey };
}

export function createUploadS3Client(config = getUploadStorageConfig()) {
  return new S3Client({
    region: config.region,
    ...(config.accessKeyId && config.secretAccessKey
      ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
      : {}),
  });
}
