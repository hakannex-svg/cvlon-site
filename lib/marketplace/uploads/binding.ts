import "../../../db/price-check/server-boundary.ts";

import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

import type { PriceCheckDb } from "../../../db/price-check/index.ts";
import { generateOrderedId } from "../../../db/price-check/domain/identifiers.ts";
import {
  findClaimableMarketplaceUploads,
  type MarketplaceUploadAggregate,
} from "../../../db/price-check/repositories/marketplace-upload-repository.ts";
import {
  createMarketplaceUploadS3Client,
  getMarketplaceUploadStorageConfig,
} from "./config.ts";
import {
  MARKETPLACE_OBJECT_PREFIX,
  MARKETPLACE_SIGNATURE_HEAD_BYTES,
  MARKETPLACE_SIGNATURE_TAIL_BYTES,
  MARKETPLACE_UPLOAD_MAX_FILES,
  MARKETPLACE_UPLOAD_MAX_SESSION_BYTES,
} from "./constants.ts";
import { verifyMarketplaceUploadContent } from "./file-validation.ts";
import {
  MARKETPLACE_SCAN_PENDING_CODE,
  MARKETPLACE_SCAN_REJECTED_CODE,
  MARKETPLACE_SCAN_TAG,
  MARKETPLACE_SCAN_UNAVAILABLE_CODE,
  marketplaceScanDecision,
} from "./scan.ts";

export type PreparedMarketplaceAttachment = {
  id: string;
  pendingUploadId: string;
  uploadSessionId: string;
  displayFilename: string;
  objectKey: string;
  declaredMime: string;
  detectedMime: string;
  purpose: string;
  byteSize: number;
};

type StorageClient = {
  send(command: unknown): Promise<Record<string, unknown>>;
};

export type BindingDependencies = {
  findClaimable: typeof findClaimableMarketplaceUploads;
  storage: () => { client: StorageClient; bucket: string };
};

const defaultDependencies: BindingDependencies = {
  findClaimable: findClaimableMarketplaceUploads,
  storage: () => {
    const config = getMarketplaceUploadStorageConfig();
    return {
      client: createMarketplaceUploadS3Client(config) as unknown as StorageClient,
      bucket: config.bucket,
    };
  },
};

async function readRange(
  client: StorageClient,
  bucket: string,
  key: string,
  range: string,
): Promise<Uint8Array> {
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
  const body = object.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) throw new Error("MARKETPLACE_UPLOAD_UNREADABLE");
  return body.transformToByteArray();
}

/**
 * Verifies every declared handle and returns rows ready to be claimed.
 *
 * All network work happens here, before the Sell Submission transaction opens.
 * That split is the Price Check pattern and it exists for a hard reason: an S3
 * round trip inside a database transaction holds row locks for the length of a
 * network call, and a storage timeout would then be a stuck transaction rather
 * than a failed request.
 *
 * The order of checks is the security argument:
 *
 *  1. Ownership, from the database. The handle must belong to this session,
 *     this session must be live and must have been opened for this aggregate,
 *     and the row must be unclaimed. A handle that fails any of these never
 *     reaches storage at all.
 *  2. Scan evidence, from the object's tags. Nothing is read from the object
 *     until GuardDuty has tagged it clean — a missing or non-clean tag stops
 *     the submission here, and the caller reports "still being checked" rather
 *     than storing an unverified file. This is the fail-closed point: absent
 *     evidence is never treated as clean.
 *  3. Existence and size, from HeadObject. The stored object must be exactly
 *     the length the seller declared and reserved against their session budget.
 *  4. Content, from bounded ranged reads. The bytes must actually be the format
 *     the declaration claimed, must not be encrypted where that is detectable,
 *     and must carry no macro part. Contents are never parsed, extracted, or
 *     sent anywhere: no cell is read, no formula is evaluated, and no AI sees
 *     any of it.
 */
export async function prepareMarketplaceAttachments(
  db: PriceCheckDb,
  input: {
    handles: string[];
    uploadSessionToken: string | null | undefined;
    tokenHash: string | null;
    intendedAggregateType: MarketplaceUploadAggregate;
  },
  dependencies: BindingDependencies = defaultDependencies,
): Promise<PreparedMarketplaceAttachment[]> {
  if (input.handles.length === 0) return [];
  if (!input.uploadSessionToken || !input.tokenHash) {
    throw new Error("MARKETPLACE_UPLOAD_SESSION_MISSING");
  }
  const unique = [...new Set(input.handles)];
  if (unique.length !== input.handles.length || unique.length > MARKETPLACE_UPLOAD_MAX_FILES) {
    throw new Error("MARKETPLACE_UPLOAD_HANDLES_INVALID");
  }

  const pending = await dependencies.findClaimable(db, {
    tokenHash: input.tokenHash,
    handles: unique,
    intendedAggregateType: input.intendedAggregateType,
  });
  // A short result means at least one handle was expired, already used, owned
  // by a different session, or opened for the other aggregate. Which one is
  // deliberately not distinguished for the caller.
  if (pending.length !== unique.length) {
    throw new Error("MARKETPLACE_UPLOAD_HANDLES_UNAVAILABLE");
  }

  const totalBytes = pending.reduce((sum, item) => sum + Number(item.expectedByteSize), 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MARKETPLACE_UPLOAD_MAX_SESSION_BYTES) {
    throw new Error("MARKETPLACE_UPLOAD_TOTAL_TOO_LARGE");
  }

  const { client, bucket } = dependencies.storage();
  const byId = new Map(pending.map((item) => [item.id, item]));
  const prepared: PreparedMarketplaceAttachment[] = [];

  for (const handle of unique) {
    const item = byId.get(handle)!;
    // The key came from the server at authorize time, but it is re-checked:
    // a marketplace attachment outside the marketplace namespace would be a
    // row the database check constraint refuses anyway, and finding out here
    // is better than finding out mid-transaction.
    if (!item.objectKey.startsWith(MARKETPLACE_OBJECT_PREFIX)) {
      throw new Error("MARKETPLACE_UPLOAD_KEY_INVALID");
    }

    let tagSet: Array<{ Key?: string; Value?: string }> | undefined;
    try {
      const tags = await client.send(
        new GetObjectTaggingCommand({ Bucket: bucket, Key: item.objectKey }),
      );
      tagSet = tags.TagSet as Array<{ Key?: string; Value?: string }> | undefined;
    } catch {
      // Tags could not be read at all: outage, permissions, or a missing
      // object. Unknown is never clean.
      throw new Error(MARKETPLACE_SCAN_UNAVAILABLE_CODE);
    }
    const decision = marketplaceScanDecision(
      tagSet?.find((tag) => tag.Key === MARKETPLACE_SCAN_TAG)?.Value,
    );
    if (decision === "PENDING") throw new Error(MARKETPLACE_SCAN_PENDING_CODE);
    if (decision === "FAILED") throw new Error(MARKETPLACE_SCAN_UNAVAILABLE_CODE);
    if (decision !== "CLEAN") throw new Error(MARKETPLACE_SCAN_REJECTED_CODE);

    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: item.objectKey }));
    const storedSize = Number(head.ContentLength);
    const expectedSize = Number(item.expectedByteSize);
    if (!Number.isSafeInteger(storedSize) || storedSize !== expectedSize || storedSize < 1) {
      throw new Error("MARKETPLACE_UPLOAD_SIZE_MISMATCH");
    }
    // The presigned POST bound Content-Type as a policy condition, so a stored
    // object always carries the declared type. An absent or different one means
    // the object is not the one this handle authorized — refused rather than
    // waved through on the grounds that the content check runs later anyway.
    if (head.ContentType !== item.declaredMime) {
      throw new Error("MARKETPLACE_UPLOAD_TYPE_MISMATCH");
    }

    const headBytes = await readRange(
      client,
      bucket,
      item.objectKey,
      `bytes=0-${Math.min(storedSize, MARKETPLACE_SIGNATURE_HEAD_BYTES) - 1}`,
    );
    const tailBytes = storedSize <= MARKETPLACE_SIGNATURE_HEAD_BYTES
      ? headBytes
      : await readRange(
          client,
          bucket,
          item.objectKey,
          `bytes=-${Math.min(storedSize, MARKETPLACE_SIGNATURE_TAIL_BYTES)}`,
        );

    const verdict = verifyMarketplaceUploadContent({
      head: headBytes,
      tail: tailBytes,
      size: storedSize,
      declaredMime: item.declaredMime,
    });

    prepared.push({
      id: generateOrderedId(),
      pendingUploadId: item.id,
      uploadSessionId: item.uploadSessionId,
      displayFilename: item.displayFilename,
      objectKey: item.objectKey,
      declaredMime: item.declaredMime,
      detectedMime: verdict.detectedMime,
      purpose: item.purpose,
      byteSize: storedSize,
    });
  }

  return prepared;
}
