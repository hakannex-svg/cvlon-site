import { isApprovedSubmissionHost } from "@/lib/submission-host";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import {
  consumeUploadAuthorization,
  uploadRateLimitKey,
} from "@/lib/price-check/uploads/rate-limit";
import { readUploadCookie, uploadSessionCookie } from "@/lib/price-check/uploads/session";

export const runtime = "nodejs";

function response(body: unknown, status: number, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", ...headers },
  });
}

function clientNetworkKey(request: Request) {
  return request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unidentified-preview-client";
}

function verifyOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!isApprovedSubmissionHost(requestUrl.hostname) || !origin) return false;
  const originUrl = new URL(origin);
  if (originUrl.protocol !== "https:" || originUrl.host !== requestUrl.host) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

export async function POST(request: Request) {
  if (!isPriceCheckEnabled()) return response({ ok: false, error: "Not found." }, 404);
  if (!verifyOrigin(request)) return response({ ok: false, error: "Upload authorization was denied." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return response({ ok: false, error: "Submit upload details as JSON." }, 415);
  }
  const limit = consumeUploadAuthorization(uploadRateLimitKey(clientNetworkKey(request)));
  if (!limit.allowed) {
    return response(
      { ok: false, error: "Too many upload attempts. Please wait or continue without a document." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }
  let raw: unknown;
  try { raw = await request.json(); } catch {
    return response({ ok: false, error: "Upload details could not be read." }, 400);
  }
  try {
    const [{ priceCheckDb }, { authorizePriceCheckUpload }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/price-check/uploads/authorization"),
    ]);
    const authorized = await authorizePriceCheckUpload(
      priceCheckDb,
      raw,
      readUploadCookie(request.headers.get("cookie")),
    );
    return response({
      ok: true,
      handle: authorized.handle,
      upload: authorized.upload,
      expiresInSeconds: authorized.expiresInSeconds,
      filename: authorized.filename,
      size: authorized.size,
    }, 201, { "Set-Cookie": uploadSessionCookie(authorized.token) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The upload could not be authorized.";
    const clientError = /supported|filename|maximum|10 MB|document type/i.test(message);
    return response({ ok: false, error: clientError ? message : "Upload is temporarily unavailable. You can continue without a document." }, clientError ? 400 : 503);
  }
}

export function GET() { return response({ ok: false, error: "Method not allowed." }, 405, { Allow: "POST" }); }
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;

