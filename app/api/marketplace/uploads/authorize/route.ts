import { isSellSubmissionEnabled } from "@/lib/marketplace/feature";
import {
  consumeMarketplaceUploadAuthorization,
  marketplaceUploadRateLimitKey,
} from "@/lib/marketplace/uploads/rate-limit";
import {
  marketplaceUploadSessionCookie,
  readMarketplaceUploadCookie,
} from "@/lib/marketplace/uploads/session";
import { isApprovedSubmissionHost } from "@/lib/submission-host";

export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
} as const;

function response(body: unknown, status: number, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { ...PRIVATE_HEADERS, ...headers } });
}

function clientNetworkKey(request: Request) {
  return request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unidentified-preview-client";
}

/**
 * Stricter than the intake routes: an Origin header is required and must equal
 * this exact host. Authorizing an upload mints a credential that writes to
 * Civilon storage, so a missing Origin — which the intake routes tolerate for
 * non-browser clients — is not good enough here.
 */
function verifyOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const localhost = requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1";
  if (!localhost && !isApprovedSubmissionHost(requestUrl.hostname)) return false;
  if (!origin) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.host !== requestUrl.host) return false;
  if (!localhost && originUrl.protocol !== "https:") return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

/**
 * Messages safe to return verbatim. Everything else collapses to a generic
 * unavailable, so a storage misconfiguration, a missing session key or a
 * database fault never describes Civilon's internals to a caller.
 */
const CLIENT_SAFE = /supported|filename|extension|purpose|25 MB|50 MB|JPG|PNG|WebP|PDF|CSV|XLSX/i;

export async function POST(request: Request) {
  if (!isSellSubmissionEnabled()) return response({ ok: false, error: "Not found." }, 404);
  if (!verifyOrigin(request)) {
    return response({ ok: false, error: "Upload authorization was denied." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return response({ ok: false, error: "Send upload details as JSON." }, 415);
  }

  const limit = consumeMarketplaceUploadAuthorization(
    marketplaceUploadRateLimitKey(clientNetworkKey(request)),
  );
  if (!limit.allowed) {
    return response(
      { ok: false, error: "Too many upload attempts. Please wait, or continue without files." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return response({ ok: false, error: "Upload details could not be read." }, 400);
  }

  try {
    const [{ priceCheckDb }, { authorizeMarketplaceUpload }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/uploads/authorization"),
    ]);
    const authorized = await authorizeMarketplaceUpload(
      priceCheckDb,
      raw,
      readMarketplaceUploadCookie(request.headers.get("cookie")),
      // Buy Request evidence is a later slice; this endpoint opens Sell
      // sessions only, and the session's aggregate is fixed at creation.
      "sell_submission",
    );
    // The session token goes back in a host-only HttpOnly cookie and nowhere
    // else. The response body carries only the opaque handle and the presigned
    // form the browser must post — no bucket credential, no server secret, and
    // nothing the page could store and replay from another origin.
    return response({
      ok: true,
      handle: authorized.handle,
      upload: authorized.upload,
      expiresInSeconds: authorized.expiresInSeconds,
      filename: authorized.filename,
      size: authorized.size,
      purpose: authorized.purpose,
    }, 201, { "Set-Cookie": marketplaceUploadSessionCookie(authorized.token) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "MARKETPLACE_UPLOAD_SESSION_LIMIT_REACHED") {
      return response({
        ok: false,
        error: "You can attach up to 12 files, 200 MB in total. Remove one and try again.",
      }, 409);
    }
    if (CLIENT_SAFE.test(message)) {
      return response({ ok: false, error: message }, 400);
    }
    console.error(JSON.stringify({
      event: "MARKETPLACE_UPLOAD_AUTHORIZE_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    return response({
      ok: false,
      error: "File uploads are temporarily unavailable. You can submit without files.",
    }, 503);
  }
}

/** Nothing here is readable. Authorization is a POST and only a POST. */
export function GET() {
  return response({ ok: false, error: "Method not allowed." }, 405, { Allow: "POST" });
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
