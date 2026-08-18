import { isMarketplaceEnabled } from "@/lib/marketplace/feature";
import {
  BUY_REQUEST_VERIFY_MAX_BODY_BYTES,
  type BuyRequestVerifyResponse,
} from "@/lib/marketplace/contract";
import {
  consumeMarketplaceAttempt,
  marketplaceRateLimitKey,
} from "@/lib/marketplace/rate-limit";
import { isApprovedSubmissionHost } from "@/lib/submission-host";

export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
} as const;

/**
 * Every redeem response carries the same status code and the same headers, so a
 * caller without a valid credential cannot tell an unknown token from an expired
 * one from a real request. Only the `status` field differs, and it has exactly
 * two values: a repeat confirmation by the legitimate holder reports "verified"
 * just as the first one did.
 */
function verificationResponse(status: "verified" | "unavailable") {
  const body: BuyRequestVerifyResponse = status === "verified"
    ? { ok: true, status }
    : { ok: false, status };
  return Response.json(body, { status: 200, headers: { ...PRIVATE_HEADERS } });
}

function originAllowed(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return localhost || (url.protocol === "https:" && isApprovedSubmissionHost(url.hostname));
  } catch {
    return false;
  }
}

/**
 * Redemption is POST-only and consumes the credential from a JSON body.
 *
 * A GET would be fetched by mail scanners, link previewers and browser
 * prefetchers, any of which would silently spend a single-use token before the
 * customer ever saw the page — and would put the credential in a query string,
 * where it survives in access logs. Neither is acceptable for a credential that
 * activates a request, so the only mutating method here is POST, and an Origin
 * header from an approved Civilon host is required.
 */
export async function POST(request: Request) {
  if (!isMarketplaceEnabled()) {
    return Response.json({ ok: false, error: "Not found." }, {
      status: 404,
      headers: { ...PRIVATE_HEADERS },
    });
  }
  if (!originAllowed(request)) return verificationResponse("unavailable");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return verificationResponse("unavailable");
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > BUY_REQUEST_VERIFY_MAX_BODY_BYTES) {
    return verificationResponse("unavailable");
  }

  let token = "";
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return verificationResponse("unavailable");
    }
    const body = parsed as Record<string, unknown>;
    // Strictly one key. A redeem body has nothing else in it.
    if (Object.keys(body).length !== 1 || typeof body.token !== "string") {
      return verificationResponse("unavailable");
    }
    token = body.token;
  } catch {
    return verificationResponse("unavailable");
  }

  const network = request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unidentified-preview-client";
  // Keyed on the network plus a credential prefix so a single client cannot
  // grind through candidates, and a shared egress IP cannot lock a legitimate
  // customer out of their own link.
  const limit = consumeMarketplaceAttempt(
    marketplaceRateLimitKey(`buy-request-verify:${network}:${token.slice(0, 12)}`),
  );
  if (!limit.allowed) return verificationResponse("unavailable");

  try {
    const [{ priceCheckDb }, { verifyBuyRequestContact }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/verification-service"),
    ]);
    const result = await verifyBuyRequestContact(priceCheckDb, { token });
    return verificationResponse(result.outcome === "unavailable" ? "unavailable" : "verified");
  } catch {
    return verificationResponse("unavailable");
  }
}

/**
 * Explicitly non-mutating. A scanner, prefetcher or crawler that follows a link
 * to this endpoint gets a refusal, never a redemption.
 */
export async function GET() {
  return Response.json({ ok: false, error: "Method not allowed." }, {
    status: 405,
    headers: { ...PRIVATE_HEADERS, Allow: "POST" },
  });
}
