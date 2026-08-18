import "../../db/price-check/server-boundary.ts";

import { isMarketplaceEnabled } from "./feature.ts";
import {
  BUYER_OFFER_PUBLIC_MAX_BODY_BYTES,
  type BuyerOfferDecision,
  type BuyerOfferRespondResponse,
  type BuyerOfferViewResponse,
} from "./buyer-offer-contract.ts";
import { consumeMarketplaceAttempt, marketplaceRateLimitKey } from "./rate-limit.ts";
import { isApprovedSubmissionHost } from "../submission-host.ts";
import { marketplaceVerifyTokenKey } from "./verification.ts";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
} as const;

function response(body: BuyerOfferViewResponse | BuyerOfferRespondResponse) {
  return Response.json(body, { status: 200, headers: { ...PRIVATE_HEADERS } });
}

function unavailable() {
  return response({ ok: false, status: "unavailable" });
}

function originAllowed(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return local || (url.protocol === "https:" && isApprovedSubmissionHost(url.hostname));
  } catch {
    return false;
  }
}

async function body(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > BUYER_OFFER_PUBLIC_MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function limited(request: Request, action: string, token: string) {
  const network = request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unidentified-client";
  return !consumeMarketplaceAttempt(
    marketplaceRateLimitKey(`buyer-offer-${action}:${network}:${token.slice(0, 16)}`),
  ).allowed;
}

function disabled() {
  return Response.json({ ok: false, error: "Not found." }, { status: 404, headers: { ...PRIVATE_HEADERS } });
}

export function buyerOfferPublicMethodNotAllowed() {
  return Response.json({ ok: false, error: "Method not allowed." }, {
    status: 405,
    headers: { ...PRIVATE_HEADERS, Allow: "POST" },
  });
}

export async function POST_buyerOfferView(request: Request) {
  if (!isMarketplaceEnabled()) return disabled();
  if (!originAllowed(request)) return unavailable();
  const parsed = await body(request);
  if (!parsed || Object.keys(parsed).length !== 1 || typeof parsed.token !== "string") return unavailable();
  if (limited(request, "view", parsed.token)) return unavailable();
  try {
    const [{ priceCheckDb }, { viewBuyerOffer }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/buyer-offer-service"),
    ]);
    const result = await viewBuyerOffer(priceCheckDb, {
      token: parsed.token,
      tokenKey: marketplaceVerifyTokenKey(),
    });
    return result.outcome === "available"
      ? response({ ok: true, offer: result.offer, status: result.status })
      : unavailable();
  } catch {
    return unavailable();
  }
}

export async function POST_buyerOfferRespond(request: Request) {
  if (!isMarketplaceEnabled()) return disabled();
  if (!originAllowed(request)) return unavailable();
  const parsed = await body(request);
  if (
    !parsed
    || Object.keys(parsed).sort().join(",") !== "decision,token"
    || typeof parsed.token !== "string"
    || !(parsed.decision === "accepted" || parsed.decision === "declined")
  ) return unavailable();
  if (limited(request, "respond", parsed.token)) return unavailable();
  try {
    const [{ priceCheckDb }, { respondToBuyerOffer }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/buyer-offer-service"),
    ]);
    const result = await respondToBuyerOffer(priceCheckDb, {
      token: parsed.token,
      tokenKey: marketplaceVerifyTokenKey(),
      decision: parsed.decision as BuyerOfferDecision,
    });
    return result.outcome === "unavailable"
      ? unavailable()
      : response({ ok: true, status: result.decision });
  } catch {
    return unavailable();
  }
}
