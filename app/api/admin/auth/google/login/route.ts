import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import {
  createGoogleAuthorizationRequest,
  getGoogleOidcConfig,
  GOOGLE_OIDC_TRANSACTION_COOKIE,
  googleOidcTransactionMaxAge,
} from "@/lib/price-check/admin/oidc";
import { secureCookie } from "@/lib/price-check/admin/session";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isPriceCheckEnabled()) return new Response(null, { status: 404 });
  try {
    const config = getGoogleOidcConfig();
    const authorization = await createGoogleAuthorizationRequest(config);
    const headers = new Headers({
      Location: authorization.url.toString(),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
    headers.append("Set-Cookie", secureCookie(
      GOOGLE_OIDC_TRANSACTION_COOKIE,
      authorization.transaction,
      googleOidcTransactionMaxAge,
    ));
    return new Response(null, { status: 302, headers });
  } catch {
    return new Response(null, {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }
}
