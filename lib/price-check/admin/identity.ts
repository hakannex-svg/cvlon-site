import type { User } from "@netlify/identity";

export const NETLIFY_IDENTITY_GOOGLE_PROVIDER = "google";

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
  issuer: string;
  subject: string;
  email: string;
  provider: "google";
};

export function verifiedStaffIdentity(
  user: Pick<User, "id" | "email" | "provider" | "confirmedAt">,
  siteId = process.env.SITE_ID,
): VerifiedStaffIdentity | null {
  const email = normalizeBootstrapEmail(user.email ?? "");
  if (!siteId || !user.id || !email || user.provider !== NETLIFY_IDENTITY_GOOGLE_PROVIDER || !user.confirmedAt) {
    return null;
  }
  return {
    issuer: `netlify-identity:${siteId}`,
    subject: user.id,
    email,
    provider: NETLIFY_IDENTITY_GOOGLE_PROVIDER,
  };
}

export function isBootstrapAdmin(email: string, raw?: string) {
  return bootstrapAdminEmails(raw).has(normalizeBootstrapEmail(email));
}
