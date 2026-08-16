import type { User } from "@netlify/identity";

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
  provider: "netlify-identity";
};

export function verifiedStaffIdentity(
  user: Pick<User, "id" | "email">,
  siteId = process.env.SITE_ID,
): VerifiedStaffIdentity | null {
  const email = normalizeBootstrapEmail(user.email ?? "");
  if (!siteId || !user.id || !email) {
    return null;
  }
  return {
    issuer: `netlify-identity:${siteId}`,
    subject: user.id,
    email,
    provider: "netlify-identity",
  };
}

export function isBootstrapAdmin(email: string, raw?: string) {
  return bootstrapAdminEmails(raw).has(normalizeBootstrapEmail(email));
}
