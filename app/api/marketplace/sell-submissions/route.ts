import { isSellSubmissionEnabled } from "@/lib/marketplace/feature";
import {
  intakeHeadNotAllowed,
  intakeMethodNotAllowed,
} from "@/lib/marketplace/intake-methods";
import {
  SELL_SUBMISSION_MAX_BODY_BYTES,
  type SellSubmissionSubmitResponse,
} from "@/lib/marketplace/sell-contract";
import {
  consumeMarketplaceAttempt,
  marketplaceRateLimitKey,
} from "@/lib/marketplace/rate-limit";
import { validateSellSubmission } from "@/lib/marketplace/sell-validation";
import { readMarketplaceUploadCookie } from "@/lib/marketplace/uploads/session";
import {
  MARKETPLACE_SCAN_REJECTED_CODE,
  isRetryableScanCode,
} from "@/lib/marketplace/uploads/scan";
import { isApprovedSubmissionHost } from "@/lib/submission-host";

export const runtime = "nodejs";

/**
 * Attachment problems the seller can fix themselves. All of them mean the same
 * thing to the caller — upload it again or submit without it — because telling
 * them apart would report whether a given handle exists, is expired, or belongs
 * to someone else's session.
 */
const ATTACHMENT_REFUSALS = new Set([
  "MARKETPLACE_UPLOAD_SESSION_MISSING",
  "MARKETPLACE_UPLOAD_HANDLES_INVALID",
  "MARKETPLACE_UPLOAD_HANDLES_UNAVAILABLE",
  "MARKETPLACE_UPLOAD_HANDLE_ALREADY_USED",
  "MARKETPLACE_UPLOAD_TOTAL_TOO_LARGE",
  "MARKETPLACE_UPLOAD_SIZE_MISMATCH",
  "MARKETPLACE_UPLOAD_TYPE_MISMATCH",
  "MARKETPLACE_UPLOAD_KEY_INVALID",
  "MARKETPLACE_UPLOAD_UNREADABLE",
]);

/** Content verdicts that describe the seller's own file and are safe to echo. */
const CONTENT_REFUSAL = /Macro-enabled|Password-protected|not a valid|not a plain CSV|must be UTF-8|does not match its declared type|structure (is incomplete|could not be verified)|dimensions|stored file/i;

/**
 * Sell intake accepts submissions and nothing else. There is deliberately no
 * GET, HEAD or list handler on this route: a Sell Submission is staff-facing
 * only, and a read surface here would be the beginning of a public inventory
 * listing. Every non-POST method is answered by the shared refusal at the foot
 * of this file, so no method reaches the framework's bare 405.
 */
function json(body: SellSubmissionSubmitResponse, status: number, headers: HeadersInit = {}) {
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
  if (!isSellSubmissionEnabled()) return json({ ok: false, error: "Not found." }, 404);
  if (!originAllowed(request)) {
    return json({ ok: false, error: "The request origin was rejected." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ ok: false, error: "Submit the submission as JSON." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > SELL_SUBMISSION_MAX_BODY_BYTES) {
    return json({ ok: false, error: "The submission is too large." }, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > SELL_SUBMISSION_MAX_BODY_BYTES) {
    return json({ ok: false, error: "The submission is too large." }, 413);
  }
  const limit = consumeMarketplaceAttempt(
    marketplaceRateLimitKey(`sell-submission:${clientNetworkKey(request)}`),
  );
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
    return json({ ok: false, error: "The submission could not be read." }, 400);
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const honeypot = (raw as Record<string, unknown>).website;
    if (typeof honeypot === "string" && honeypot.trim()) {
      return json({ ok: false, error: "The submission could not be accepted." }, 400);
    }
  }
  const validation = validateSellSubmission(raw);
  if (!validation.success) {
    return json({
      ok: false,
      error: "Please review the highlighted details.",
      fieldErrors: validation.fieldErrors,
    }, 400);
  }

  try {
    const [{ priceCheckDb }, { submitSellSubmission }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/sell-submission-service"),
    ]);
    const result = await submitSellSubmission(
      priceCheckDb,
      validation.data,
      undefined,
      // The upload session travels in a host-only HttpOnly cookie, never in the
      // request body. A client cannot name someone else's session, and a handle
      // on its own proves nothing without it.
      { uploadSessionToken: readMarketplaceUploadCookie(request.headers.get("cookie")) },
    );
    return json({ ok: true, reference: result.reference }, result.created ? 201 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    /*
     * Scan evidence that is missing or still pending is a retry, not a refusal:
     * the seller did nothing wrong and their files are being checked. Nothing
     * is stored and nothing is claimed clean — the submission simply has not
     * happened yet, and the caller is told to come back in a moment.
     */
    if (isRetryableScanCode(message)) {
      return json({
        ok: false,
        error: "Your files are still being checked. Please try again in a moment.",
        fieldErrors: { attachmentHandles: "Still being checked for safety." },
      }, 409, { "Retry-After": "20" });
    }
    if (message === MARKETPLACE_SCAN_REJECTED_CODE) {
      return json({
        ok: false,
        error: "One of your files did not pass our safety check. Remove it and try again.",
        fieldErrors: { attachmentHandles: "This file was not accepted." },
      }, 400);
    }
    // Content that is not what it claimed to be: a macro workbook, an encrypted
    // PDF, a ZIP wearing an .xlsx name. The seller is told exactly what to fix,
    // because the answer is about their own file and reveals nothing else.
    if (CONTENT_REFUSAL.test(message)) {
      return json({
        ok: false,
        error: message,
        fieldErrors: { attachmentHandles: message },
      }, 400);
    }
    if (ATTACHMENT_REFUSALS.has(message)) {
      return json({
        ok: false,
        error: "One of your files is no longer available. Upload it again, or submit without it.",
        fieldErrors: { attachmentHandles: "Upload this file again." },
      }, 400);
    }

    // Only the error's shape is logged. Field values, filenames, the supplier's
    // address, any price and the reference are deliberately absent from
    // operational logs.
    const failure = error && typeof error === "object"
      ? error as { name?: unknown; code?: unknown }
      : {};
    console.error(JSON.stringify({
      event: "SELL_SUBMISSION_FAILED",
      errorName: typeof failure.name === "string" ? failure.name : "UnknownError",
      errorCode: typeof failure.code === "string" ? failure.code : null,
    }));
    return json({
      ok: false,
      error: "Submissions are temporarily unavailable. Please try again later.",
    }, 503);
  }
}

/**
 * Sell intake answers POST and refuses every other method explicitly, with the
 * route's own privacy headers rather than the framework's bare fall-through.
 * None of these is a read handler: a GET or HEAD that returned anything about a
 * submission would be the beginning of a public inventory listing.
 */
export const GET = intakeMethodNotAllowed;
export const PUT = intakeMethodNotAllowed;
export const PATCH = intakeMethodNotAllowed;
export const DELETE = intakeMethodNotAllowed;
export const OPTIONS = intakeMethodNotAllowed;
export const HEAD = intakeHeadNotAllowed;
