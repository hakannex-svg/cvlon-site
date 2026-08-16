import "../../../db/price-check/server-boundary.ts";

import { normalizeBootstrapEmail } from "./identity.ts";

const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export type VerifiedGoogleProfile = { subject: string; email: string };

export async function verifyGoogleProviderToken(providerToken: string): Promise<VerifiedGoogleProfile | null> {
  if (!providerToken || providerToken.length > 4096) return null;
  let response: Response;
  try {
    response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${providerToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const profile = await response.json() as Record<string, unknown>;
  const email = normalizeBootstrapEmail(typeof profile.email === "string" ? profile.email : "");
  if (typeof profile.sub !== "string" || !profile.sub || !email || profile.email_verified !== true) return null;
  return { subject: profile.sub, email };
}
