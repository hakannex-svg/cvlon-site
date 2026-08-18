import {
  MARKETPLACE_PHOTO_MAX_BYTES,
  MARKETPLACE_UPLOAD_MAX_BYTES,
  MARKETPLACE_UPLOAD_MAX_FILES,
  MARKETPLACE_UPLOAD_MAX_SESSION_BYTES,
  type MarketplaceUploadPurpose,
} from "./uploads/constants.ts";

/**
 * Browser-side view of the upload policy.
 *
 * Deliberately a plain module rather than part of the component: the limits and
 * the purpose/format matrix are contract, and keeping them here means they can
 * be asserted against the server's own constants without rendering anything.
 * Nothing in this file relaxes a server rule — the server re-checks every one of
 * them against the stored bytes, and this exists only to spare a seller a round
 * trip that could never have succeeded.
 *
 * The limits are re-exported from the server constants, not restated, so the two
 * cannot drift.
 */
export const SELL_UPLOAD_MAX_FILES = MARKETPLACE_UPLOAD_MAX_FILES;
export const SELL_UPLOAD_MAX_BYTES = MARKETPLACE_UPLOAD_MAX_BYTES;
export const SELL_UPLOAD_MAX_PHOTO_BYTES = MARKETPLACE_PHOTO_MAX_BYTES;
export const SELL_UPLOAD_MAX_TOTAL_BYTES = MARKETPLACE_UPLOAD_MAX_SESSION_BYTES;

const PHOTO_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
const DOCUMENT_ACCEPT = `.pdf,application/pdf,${PHOTO_ACCEPT}`;
const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const DOCUMENT_MIMES = ["application/pdf", ...PHOTO_MIMES] as const;

export type SellUploadOption = {
  value: MarketplaceUploadPurpose;
  label: string;
  hint: string;
  accept: string;
  mimes: readonly string[];
};

/**
 * The seller-facing purpose list, in the order it is offered.
 *
 * Each entry states the formats the server accepts for that purpose, so an
 * impossible pairing — a spreadsheet filed as a custody photo, say — is refused
 * before a request is made rather than after one.
 */
export const sellUploadOptions: readonly SellUploadOption[] = [
  {
    value: "INVENTORY_SPREADSHEET",
    label: "Inventory list",
    hint: "CSV or XLSX. Macro-enabled and password-protected files are not accepted.",
    accept: ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mimes: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  {
    value: "PART_NUMBER_SERIAL_PHOTO",
    label: "Part number / serial photo",
    hint: "A photo you already have of the nameplate, part number or serial.",
    accept: PHOTO_ACCEPT,
    mimes: PHOTO_MIMES,
  },
  {
    value: "CUSTODY_PART_PHOTO",
    label: "Part / condition photo",
    hint: "A photo you already have of the part or its condition.",
    accept: PHOTO_ACCEPT,
    mimes: PHOTO_MIMES,
  },
  {
    value: "RELEASE_SUPPORTING_DOCUMENT",
    label: "Supporting documentation",
    hint: "PDF or a photo. Documentation varies by part and source.",
    accept: DOCUMENT_ACCEPT,
    mimes: DOCUMENT_MIMES,
  },
  {
    value: "WAREHOUSE_BUSINESS_EVIDENCE",
    label: "Warehouse or business evidence",
    hint: "PDF or a photo. Optional — Civilon does not require business proof to review an offer.",
    accept: DOCUMENT_ACCEPT,
    mimes: DOCUMENT_MIMES,
  },
  {
    value: "OTHER",
    label: "Something else",
    hint: "PDF or a photo.",
    accept: DOCUMENT_ACCEPT,
    mimes: DOCUMENT_MIMES,
  },
];

export const sellUploadOptionByValue = new Map(
  sellUploadOptions.map((option) => [option.value, option]),
);

/**
 * Resolves the type the server will be told about.
 *
 * Browsers report `File.type` inconsistently often enough that trusting it alone
 * produces avoidable refusals — Windows reports a CSV as `application/vnd.ms-excel`.
 * The extension decides instead, and the result is always one of the six types
 * the server accepts or null. The server verifies the actual bytes regardless,
 * so this is a convenience, never a security decision.
 */
export function resolveSellUploadMime(filename: string): string | null {
  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const byExtension: Record<string, string> = {
    csv: "text/csv",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return byExtension[extension] ?? null;
}

/** The ceiling that applies to one file, matching the server's per-format rule. */
export function sellUploadCeiling(mime: string) {
  return mime.startsWith("image/") ? SELL_UPLOAD_MAX_PHOTO_BYTES : SELL_UPLOAD_MAX_BYTES;
}

export function formatSellUploadSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
