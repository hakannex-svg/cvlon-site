/**
 * Internal-only review vocabulary for marketplace contacts and seller evidence.
 *
 * This is a staff working status and nothing more. It is not customer
 * verification, certification, airworthiness approval, regulatory approval,
 * authenticity proof, a fitness guarantee, supplier approval, or a public
 * reputation score, and it must never reach a customer-facing surface.
 */

export const internalReviewStates = [
  "not_reviewed",
  "reviewed",
  "concern",
] as const;
export type InternalReviewState = (typeof internalReviewStates)[number];

export function isInternalReviewState(value: unknown): value is InternalReviewState {
  return typeof value === "string" && internalReviewStates.includes(value as InternalReviewState);
}

/**
 * The evidence purpose categories, matching `marketplace_upload_purpose`. Kept
 * as a literal list so this module stays free of the schema layer.
 */
export const evidencePurposeCategories = [
  "INVENTORY_SPREADSHEET",
  "WAREHOUSE_BUSINESS_EVIDENCE",
  "CUSTODY_PART_PHOTO",
  "PART_NUMBER_SERIAL_PHOTO",
  "RELEASE_SUPPORTING_DOCUMENT",
  "OTHER",
] as const;
export type EvidencePurposeCategory = (typeof evidencePurposeCategories)[number];

export type EvidenceCategoryState =
  /** No live attachment carries this purpose. */
  | "missing"
  /** Supplied, and at least one live attachment is not yet reviewed. */
  | "not_reviewed"
  /** Supplied, and every live attachment is reviewed. */
  | "reviewed"
  /** Supplied, and at least one live attachment is marked concern. */
  | "concern";

export type EvidenceCategorySummary = {
  purpose: EvidencePurposeCategory;
  /** Live (nondeleted) attachments carrying this purpose. */
  count: number;
  state: EvidenceCategoryState;
};

/**
 * Derives the per-category evidence summary from the already-bound attachments.
 * Purely derived — nothing here is stored, so the summary can never disagree
 * with the attachment rows it came from. Deleted attachments never count.
 */
export function summarizeEvidenceCategories(
  attachments: readonly { purpose: string; reviewState: string; deletedAt: Date | null }[],
): EvidenceCategorySummary[] {
  return evidencePurposeCategories.map((purpose) => {
    const live = attachments.filter(
      (attachment) => attachment.purpose === purpose && !attachment.deletedAt,
    );
    if (live.length === 0) return { purpose, count: 0, state: "missing" as const };
    if (live.some((attachment) => attachment.reviewState === "concern")) {
      return { purpose, count: live.length, state: "concern" as const };
    }
    if (live.every((attachment) => attachment.reviewState === "reviewed")) {
      return { purpose, count: live.length, state: "reviewed" as const };
    }
    return { purpose, count: live.length, state: "not_reviewed" as const };
  });
}
