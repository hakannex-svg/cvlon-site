import "../../../db/price-check/server-boundary.ts";

import { randomBytes } from "node:crypto";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { PriceCheckDb } from "../../../db/price-check/index.ts";
import {
  authorizePendingUpload,
  findActiveUploadSession,
} from "../../../db/price-check/repositories/upload-repository.ts";
import { createUploadS3Client, getUploadStorageConfig } from "./config.ts";
import {
  PRICE_CHECK_UPLOAD_AUTHORIZATION_SECONDS,
  PRICE_CHECK_UPLOAD_MAX_BYTES,
} from "./constants.ts";
import { validateUploadDeclaration } from "./file-validation.ts";
import { hashUploadSessionToken, newUploadSessionToken } from "./session.ts";

export async function authorizePriceCheckUpload(
  db: PriceCheckDb,
  raw: unknown,
  existingToken: string | null,
) {
  const declaration = validateUploadDeclaration(raw);
  const active = existingToken
    ? await findActiveUploadSession(db, hashUploadSessionToken(existingToken))
    : null;
  const token = active ? existingToken! : newUploadSessionToken();
  const tokenHash = hashUploadSessionToken(token);
  const objectKey = `quarantine/${randomBytes(32).toString("base64url")}`;
  const pending = await authorizePendingUpload(db, {
    session: active ? { id: active.id, tokenHash: active.tokenHash } : null,
    tokenHash,
    filename: declaration.filename,
    mime: declaration.mime,
    size: declaration.size,
    objectKey,
  });
  const config = getUploadStorageConfig();
  const signed = await createPresignedPost(createUploadS3Client(config), {
    Bucket: config.bucket,
    Key: objectKey,
    Expires: PRICE_CHECK_UPLOAD_AUTHORIZATION_SECONDS,
    Fields: {
      "Content-Type": declaration.mime,
      "x-amz-meta-upload-handle": pending.handle,
    },
    Conditions: [
      ["content-length-range", 1, PRICE_CHECK_UPLOAD_MAX_BYTES],
      { "Content-Type": declaration.mime },
      { "x-amz-meta-upload-handle": pending.handle },
    ],
  });
  return {
    token,
    handle: pending.handle,
    upload: signed,
    expiresInSeconds: PRICE_CHECK_UPLOAD_AUTHORIZATION_SECONDS,
    filename: declaration.filename,
    size: declaration.size,
  };
}

