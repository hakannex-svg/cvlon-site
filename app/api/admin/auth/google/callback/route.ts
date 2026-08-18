import { isBootstrapAdmin } from "@/lib/price-check/admin/identity";
import {
  exchangeGoogleAuthorizationCode,
  getGoogleOidcConfig,
  GoogleTokenExchangeError,
  GOOGLE_OIDC_TRANSACTION_COOKIE,
  oidcRedirectOrigin,
  verifyGoogleAuthorizationTransaction,
  type GoogleOidcConfig,
} from "@/lib/price-check/admin/oidc";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  clearSecureCookie,
  readCookie,
  secureCookie,
} from "@/lib/price-check/admin/session";

export const dynamic = "force-dynamic";

function callbackRedirect(config: GoogleOidcConfig, path: string, cookies: string[] = []) {
  const headers = new Headers({
    Location: new URL(path, oidcRedirectOrigin(config)).toString(),
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request) {
  let config: GoogleOidcConfig;
  let stage = "request_validation";
  try {
    config = getGoogleOidcConfig();
  } catch {
    return new Response(null, { status: 503 });
  }

  const failed = () => callbackRedirect(config, "/admin/login?auth=failed", [
    clearSecureCookie(GOOGLE_OIDC_TRANSACTION_COOKIE),
  ]);

  try {
    const url = new URL(request.url);
    if (url.searchParams.has("error")) return failed();
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const transactionCookie = readCookie(
      request.headers.get("cookie"),
      GOOGLE_OIDC_TRANSACTION_COOKIE,
    );
    if (!transactionCookie || !code || code.length > 4096 || !state || state.length > 1024) {
      return failed();
    }

    stage = "transaction_verification";
    const transaction = await verifyGoogleAuthorizationTransaction(
      transactionCookie,
      state,
      config,
    );
    stage = "google_token_exchange";
    const identity = await exchangeGoogleAuthorizationCode(code, transaction, config);
    stage = "bootstrap_authorization";
    const bootstrapAllowed = isBootstrapAdmin(identity.email);

    stage = "database_binding";
    const [database, adminRepository, sessionRepository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
      import("@/db/price-check/repositories/session-repository"),
    ]);
    const authorization = await adminRepository.bindOrAuthorizeAdmin(
      database.priceCheckDb,
      identity,
      bootstrapAllowed,
    );
    if (
      authorization.status !== "authorized" &&
      authorization.status !== "bound" &&
      authorization.status !== "rebound"
    ) return failed();

    stage = "session_creation";
    const session = await sessionRepository.createAdminSession(
      database.priceCheckDb,
      authorization.user.id,
      config.sessionSecret,
    );
    return callbackRedirect(config, "/admin/queue", [
      clearSecureCookie(GOOGLE_OIDC_TRANSACTION_COOKIE),
      secureCookie(ADMIN_SESSION_COOKIE, session.token, ADMIN_SESSION_TTL_SECONDS),
    ]);
  } catch (error) {
    const safeCode = error instanceof GoogleTokenExchangeError
      ? error.safeCode
      : "unexpected";
    console.error("admin_oidc_callback_failed", stage, safeCode);
    return failed();
  }
}
