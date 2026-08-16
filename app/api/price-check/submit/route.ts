import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import {
  PRICE_CHECK_MAX_BODY_BYTES,
  type PriceCheckSubmitResponse,
} from "@/lib/price-check/contract";
import {
  consumePriceCheckAttempt,
  rateLimitKey,
} from "@/lib/price-check/rate-limit";
import { validatePriceCheckSubmission } from "@/lib/price-check/validation";

export const runtime = "nodejs";

function json(body: PriceCheckSubmitResponse, status: number, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function clientNetworkKey(request: Request) {
  return request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unidentified-preview-client";
}

export async function POST(request: Request) {
  if (!isPriceCheckEnabled()) return json({ ok: false, error: "Not found." }, 404);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ ok: false, error: "Submit the Price Check as JSON." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > PRICE_CHECK_MAX_BODY_BYTES) {
    return json({ ok: false, error: "The Price Check request is too large." }, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > PRICE_CHECK_MAX_BODY_BYTES) {
    return json({ ok: false, error: "The Price Check request is too large." }, 413);
  }
  const limit = consumePriceCheckAttempt(rateLimitKey(clientNetworkKey(request)));
  if (!limit.allowed) {
    return json(
      { ok: false, error: "Too many Price Check attempts. Please wait and try again." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  let raw: unknown;
  try { raw = JSON.parse(rawBody); } catch {
    return json({ ok: false, error: "The Price Check request could not be read." }, 400);
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const honeypot = (raw as Record<string, unknown>).website;
    if (typeof honeypot === "string" && honeypot.trim()) {
      return json({ ok: false, error: "The Price Check request could not be accepted." }, 400);
    }
  }
  const validation = validatePriceCheckSubmission(raw);
  if (!validation.success) {
    return json({
      ok: false,
      error: "Please review the highlighted Price Check details.",
      fieldErrors: validation.fieldErrors,
    }, 400);
  }

  try {
    const [{ priceCheckDb }, { submitPriceCheck }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/price-check/submission-service"),
    ]);
    const result = await submitPriceCheck(priceCheckDb, validation.data);
    return json({ ok: true, reference: result.reference }, result.created ? 201 : 200);
  } catch {
    return json({
      ok: false,
      error: "Price Check submission is temporarily unavailable. Please try again later.",
    }, 503);
  }
}
