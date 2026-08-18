import {
  createGoogleAuthorizationRequest,
  getGoogleOidcConfig,
  GOOGLE_OIDC_TRANSACTION_COOKIE,
  googleOidcTransactionMaxAge,
} from "@/lib/price-check/admin/oidc";
import { secureCookie } from "@/lib/price-check/admin/session";

export const dynamic = "force-dynamic";

function safeLoginErrorName(error: unknown) {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof URIError) return "URIError";
  return error instanceof Error ? "Error" : "unexpected";
}

/** General staff sign-in start. PKCE, state and nonce are unchanged. */
export async function GET() {
  let stage = "configuration";
  try {
    const config = getGoogleOidcConfig();
    stage = "authorization_request";
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
  } catch (error) {
    console.error("admin_oidc_login_start_failed", stage, safeLoginErrorName(error));
    return new Response(null, {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }
}
