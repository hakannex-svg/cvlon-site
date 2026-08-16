import "../../../db/price-check/server-boundary.ts";

import { S3Client } from "@aws-sdk/client-s3";

export type UploadStorageConfig = {
  region: string;
  bucket: string;
};

export function getUploadStorageConfig(): UploadStorageConfig {
  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.PRICE_CHECK_UPLOAD_BUCKET?.trim();
  if (!region || !bucket) throw new Error("Price Check upload storage is not configured.");
  return { region, bucket };
}

export function createUploadS3Client(config = getUploadStorageConfig()) {
  return new S3Client({ region: config.region });
}

