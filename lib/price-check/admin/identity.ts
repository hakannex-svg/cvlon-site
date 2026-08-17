export function normalizeBootstrapEmail(value: string) {
  return value.trim().toLowerCase();
}

export function bootstrapAdminEmails(raw = process.env.PRICE_CHECK_BOOTSTRAP_ADMIN_EMAILS ?? "") {
  return new Set(
    raw
      .split(",")
      .map(normalizeBootstrapEmail)
      .filter(Boolean),
  );
}

export type VerifiedStaffIdentity = {
  issuer: "https://accounts.google.com";
  subject: string;
  email: string;
  provider: "google-oidc";
  authenticationMethods: string[];
};

/** Marker used only for local, approved-but-not-yet-bound staff records. */
export const PENDING_STAFF_ISSUER = "pending:civilon-google-oidc";

type GoogleIdentityClaims = {
  iss?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  hd?: unknown;
  nonce?: unknown;
  amr?: unknown;
};

const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);

export function verifiedGoogleIdentity(
  claims: GoogleIdentityClaims,
  expectedNonce: string,
): VerifiedStaffIdentity | null {
  if (!GOOGLE_ISSUERS.has(String(claims.iss ?? ""))) return null;
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 255) return null;
  if (typeof claims.email !== "string" || claims.email.length > 320) return null;
  if (claims.email_verified !== true) return null;
  if (typeof claims.nonce !== "string" || claims.nonce !== expectedNonce) return null;

  const email = normalizeBootstrapEmail(claims.email);
  if (!email) return null;
  if (email.endsWith("@cvlon.com") && claims.hd !== "cvlon.com") return null;

  return {
    issuer: "https://accounts.google.com",
    subject: claims.sub,
    email,
    provider: "google-oidc",
    authenticationMethods: Array.isArray(claims.amr)
      ? claims.amr.filter((method): method is string => typeof method === "string").slice(0, 12)
      : [],
  };
}

export function isBootstrapAdmin(email: string, raw?: string) {
  return bootstrapAdminEmails(raw).has(normalizeBootstrapEmail(email));
}
