import { cookies } from "next/headers";
import { privateJson } from "@/lib/price-check/admin/auth";
import { RESULT_SESSION_COOKIE, resultTokenKey, verifyResultSession } from "@/lib/price-check/result-session";
import {
  PRICE_CHECK_BUY_REQUEST_MAX_BODY_BYTES,
  type PriceCheckBuyRequestResponse,
} from "@/lib/marketplace/price-check-conversion-contract";
import {
  conversionHasRequiredPhone,
  validatePriceCheckBuyRequestSubmission,
} from "@/lib/marketplace/price-check-conversion-validation";
import { LEGAL_DOCUMENT_VERSIONS } from "@/lib/legal";

export const runtime = "nodejs";

function json(body: PriceCheckBuyRequestResponse, status: number) {
  return privateJson(body, status);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ ok: false, error: "The request origin was rejected." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ ok: false, error: "Submit the request as JSON." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > PRICE_CHECK_BUY_REQUEST_MAX_BODY_BYTES) {
    return json({ ok: false, error: "The request is too large." }, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > PRICE_CHECK_BUY_REQUEST_MAX_BODY_BYTES) {
    return json({ ok: false, error: "The request is too large." }, 413);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "The request could not be read." }, 400);
  }
  const validation = validatePriceCheckBuyRequestSubmission(raw);
  if (!validation.success) {
    return json({ ok: false, error: "Please review the highlighted details.", fieldErrors: validation.fieldErrors }, 400);
  }

  try {
    const session = verifyResultSession(resultTokenKey(), (await cookies()).get(RESULT_SESSION_COOKIE)?.value);
    if (!session) return json({ ok: false, error: "Result access is unavailable." }, 401);

    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/result-delivery-repository"),
    ]);
    const customer = await repository.getCustomerResult(priceCheckDb, session);
    if (!customer) return json({ ok: false, error: "Result access is unavailable." }, 401);
    if (!conversionHasRequiredPhone(validation.data, Boolean(customer.requester.phone))) {
      return json({
        ok: false,
        error: "Please review the highlighted details.",
        fieldErrors: { phone: "Enter a phone number for an AOG or critical requirement." },
      }, 400);
    }

    const result = await repository.createResultBuyRequest(priceCheckDb, {
      ...session,
      submission: validation.data,
      privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
      termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
    });
    return json({ ok: true, reference: result.publicReference, created: result.created }, result.created ? 201 : 200);
  } catch (error) {
    const failure = error && typeof error === "object" ? error as { name?: unknown; code?: unknown } : {};
    console.error(JSON.stringify({
      event: "PRICE_CHECK_BUY_REQUEST_CONVERSION_FAILED",
      errorName: typeof failure.name === "string" ? failure.name : "UnknownError",
      errorCode: typeof failure.code === "string" ? failure.code : null,
    }));
    return json({ ok: false, error: "The Buy Request could not be created. Please try again later." }, 409);
  }
}
