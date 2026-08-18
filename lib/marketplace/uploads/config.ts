import "../../../db/price-check/server-boundary.ts";

import { S3Client } from "@aws-sdk/client-s3";

/**
 * Marketplace upload storage configuration.
 *
 * Deliberately reads only `MARKETPLACE_UPLOAD_*` variables. There is no
 * fallback to the Price Check bucket: inheriting it would put supplier evidence
 * into a bucket whose policy, lifecycle and GuardDuty prefix were approved for
 * a different workload, and the operator would never be told. Unset means
 * uploads are unavailable, which is the correct answer until the marketplace
 * bucket exists.
 */
export type MarketplaceUploadStorageConfig = {
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export function getMarketplaceUploadStorageConfig(
  env: Record<string, string | undefined> = process.env,
): MarketplaceUploadStorageConfig {
  const region = env.MARKETPLACE_UPLOAD_AWS_REGION?.trim();
  const bucket = env.MARKETPLACE_UPLOAD_BUCKET?.trim();
  const accessKeyId = env.MARKETPLACE_UPLOAD_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.MARKETPLACE_UPLOAD_AWS_SECRET_ACCESS_KEY?.trim();
  if (!region || !bucket) throw new Error("MARKETPLACE_UPLOAD_STORAGE_UNCONFIGURED");
  // A half-supplied credential pair means an operator meant to use explicit
  // keys and mistyped one. Falling through to the instance role would silently
  // use an identity nobody chose.
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error("MARKETPLACE_UPLOAD_STORAGE_CREDENTIALS_INCOMPLETE");
  }
  return { region, bucket, accessKeyId, secretAccessKey };
}

/** True when the operator has configured marketplace storage at all. */
export function isMarketplaceUploadStorageConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  try {
    getMarketplaceUploadStorageConfig(env);
    return true;
  } catch {
    return false;
  }
}

export function createMarketplaceUploadS3Client(
  config = getMarketplaceUploadStorageConfig(),
) {
  return new S3Client({
    region: config.region,
    ...(config.accessKeyId && config.secretAccessKey
      ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
      : {}),
  });
}
