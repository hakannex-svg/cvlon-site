/**
 * Marketplace-private upload limits and format policy.
 *
 * Deliberately its own namespace, cookie, object prefix and limit set. Nothing
 * here is shared with the Price Check upload pipeline: a Price Check cookie,
 * handle or object key must never resolve anything on this side, and a change
 * to one workflow's limits must never silently move the other's.
 *
 * Evidence a seller attaches is exactly that — evidence for staff to look at.
 * It is not company verification, custody proof, authenticity, certification,
 * regulatory or airworthiness approval, or fitness for a purpose, and nothing
 * in this pipeline records it as any of those.
 */
export const MARKETPLACE_UPLOAD_COOKIE = "__Host-cvlon_mk_upload";

/** How long one seller's upload session stays usable. */
export const MARKETPLACE_UPLOAD_SESSION_SECONDS = 2 * 60 * 60;
/** How long one presigned POST stays usable. Short: it is a single put. */
export const MARKETPLACE_UPLOAD_AUTHORIZATION_SECONDS = 10 * 60;

/**
 * Exactly the ceilings the approved schema encodes
 * (`marketplace_upload_sessions_count_chk`, `..._bytes_chk`,
 * `marketplace_pending_uploads_bytes_chk`). They are restated here so the
 * application refuses a request the database would also refuse, rather than
 * discovering the limit as a constraint violation mid-transaction.
 */
export const MARKETPLACE_UPLOAD_MAX_FILES = 12;
export const MARKETPLACE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const MARKETPLACE_UPLOAD_MAX_SESSION_BYTES = 200 * 1024 * 1024;

/** Object namespace. The schema check constraint requires this exact prefix. */
export const MARKETPLACE_OBJECT_PREFIX = "marketplace/";
export const MARKETPLACE_QUARANTINE_PREFIX = "marketplace/quarantine/";

export const marketplaceUploadPurposes = [
  "INVENTORY_SPREADSHEET",
  "WAREHOUSE_BUSINESS_EVIDENCE",
  "CUSTODY_PART_PHOTO",
  "PART_NUMBER_SERIAL_PHOTO",
  "RELEASE_SUPPORTING_DOCUMENT",
  "OTHER",
] as const;

export type MarketplaceUploadPurpose = (typeof marketplaceUploadPurposes)[number];

/**
 * The complete accepted format list.
 *
 * XLS and XLSM are absent on purpose: the first is an OLE compound document
 * whose macro streams are indistinguishable from data without parsing, and the
 * second is macro-enabled by definition. A bare ZIP is absent for the same
 * reason — an archive is a container for anything at all. Only macro-free XLSX
 * and plain CSV are accepted for inventory, and the content check below proves
 * that rather than trusting the extension.
 */
export const MARKETPLACE_PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const MARKETPLACE_DOCUMENT_MIME = ["application/pdf"] as const;
export const MARKETPLACE_SPREADSHEET_MIME = [
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const MARKETPLACE_UPLOAD_ALLOWED_MIME = [
  ...MARKETPLACE_PHOTO_MIME,
  ...MARKETPLACE_DOCUMENT_MIME,
  ...MARKETPLACE_SPREADSHEET_MIME,
] as const;

export type MarketplaceUploadMime = (typeof MARKETPLACE_UPLOAD_ALLOWED_MIME)[number];

export const marketplaceExtensionForMime: Record<MarketplaceUploadMime, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "text/csv": ["csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
};

/**
 * Which formats each purpose accepts.
 *
 * A purpose is not decoration: a spreadsheet may only arrive as an inventory
 * list, and a custody or part-number photo may only be a photo. Letting any
 * format serve any purpose would make the purpose field unusable for staff and
 * would let a spreadsheet slip in under a photo label, past the stricter
 * spreadsheet content rules.
 */
export const marketplaceMimeForPurpose: Record<
  MarketplaceUploadPurpose,
  readonly MarketplaceUploadMime[]
> = {
  INVENTORY_SPREADSHEET: MARKETPLACE_SPREADSHEET_MIME,
  WAREHOUSE_BUSINESS_EVIDENCE: [...MARKETPLACE_DOCUMENT_MIME, ...MARKETPLACE_PHOTO_MIME],
  CUSTODY_PART_PHOTO: MARKETPLACE_PHOTO_MIME,
  PART_NUMBER_SERIAL_PHOTO: MARKETPLACE_PHOTO_MIME,
  RELEASE_SUPPORTING_DOCUMENT: [...MARKETPLACE_DOCUMENT_MIME, ...MARKETPLACE_PHOTO_MIME],
  OTHER: [...MARKETPLACE_DOCUMENT_MIME, ...MARKETPLACE_PHOTO_MIME],
};

/**
 * Per-format ceilings under the global 50 MB cap. A photograph taken on a phone
 * is single-digit megabytes; a 50 MB one is a scanner artefact or a payload
 * wearing a photo extension, and there is no seller need it serves.
 */
export const MARKETPLACE_PHOTO_MAX_BYTES = 25 * 1024 * 1024;

export function marketplaceMaxBytesForMime(mime: MarketplaceUploadMime) {
  return (MARKETPLACE_PHOTO_MIME as readonly string[]).includes(mime)
    ? MARKETPLACE_PHOTO_MAX_BYTES
    : MARKETPLACE_UPLOAD_MAX_BYTES;
}

/**
 * How much of an object the submit-time content check reads.
 *
 * Bounded ranged reads, never the whole object: a 50 MB spreadsheet pulled into
 * a serverless function twelve times over would be the memory and timeout
 * ceiling of the request, and every signature this pipeline checks lives in the
 * first or last few kilobytes. The ZIP end-of-central-directory that proves an
 * XLSX carries no macro part is at the tail, which is why both ends are read.
 */
export const MARKETPLACE_SIGNATURE_HEAD_BYTES = 128 * 1024;
export const MARKETPLACE_SIGNATURE_TAIL_BYTES = 128 * 1024;
