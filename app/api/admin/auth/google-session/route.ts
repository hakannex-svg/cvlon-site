import { getUser } from "@netlify/identity";

import { privateJson, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { verifyGoogleProviderToken } from "@/lib/price-check/admin/google";
import { isBootstrapAdmin, normalizeBootstrapEmail, verifiedStaffIdentity } from "@/lib/price-check/admin/identity";
import { createGoogleAdminSessionToken, googleAdminSessionCookie } from "@/lib/price-check/admin/session";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";

export async function POST(request: Request) {
  if (!isPriceCheckEnabled()) return privateJson({ ok: false, error: "Not found." }, 404);
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const identityUser = await getUser();
  if (!identityUser?.id || !identityUser.email || !identityUser.confirmedAt) {
    return privateJson({ ok: false, error: "Authentication required." }, 401);
  }
  let body: unknown;
  try { body = await request.json(); } catch { return privateJson({ ok: false, error: "Sign-in proof was not accepted." }, 400); }
  const providerToken = typeof body === "object" && body !== null && "providerToken" in body
    ? (body as { providerToken?: unknown }).providerToken : null;
  if (typeof providerToken !== "string") return privateJson({ ok: false, error: "Sign-in proof was not accepted." }, 400);

  const profile = await verifyGoogleProviderToken(providerToken);
  const identityEmail = normalizeBootstrapEmail(identityUser.email);
  if (!profile || profile.email !== identityEmail || !isBootstrapAdmin(profile.email)) {
    return privateJson({ ok: false, error: "Access denied." }, 403);
  }
  const session = { netlifySubject: identityUser.id, googleSubject: profile.subject, email: profile.email };
  const identity = verifiedStaffIdentity(identityUser, session);
  if (!identity) return privateJson({ ok: false, error: "Access denied." }, 403);
  try {
    const [{ priceCheckDb }, { bindOrAuthorizeAdmin }] = await Promise.all([
      import("@/db/price-check"), import("@/db/price-check/repositories/admin-repository"),
    ]);
    const result = await bindOrAuthorizeAdmin(priceCheckDb, identity, true);
    if (result.status !== "bound" && result.status !== "authorized") {
      return privateJson({ ok: false, error: "Access denied." }, 403);
    }
  } catch {
    return privateJson({ ok: false, error: "Administration is temporarily unavailable." }, 503);
  }
  const response = privateJson({ ok: true });
  response.headers.append("Set-Cookie", googleAdminSessionCookie(createGoogleAdminSessionToken(session)));
  return response;
}
