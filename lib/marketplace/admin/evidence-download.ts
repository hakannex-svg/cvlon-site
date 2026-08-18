import "../../../db/price-check/server-boundary.ts";

import { GetObjectCommand, GetObjectTaggingCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { PriceCheckDb } from "../../../db/price-check/index.ts";
import {
  getSellSubmissionEvidenceObject,
  recordSellEvidenceViewAuthorized,
} from "../../../db/price-check/repositories/marketplace-evidence-repository.ts";
import { MARKETPLACE_UPLOAD_ALLOWED_MIME } from "../uploads/constants.ts";
import {
  createMarketplaceUploadS3Client,
  getMarketplaceUploadStorageConfig,
} from "../uploads/config.ts";
import { MARKETPLACE_SCAN_TAG, marketplaceScanDecision } from "../uploads/scan.ts";

/**
 * Authenticated, record-bound, scan-gated staff access to seller evidence.
 *
 * The stored scan state is a bind-time snapshot, so it is necessary but not
 * sufficient. Before anything is signed the live GuardDuty tag is read again:
 * an object that was clean at upload and has since been retagged must not be
 * handed to staff, and the bucket policy would refuse it anyway — this turns
 * that refusal into a readable answer instead of an opaque S3 403.
 *
 * The object key never leaves this module. Callers receive a short-lived
 * redirect target or a generic outcome, never a key, a bucket or a provider
 * diagnostic.
 */

/** Short enough that a leaked link in a browser history is not a standing grant. */
export const EVIDENCE_DOWNLOAD_EXPIRY_SECONDS = 120;

const FALLBACK_FILENAME = "civilon-evidence";
const FILENAME_MAX_LENGTH = 160;

/**
 * Reduces a seller-supplied filename to a set that cannot break out of the
 * header or the filesystem: letters, digits, dot, underscore, space and hyphen.
 * Everything else — CR, LF, quotes, semicolons, slashes, backslashes, control
 * characters, and every non-ASCII byte — becomes an underscore, and any run of
 * dots collapses so `..` can never survive as a traversal segment.
 */
export function safeEvidenceFilename(value: string) {
  const cleaned = value
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\.{2,}/g, "_")
    .slice(0, FILENAME_MAX_LENGTH)
    .trim();
  return cleaned || FALLBACK_FILENAME;
}

export function evidenceContentDisposition(value: string) {
  return `attachment; filename="${safeEvidenceFilename(value)}"`;
}

/**
 * Only a type the intake surface already accepts may be echoed back. Anything
 * else is served as an opaque download rather than something a browser might
 * choose to render inline.
 */
export function safeEvidenceContentType(detected: string | null, declared: string | null) {
  const allowed = MARKETPLACE_UPLOAD_ALLOWED_MIME as readonly string[];
  if (detected && allowed.includes(detected)) return detected;
  if (declared && allowed.includes(declared)) return declared;
  return "application/octet-stream";
}

export type EvidenceDownloadDeps = {
  /** Resolves the live GuardDuty tag value, or throws if it cannot be read. */
  readScanTag(objectKey: string): Promise<string | null | undefined>;
  /** Resolves a presigned GET URL, or throws. */
  signDownload(input: {
    objectKey: string;
    contentType: string;
    contentDisposition: string;
    expiresIn: number;
  }): Promise<string>;
};

/** The real AWS boundary. Isolated so tests never need a credential. */
export function defaultEvidenceDownloadDeps(): EvidenceDownloadDeps {
  return {
    async readScanTag(objectKey) {
      const config = getMarketplaceUploadStorageConfig();
      const client = createMarketplaceUploadS3Client(config);
      const tags = await client.send(
        new GetObjectTaggingCommand({ Bucket: config.bucket, Key: objectKey }),
      );
      const tagSet = tags.TagSet as Array<{ Key?: string; Value?: string }> | undefined;
      return tagSet?.find((tag) => tag.Key === MARKETPLACE_SCAN_TAG)?.Value;
    },
    async signDownload({ objectKey, contentType, contentDisposition, expiresIn }) {
      const config = getMarketplaceUploadStorageConfig();
      const client = createMarketplaceUploadS3Client(config);
      return getSignedUrl(client, new GetObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        ResponseContentType: contentType,
        ResponseContentDisposition: contentDisposition,
      }), { expiresIn });
    },
  };
}

export type EvidenceDownloadResult =
  /** No such attachment under this parent, or it is deleted. */
  | { outcome: "not_found" }
  /** Stored state or the live tag says this is not currently clean. */
  | { outcome: "not_clean" }
  /** Storage or configuration is unavailable. No diagnostic is carried. */
  | { outcome: "unavailable" }
  | { outcome: "ready"; signedUrl: string };

/**
 * Order matters and is deliberate: bind to the parent, check the stored state,
 * re-read the live tag, only then sign, and only then audit. Nothing is
 * recorded for a request that did not result in access.
 */
export async function authorizeSellEvidenceDownload(
  db: PriceCheckDb,
  input: { sellSubmissionId: string; attachmentId: string; actorId: string },
  deps: EvidenceDownloadDeps = defaultEvidenceDownloadDeps(),
): Promise<EvidenceDownloadResult> {
  const attachment = await getSellSubmissionEvidenceObject(db, input.sellSubmissionId, input.attachmentId);
  if (!attachment) return { outcome: "not_found" };

  // The stored snapshot must agree before the live tag is even consulted.
  if (attachment.scanState !== "CLEAN") return { outcome: "not_clean" };

  let liveTag: string | null | undefined;
  try {
    liveTag = await deps.readScanTag(attachment.objectKey);
  } catch {
    // Outage, permissions, or a missing object. Unknown is never clean, and the
    // reason is never reported to the caller.
    return { outcome: "unavailable" };
  }
  if (marketplaceScanDecision(liveTag) !== "CLEAN") return { outcome: "not_clean" };

  let signedUrl: string;
  try {
    signedUrl = await deps.signDownload({
      objectKey: attachment.objectKey,
      contentType: safeEvidenceContentType(attachment.detectedMime, attachment.declaredMime),
      contentDisposition: evidenceContentDisposition(attachment.displayFilename),
      expiresIn: EVIDENCE_DOWNLOAD_EXPIRY_SECONDS,
    });
  } catch {
    return { outcome: "unavailable" };
  }

  await recordSellEvidenceViewAuthorized(db, {
    sellSubmissionId: input.sellSubmissionId,
    attachmentId: input.attachmentId,
    actorId: input.actorId,
  });

  return { outcome: "ready", signedUrl };
}
