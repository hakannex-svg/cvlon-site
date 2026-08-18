/**
 * The vocabulary of a follow-up seller-evidence request.
 *
 * Staff ask for evidence categories that already exist in the upload policy;
 * nothing here invents a new kind of file, a new retention class, or a new
 * review state. Asking for evidence, receiving it, and marking it reviewed are
 * internal working steps. None of them is business-email verification, company
 * verification, supplier approval, certification, authenticity proof,
 * airworthiness approval, regulatory approval, or a quality or fitness
 * guarantee, and none of them obliges Civilon to buy anything.
 *
 * Kept free of the schema layer so the allowlist can be asserted against both
 * the database check constraint and the upload policy without importing either.
 */

/**
 * Exactly the categories a staff member may request.
 *
 * `OTHER` is present in `marketplace_upload_purpose` but deliberately absent
 * here: "send us something else" is not an instruction a seller can act on, and
 * a request that cannot be satisfied is worse than no request.
 */
export const sellEvidenceRequestCategories = [
  "WAREHOUSE_BUSINESS_EVIDENCE",
  "CUSTODY_PART_PHOTO",
  "PART_NUMBER_SERIAL_PHOTO",
  "RELEASE_SUPPORTING_DOCUMENT",
  "INVENTORY_SPREADSHEET",
] as const;

export type SellEvidenceRequestCategory =
  (typeof sellEvidenceRequestCategories)[number];

export function isSellEvidenceRequestCategory(
  value: unknown,
): value is SellEvidenceRequestCategory {
  return typeof value === "string"
    && (sellEvidenceRequestCategories as readonly string[]).includes(value);
}

/**
 * Seller-facing labels. Plain descriptions of what to send, with no claim about
 * what sending it proves.
 */
export const sellEvidenceCategoryLabels: Record<SellEvidenceRequestCategory, string> = {
  WAREHOUSE_BUSINESS_EVIDENCE: "Warehouse or business evidence",
  CUSTODY_PART_PHOTO: "Part or condition photo",
  PART_NUMBER_SERIAL_PHOTO: "Part number or serial / nameplate photo",
  RELEASE_SUPPORTING_DOCUMENT: "Supporting documentation",
  INVENTORY_SPREADSHEET: "Inventory list",
};

/**
 * Normalises a caller-supplied category list.
 *
 * Order is fixed to the canonical one and duplicates collapse, so the same set
 * asked for twice is stored identically and a rendered label list cannot be
 * made to repeat itself. Returns null when anything is not an exact allowlist
 * member or when nothing is left: at least one category is always required.
 */
export function normalizeSellEvidenceCategories(
  values: readonly unknown[],
): SellEvidenceRequestCategory[] | null {
  if (values.length === 0 || values.length > sellEvidenceRequestCategories.length) return null;
  const chosen = new Set<SellEvidenceRequestCategory>();
  for (const value of values) {
    if (!isSellEvidenceRequestCategory(value)) return null;
    chosen.add(value);
  }
  if (chosen.size === 0) return null;
  return sellEvidenceRequestCategories.filter((category) => chosen.has(category));
}

/**
 * How a stored request reads to staff. Derived, never stored: a status column
 * would be a second copy of the four timestamps that already say it.
 */
export type SellEvidenceRequestState =
  | "awaiting_seller"
  | "submitted"
  | "expired"
  | "revoked";

export function sellEvidenceRequestState(
  request: {
    consumedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  },
  now: Date,
): SellEvidenceRequestState {
  if (request.consumedAt) return "submitted";
  if (request.revokedAt) return "revoked";
  if (request.expiresAt.valueOf() <= now.valueOf()) return "expired";
  return "awaiting_seller";
}
