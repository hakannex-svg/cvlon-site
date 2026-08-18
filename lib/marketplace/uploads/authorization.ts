import "../../../db/price-check/server-boundary.ts";

import { randomBytes } from "node:crypto";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

import type { PriceCheckDb } from "../../../db/price-check/index.ts";
import {
  authorizeMarketplacePendingUpload,
  findActiveMarketplaceUploadSession,
  type MarketplaceUploadAggregate,
} from "../../../db/price-check/repositories/marketplace-upload-repository.ts";
import {
  createMarketplaceUploadS3Client,
  getMarketplaceUploadStorageConfig,
} from "./config.ts";
import {
  MARKETPLACE_QUARANTINE_PREFIX,
  MARKETPLACE_UPLOAD_AUTHORIZATION_SECONDS,
  marketplaceMaxBytesForMime,
} from "./constants.ts";
import { validateMarketplaceUploadDeclaration } from "./file-validation.ts";
import {
  hashMarketplaceUploadSessionToken,
  marketplaceUploadSessionKey,
  newMarketplaceUploadSessionToken,
} from "./session.ts";

/**
 * The only aggregate that may open an upload session today.
 *
 * Buy Request evidence is a later slice. Accepting `buy_request` here would
 * mint sessions and objects nothing can ever claim, which is storage a seller
 * paid for with their time and Civilon pays for with a bucket lifecycle.
 */
export const MARKETPLACE_UPLOAD_SUPPORTED_AGGREGATES = ["sell_submission"] as const;

export function isSupportedUploadAggregate(value: unknown): value is MarketplaceUploadAggregate {
  return typeof value === "string"
    && (MARKETPLACE_UPLOAD_SUPPORTED_AGGREGATES as readonly string[]).includes(value);
}

/**
 * Authorizes exactly one direct-to-storage upload.
 *
 * The presigned POST is the narrowest one this storage pattern supports: an
 * exact key the server chose, an exact content type, an exact handle in object
 * metadata, and a content-length range bounded by the per-format ceiling. The
 * browser therefore receives a permission to place one specific object and
 * nothing else — no bucket-wide credential, no key it can influence, and no
 * secret it can reuse after the short expiry.
 *
 * The object key carries 32 random bytes and no seller-supplied text, so a key
 * can neither be guessed nor made to collide with an existing object, and a
 * filename can never traverse into another prefix.
 */
export async function authorizeMarketplaceUpload(
  db: PriceCheckDb,
  raw: unknown,
  existingToken: string | null,
  intendedAggregateType: MarketplaceUploadAggregate = "sell_submission",
) {
  const declaration = validateMarketplaceUploadDeclaration(raw);
  const key = marketplaceUploadSessionKey();

  const active = existingToken
    ? await findActiveMarketplaceUploadSession(
        db,
        hashMarketplaceUploadSessionToken(key, existingToken),
        intendedAggregateType,
      )
    : null;
  const token = active ? existingToken! : newMarketplaceUploadSessionToken();
  const tokenHash = hashMarketplaceUploadSessionToken(key, token);
  const objectKey = `${MARKETPLACE_QUARANTINE_PREFIX}${intendedAggregateType}/${randomBytes(32).toString("base64url")}`;

  const pending = await authorizeMarketplacePendingUpload(db, {
    session: active ? { id: active.id, tokenHash: active.tokenHash } : null,
    tokenHash,
    intendedAggregateType,
    filename: declaration.filename,
    mime: declaration.mime,
    size: declaration.size,
    purpose: declaration.purpose,
    objectKey,
  });

  const config = getMarketplaceUploadStorageConfig();
  const signed = await createPresignedPost(createMarketplaceUploadS3Client(config), {
    Bucket: config.bucket,
    Key: objectKey,
    Expires: MARKETPLACE_UPLOAD_AUTHORIZATION_SECONDS,
    Fields: {
      "Content-Type": declaration.mime,
      "x-amz-meta-upload-handle": pending.handle,
      "x-amz-meta-upload-purpose": declaration.purpose,
    },
    Conditions: [
      // The exact declared size, not a range. The seller already told us how
      // large the file is, so storage can hold them to it: a swapped payload of
      // any other length is refused by S3 itself, before a byte is stored and
      // long before the submit-time content check would have to catch it.
      ["content-length-range", declaration.size, declaration.size],
      { "Content-Type": declaration.mime },
      { "x-amz-meta-upload-handle": pending.handle },
      { "x-amz-meta-upload-purpose": declaration.purpose },
    ],
  });

  return {
    token,
    handle: pending.handle,
    upload: signed,
    expiresInSeconds: MARKETPLACE_UPLOAD_AUTHORIZATION_SECONDS,
    filename: declaration.filename,
    size: declaration.size,
    purpose: declaration.purpose,
    maxBytes: marketplaceMaxBytesForMime(declaration.mime),
  };
}
