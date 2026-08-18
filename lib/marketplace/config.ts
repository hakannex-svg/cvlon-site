/**
 * Internal Civilon recipients for Buy & Sell notifications.
 *
 * These are operational routing addresses, never customer or supplier
 * identities, and they are never sent to analytics or logged with request data.
 */
export const defaultMarketplaceInternalRecipients = [
  "sales@cvlon.com",
  "hakan@shipnex.com",
  "david@cvlon.com",
] as const;

/**
 * Approved marketplace sender. Distinct from the Price Check sender so a
 * deliverability or reputation problem in one workflow cannot silently change
 * the other workflow's From address.
 */
export const defaultMarketplaceEmailFrom = "Civilon Parts <parts@cvlon.com>";

const RECIPIENT_PATTERN = /^[^\s@,;]+@[^\s@,;.]+(?:\.[^\s@,;.]+)+$/;

export function isValidRecipient(value: string) {
  return value.length <= 320 && RECIPIENT_PATTERN.test(value);
}

/**
 * Parses MARKETPLACE_INTERNAL_RECIPIENTS. Unset or blank falls back to the
 * approved defaults. An explicitly supplied value that yields no valid address
 * fails closed rather than silently delivering to the defaults, because that
 * would route internal mail somewhere the operator did not ask for.
 */
export function getMarketplaceInternalRecipients(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const configured = env.MARKETPLACE_INTERNAL_RECIPIENTS;
  if (configured === undefined || configured.trim() === "") {
    return [...defaultMarketplaceInternalRecipients];
  }

  const parsed = [
    ...new Set(
      configured
        .split(/[,;\n]/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry !== ""),
    ),
  ];

  const invalid = parsed.filter((entry) => !isValidRecipient(entry));
  if (invalid.length > 0 || parsed.length === 0) {
    throw new Error("MARKETPLACE_INTERNAL_RECIPIENTS_INVALID");
  }

  return parsed;
}

/**
 * Parses MARKETPLACE_EMAIL_FROM. Unset or blank uses the approved default. An
 * explicitly supplied value that is not a usable address fails closed for the
 * same reason as the recipient list: sending from an unintended identity is
 * worse than not sending.
 */
export function getMarketplaceEmailFrom(
  env: Record<string, string | undefined> = process.env,
) {
  const configured = env.MARKETPLACE_EMAIL_FROM;
  if (configured === undefined || configured.trim() === "") return defaultMarketplaceEmailFrom;

  const candidate = configured.trim();
  // A newline here would be a header-injection vector, not a formatting slip.
  if (candidate.length > 320 || /[\r\n]/.test(candidate)) {
    throw new Error("MARKETPLACE_EMAIL_FROM_INVALID");
  }
  const displayForm = /^[^<>]*<([^<>]+)>$/.exec(candidate);
  const address = displayForm ? displayForm[1] : candidate;
  if (!displayForm && /[<>]/.test(candidate)) throw new Error("MARKETPLACE_EMAIL_FROM_INVALID");
  if (!isValidRecipient(address.trim().toLowerCase())) {
    throw new Error("MARKETPLACE_EMAIL_FROM_INVALID");
  }
  return candidate;
}
