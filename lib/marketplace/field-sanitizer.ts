import "../../db/price-check/server-boundary.ts";

/**
 * The one intake string sanitizer shared by every marketplace intake.
 *
 * It lives here rather than beside each validator so a hardening fix lands in
 * one place. A second copy of this function is how a sanitizer quietly drifts:
 * one intake gains a rule and the other keeps accepting what the first now
 * rejects.
 *
 * Unicode-normalizes, strips control and format characters, trims and bounds
 * one field. Returns "" for an absent optional value and null when the value is
 * unusable, which every caller treats as a field error rather than silently
 * truncating.
 *
 * Format characters (\p{Cf}) are removed as well as control characters, which
 * is stricter than the Price Check intake. A zero-width space or a bidi
 * override survives NFKC and a trim, and inside a part number or a company name
 * it produces two values that are visually identical but never compare equal —
 * a spoofing and deduplication hazard in a workflow whose whole point is
 * matching what a customer stated against what Civilon can act on.
 */
export function cleanIntakeField(value: unknown, maximum: number, required = false) {
  if (value === null || value === undefined || value === "") {
    return required ? null : "";
  }
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  if ((required && !normalized) || normalized.length > maximum) return null;
  return normalized;
}

/** Closed-enum membership. Anything not literally in the list is rejected. */
export function memberOf<T extends readonly string[]>(
  value: unknown,
  choices: T,
): T[number] | null {
  return typeof value === "string" && choices.includes(value) ? (value as T[number]) : null;
}
