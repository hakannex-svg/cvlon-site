import { isMarketplaceEnabled } from "@/lib/marketplace/feature";
import {
  intakeHeadNotAllowed,
  intakeMethodNotAllowed,
} from "@/lib/marketplace/intake-methods";
import {
  BUY_REQUEST_MAX_BODY_BYTES,
  type BuyRequestSubmitResponse,
} from "@/lib/marketplace/contract";
import {
  consumeMarketplaceAttempt,
  marketplaceRateLimitKey,
} from "@/lib/marketplace/rate-limit";
import { validateBuyRequestSubmission } from "@/lib/marketplace/validation";
import { isApprovedSubmissionHost } from "@/lib/submission-host";

export const runtime = "nodejs";

function json(body: BuyRequestSubmitResponse, status: number, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });
}

function clientNetworkKey(request: Request) {
  return request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unidentified-preview-client";
}

/**
 * A browser-issued submission must come from an approved Civilon origin. A
 * missing Origin header is left alone — it means a non-browser client, which
 * gains nothing from a forged one — but a present-and-wrong origin is refused.
 */
function originAllowed(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return localhost || (url.protocol === "https:" && isApprovedSubmissionHost(url.hostname));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isMarketplaceEnabled()) return json({ ok: false, error: "Not found." }, 404);
  if (!originAllowed(request)) {
    return json({ ok: false, error: "The request origin was rejected." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ ok: false, error: "Submit the request as JSON." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > BUY_REQUEST_MAX_BODY_BYTES) {
    return json({ ok: false, error: "The request is too large." }, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > BUY_REQUEST_MAX_BODY_BYTES) {
    return json({ ok: false, error: "The request is too large." }, 413);
  }
  const limit = consumeMarketplaceAttempt(marketplaceRateLimitKey(clientNetworkKey(request)));
  if (!limit.allowed) {
    return json(
      { ok: false, error: "Too many requests. Please wait and try again." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "The request could not be read." }, 400);
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const honeypot = (raw as Record<string, unknown>).website;
    if (typeof honeypot === "string" && honeypot.trim()) {
      return json({ ok: false, error: "The request could not be accepted." }, 400);
    }
  }
  const validation = validateBuyRequestSubmission(raw);
  if (!validation.success) {
    return json({
      ok: false,
      error: "Please review the highlighted details.",
      fieldErrors: validation.fieldErrors,
    }, 400);
  }

  try {
    const [{ priceCheckDb }, { submitBuyRequest }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/submission-service"),
    ]);
    const result = await submitBuyRequest(priceCheckDb, validation.data);
    return json({ ok: true, reference: result.reference }, result.created ? 201 : 200);
  } catch (error) {
    // Only the error's shape is logged. Field values, the email address and the
    // reference are deliberately absent from operational logs.
    const failure = error && typeof error === "object"
      ? error as { name?: unknown; code?: unknown }
      : {};
    console.error(JSON.stringify({
      event: "BUY_REQUEST_SUBMISSION_FAILED",
      errorName: typeof failure.name === "string" ? failure.name : "UnknownError",
      errorCode: typeof failure.code === "string" ? failure.code : null,
    }));
    return json({
      ok: false,
      error: "Requests are temporarily unavailable. Please try again later.",
    }, 503);
  }
}

/**
 * Buy intake answers POST and refuses every other method explicitly, with the
 * route's own privacy headers rather than the framework's bare fall-through.
 * There is no GET here and never will be: a read surface on this route would
 * expose other buyers' requests.
 */
export const GET = intakeMethodNotAllowed;
export const PUT = intakeMethodNotAllowed;
export const PATCH = intakeMethodNotAllowed;
export const DELETE = intakeMethodNotAllowed;
export const OPTIONS = intakeMethodNotAllowed;
export const HEAD = intakeHeadNotAllowed;
