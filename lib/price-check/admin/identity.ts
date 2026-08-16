import type { User } from "@netlify/identity";

export const GOOGLE_IDENTITY_ISSUER = "https://accounts.google.com";

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
  user: Pick<User, "id" | "email" | "confirmedAt">,
  googleSession: { netlifySubject: string; googleSubject: string; email: string } | null,
): VerifiedStaffIdentity | null {
  const email = normalizeBootstrapEmail(user.email ?? "");
  if (
    !user.id || !email || !user.confirmedAt || !googleSession ||
    googleSession.netlifySubject !== user.id ||
    normalizeBootstrapEmail(googleSession.email) !== email ||
    !googleSession.googleSubject
  ) {
    return null;
  }
  return {
    issuer: GOOGLE_IDENTITY_ISSUER,
    subject: googleSession.googleSubject,
    email,
    provider: "google",
  };
}

export function isBootstrapAdmin(email: string, raw?: string) {
  return bootstrapAdminEmails(raw).has(normalizeBootstrapEmail(email));
}
