import { priceCheckDb } from "@/db/price-check";
import { revokeAdminSession } from "@/db/price-check/repositories/session-repository";
import { verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { getGoogleOidcConfig } from "@/lib/price-check/admin/oidc";
import {
  ADMIN_SESSION_COOKIE,
  clearSecureCookie,
  readCookie,
} from "@/lib/price-check/admin/session";

export const dynamic = "force-dynamic";

/** Origin check, revocation, cookie clearing and private headers are unchanged. */
export async function POST(request: Request) {
  try {
    verifyAdminMutationOrigin(request);
    const config = getGoogleOidcConfig();
    const token = readCookie(request.headers.get("cookie"), ADMIN_SESSION_COOKIE);
    if (token) await revokeAdminSession(priceCheckDb, token, config.sessionSecret);
    const headers = new Headers({
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
    headers.append("Set-Cookie", clearSecureCookie(ADMIN_SESSION_COOKIE));
    return new Response(null, { status: 204, headers });
  } catch {
    return Response.json({ ok: false, error: "Sign out could not be completed." }, {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }
}
