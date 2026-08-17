import "../server-boundary.ts";

export const supportedCurrencyCodes = [
  "AUD",
  "CAD",
  "CHF",
  "EUR",
  "GBP",
  "JPY",
  "USD",
] as const;

export type SupportedCurrencyCode = (typeof supportedCurrencyCodes)[number];

function cleanText(value: string, maximumLength: number) {
  return value
    .normalize("NFKC")
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, maximumLength);
}

export function normalizePartNumber(value: string) {
  const normalized = cleanText(value, 160)
    .toUpperCase()
    .replace(/[\s./_-]+/g, "")
    .replace(/[^A-Z0-9]/g, "");

  if (!normalized) throw new Error("Part number is required.");
  return normalized;
}

export function normalizeEmail(value: string) {
  const normalized = cleanText(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Business email is invalid.");
  }
  return normalized;
}

export function normalizePhone(value: string) {
  const cleaned = cleanText(value, 80);
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new Error("Phone number must contain 7 to 15 digits.");
  }
  return cleaned.startsWith("+") ? `+${digits}` : digits;
}

export function validateCurrencyCode(value: string): SupportedCurrencyCode {
  const normalized = cleanText(value, 3).toUpperCase();
  if (!supportedCurrencyCodes.includes(normalized as SupportedCurrencyCode)) {
    throw new Error("Currency is not in the approved ISO 4217 allowlist.");
  }
  return normalized as SupportedCurrencyCode;
}

export function parseMoney(value: string | number) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error("Money must be a non-negative decimal with at most two decimals.");
  }
  const [whole, fraction = ""] = text.split(".");
  const normalized = `${BigInt(whole).toString()}.${fraction.padEnd(2, "0")}`;
  if (normalized.length > 21) throw new Error("Money value is too large.");
  return normalized;
}

export function sanitizeDisplayFilename(value: string) {
  const cleaned = cleanText(value, 255)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[. -]+/, "")
    .trim();
  return cleaned || "document";
}

export function sanitizeAttribution(input: {
  landingPage?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}) {
  const sanitizeCampaignValue = (value?: string | null) => {
    if (!value) return null;
    return cleanText(value, 160).replace(/[^\p{L}\p{N} ._/-]/gu, "") || null;
  };
  const sanitizeUrl = (value?: string | null) => {
    if (!value) return null;
    try {
      const url = new URL(value, "https://cvlon.com");
      if (!/^https?:$/.test(url.protocol)) return null;
      return `${url.origin}${url.pathname}`.slice(0, 500);
    } catch {
      return null;
    }
  };
  const sanitizeOrigin = (value?: string | null) => {
    if (!value) return null;
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.origin.slice(0, 255) : null;
    } catch {
      return null;
    }
  };

  return {
    landingPage: sanitizeUrl(input.landingPage),
    referrerOrigin: sanitizeOrigin(input.referrer),
    utmSource: sanitizeCampaignValue(input.utmSource),
    utmMedium: sanitizeCampaignValue(input.utmMedium),
    utmCampaign: sanitizeCampaignValue(input.utmCampaign),
    utmContent: sanitizeCampaignValue(input.utmContent),
    utmTerm: sanitizeCampaignValue(input.utmTerm),
  };
}

export function sanitizeOtherDocumentationText(value: string) {
  const sanitized = cleanText(value, 240).replace(/[<>]/g, "");
  if (!sanitized) throw new Error("OTHER documentation requires a description.");
  return sanitized;
}
