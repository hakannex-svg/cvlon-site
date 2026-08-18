/**
 * Hostile-but-plausible intake text, built from escapes so the fixture stays
 * readable and lint-safe. A NUL, a BEL, a zero-width space, a right-to-left
 * override and fullwidth Latin are the shapes that survive a naive trim and
 * reach the database looking like ordinary text.
 */
const NUL = "\u0000";
const BEL = "\u0007";
const ZERO_WIDTH_SPACE = "\u200B";
const RIGHT_TO_LEFT_OVERRIDE = "\u202E";
const FULLWIDTH_EXAMPLE = "\uFF25\uFF58\uFF41\uFF4D\uFF50\uFF4C\uFF45";

export const unicodeIntakeFixture = {
  firstName: `Dana${NUL}`,
  companyName: `  ${FULLWIDTH_EXAMPLE} Aviation${BEL}  `,
  description: `Bleed${ZERO_WIDTH_SPACE}valve${RIGHT_TO_LEFT_OVERRIDE}`,
};

/**
 * True when the value contains a control character or an invisible format
 * character. Both are hazards at intake: one corrupts storage and logs, the
 * other produces values that look identical but never compare equal.
 */
export function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    if (/\p{Cf}/u.test(character)) return true;
  }
  return false;
}
