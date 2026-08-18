import {
  isMarketplaceStatus,
  type MarketplaceAggregate,
} from "../../../db/price-check/domain/marketplace-status-policy.ts";
import {
  isInternalReviewState,
  type InternalReviewState,
} from "../../../db/price-check/domain/internal-review.ts";
import {
  normalizeSellEvidenceCategories,
  type SellEvidenceRequestCategory,
} from "../../../db/price-check/domain/sell-evidence-request.ts";

/**
 * Strict input validation for the marketplace admin mutations.
 *
 * Every validator rejects unknown keys outright rather than ignoring them: a
 * request carrying a field this build does not understand is a request written
 * against different assumptions, and silently dropping it is how a caller ends
 * up believing it set something it did not. Mirrors the Price Check idiom in
 * `lib/price-check/admin/validation.ts`.
 *
 * Error messages are safe to hand to the browser: they name the field, never
 * the record, the actor, or anything about why the record is in its state.
 */

export const UNASSIGNED_VALUE = "unassigned";
export const NOTE_MAX_LENGTH = 4000;
const RECORD_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** Control characters are never legitimate in a staff note. Tab and newline are. */
// eslint-disable-next-line no-control-regex -- deliberate control-character class
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function reject(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Rejects any key the caller did not declare. */
function unknownKeys(body: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(body).filter((key) => !allowed.includes(key));
}

export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && RECORD_ID_PATTERN.test(value);
}

export type StatusChangeInput = { expectedStatus: string; to: string };

/**
 * `expectedStatus` is required, not optional: it is the optimistic-concurrency
 * token. A client that does not send the status it believes it saw cannot be
 * told its view was stale, so the field has no safe default.
 */
export function validateMarketplaceStatusChange(
  aggregate: MarketplaceAggregate,
  raw: unknown,
): ValidationResult<StatusChangeInput> {
  const body = asObject(raw);
  if (!body) return reject("A request body is required.");
  const extra = unknownKeys(body, ["expectedStatus", "to"]);
  if (extra.length) return reject("Unexpected fields were rejected.");

  const { expectedStatus, to } = body;
  if (!isMarketplaceStatus(aggregate, expectedStatus)) return reject("The current status is not recognised.");
  if (!isMarketplaceStatus(aggregate, to)) return reject("Choose a valid status.");
  if (expectedStatus === to) return reject("The record is already in that status.");
  return { ok: true, data: { expectedStatus, to } };
}

export type AssignmentInput = { assigneeId: string | null };

export function validateMarketplaceAssignment(raw: unknown): ValidationResult<AssignmentInput> {
  const body = asObject(raw);
  if (!body) return reject("A request body is required.");
  const extra = unknownKeys(body, ["assigneeId"]);
  if (extra.length) return reject("Unexpected fields were rejected.");

  const { assigneeId } = body;
  // `null` and the `unassigned` literal both mean "no owner". A missing key does
  // not: an absent field is a malformed request, not an instruction to unassign.
  if (assigneeId === null || assigneeId === UNASSIGNED_VALUE) return { ok: true, data: { assigneeId: null } };
  if (!isRecordId(assigneeId)) return reject("Choose a valid assignee.");
  return { ok: true, data: { assigneeId } };
}

export type NoteInput = { body: string };

export function validateMarketplaceNote(raw: unknown): ValidationResult<NoteInput> {
  const payload = asObject(raw);
  if (!payload) return reject("A request body is required.");
  const extra = unknownKeys(payload, ["body"]);
  if (extra.length) return reject("Unexpected fields were rejected.");

  const { body } = payload;
  if (typeof body !== "string") return reject("Write a note before saving.");
  // Normalise line endings, then require something other than whitespace, which
  // is also what `marketplace_notes_body_chk` enforces in the database.
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized) return reject("Write a note before saving.");
  if (normalized.length > NOTE_MAX_LENGTH) return reject(`Keep the note under ${NOTE_MAX_LENGTH} characters.`);
  if (CONTROL_CHARACTERS.test(normalized)) return reject("Remove control characters from the note.");
  return { ok: true, data: { body: normalized } };
}

export type SellEvidenceRequestInput = { categories: SellEvidenceRequestCategory[] };

/**
 * Follow-up evidence request payload: one `categories` array, nothing else.
 *
 * The allowlist is exact and at least one entry is required. A staff member who
 * sends nothing has not asked for anything, and a category this build does not
 * recognise is refused rather than dropped — a silently ignored category would
 * mean a seller is never asked for evidence a staff member believes they
 * requested. Duplicates and ordering are normalised away, so the same request
 * made twice is stored identically.
 */
export function validateSellEvidenceRequest(
  raw: unknown,
): ValidationResult<SellEvidenceRequestInput> {
  const body = asObject(raw);
  if (!body) return reject("A request body is required.");
  const extra = unknownKeys(body, ["categories"]);
  if (extra.length) return reject("Unexpected fields were rejected.");

  const { categories } = body;
  if (!Array.isArray(categories)) return reject("Choose at least one kind of evidence.");
  if (categories.length === 0) return reject("Choose at least one kind of evidence.");
  const normalized = normalizeSellEvidenceCategories(categories);
  if (!normalized) return reject("Choose valid kinds of evidence.");
  return { ok: true, data: { categories: normalized } };
}

export type InventoryFreshnessRequestInput = Record<string, never>;

/**
 * Bulk-inventory freshness request payload: nothing at all.
 *
 * There is deliberately no field to send. Which record is asked is the path
 * parameter, the question is fixed, the fourteen-day expiry is a constant, and
 * the answer is the seller's to give — so a body with content would be a body
 * offering a staff member a choice the workflow does not have.
 *
 * An absent body and an empty object are both accepted, because a `fetch` with
 * no `body` and one sending `{}` are the same intent. Anything with a key is
 * refused rather than ignored: a caller sending `{"response":"all_available"}`
 * is a caller who believes staff can answer on the seller's behalf, and
 * silently dropping that field would let them keep believing it.
 */
export function validateInventoryFreshnessRequest(
  raw: unknown,
): ValidationResult<InventoryFreshnessRequestInput> {
  if (raw === null || raw === undefined) return { ok: true, data: {} };
  const body = asObject(raw);
  if (!body) return reject("Unexpected fields were rejected.");
  if (Object.keys(body).length > 0) return reject("Unexpected fields were rejected.");
  return { ok: true, data: {} };
}

export type InternalReviewInput = { state: InternalReviewState };

/** Internal review payload: exactly one recognised `state`, nothing else. */
export function validateInternalReview(raw: unknown): ValidationResult<InternalReviewInput> {
  const body = asObject(raw);
  if (!body) return reject("A request body is required.");
  const extra = unknownKeys(body, ["state"]);
  if (extra.length) return reject("Unexpected fields were rejected.");

  const { state } = body;
  if (!isInternalReviewState(state)) return reject("Choose a valid review state.");
  return { ok: true, data: { state } };
}
