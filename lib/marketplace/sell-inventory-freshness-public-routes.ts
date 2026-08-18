import "../../db/price-check/server-boundary.ts";

import { isApprovedSubmissionHost } from "../submission-host.ts";
import { isSellSubmissionEnabled } from "./feature.ts";
import { consumeMarketplaceAttempt, marketplaceRateLimitKey } from "./rate-limit.ts";
import { isSellInventoryFreshnessResponse } from "../../db/price-check/domain/sell-inventory-freshness.ts";
import {
  SELL_INVENTORY_FRESHNESS_RESPOND_MAX_BODY_BYTES,
  SELL_INVENTORY_FRESHNESS_VIEW_MAX_BODY_BYTES,
  type SellInventoryFreshnessRespondResponse,
  type SellInventoryFreshnessViewResponse,
} from "./sell-inventory-freshness-contract.ts";
import { marketplaceVerifyTokenKey } from "./verification.ts";

/**
 * The two account-free endpoints behind the bulk-inventory freshness link.
 *
 * Both are POST-only and both take the credential in the body, never in the
 * URL: a credential in a path or query string ends up in an access log, a CDN
 * log and a Referer header, and the page's whole design is that it never leaves
 * the browser except in a body Civilon receives directly.
 *
 * `view` is deliberately non-consuming and, unlike the evidence view, it is also
 * the only reason a GET would ever be tempting here — which is exactly why every
 * other verb answers 405. Mail scanners, link previewers and browser prefetchers
 * all follow emailed links; a GET that recorded "all available" because Outlook
 * fetched the URL would be Civilon putting words in a seller's mouth.
 *
 * Every refusal on both endpoints is the same opaque `unavailable`. A guessed,
 * expired, replayed, revoked, wrong-record or attempt-exhausted credential is
 * answered identically, so a caller learns nothing about which submissions exist
 * or what any seller has said.
 */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
} as const;

function json(
  body: SellInventoryFreshnessViewResponse | SellInventoryFreshnessRespondResponse,
  status = 200,
  headers: HeadersInit = {},
) {
  return Response.json(body, { status, headers: { ...PRIVATE_HEADERS, ...headers } });
}

function unavailable() {
  return json({ ok: false, status: "unavailable" });
}

function disabled() {
  return Response.json({ ok: false, error: "Not found." }, {
    status: 404,
    headers: { ...PRIVATE_HEADERS },
  });
}

export function sellInventoryFreshnessMethodNotAllowed() {
  return Response.json({ ok: false, error: "Method not allowed." }, {
    status: 405,
    headers: { ...PRIVATE_HEADERS, Allow: "POST" },
  });
}

/**
 * An Origin header is required and must be an approved Civilon origin. Unlike
 * the intake routes, a missing Origin is not tolerated: these requests only ever
 * originate from an already-loaded Civilon page.
 */
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

async function readBody(request: Request, maxBytes: number) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function clientNetworkKey(request: Request) {
  return request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unidentified-client";
}

/**
 * Rate-limited per network and per credential prefix. The prefix, not the whole
 * credential, so the limiter's own key material is not a copy of the secret.
 */
function limited(request: Request, action: string, token: string) {
  return !consumeMarketplaceAttempt(
    marketplaceRateLimitKey(`sell-inventory-freshness-${action}:${clientNetworkKey(request)}:${token.slice(0, 16)}`),
  ).allowed;
}

export async function POST_sellInventoryFreshnessView(request: Request) {
  if (!isSellSubmissionEnabled()) return disabled();
  if (!originAllowed(request)) return unavailable();
  const parsed = await readBody(request, SELL_INVENTORY_FRESHNESS_VIEW_MAX_BODY_BYTES);
  if (!parsed || Object.keys(parsed).length !== 1 || typeof parsed.token !== "string") {
    return unavailable();
  }
  if (limited(request, "view", parsed.token)) return unavailable();
  try {
    const [{ priceCheckDb }, { viewSellInventoryFreshnessCheck }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/sell-inventory-freshness-service"),
    ]);
    const snapshot = await viewSellInventoryFreshnessCheck(priceCheckDb, {
      token: parsed.token,
      tokenKey: marketplaceVerifyTokenKey(),
    });
    if (!snapshot) return unavailable();
    // Reference and expiry. Deliberately not the submission id, the contact, the
    // check id, the line count, the warehouse, or anything about the inventory.
    return json({
      ok: true,
      check: {
        reference: snapshot.publicReference,
        expiresAt: snapshot.expiresAt.toISOString(),
      },
    });
  } catch {
    return unavailable();
  }
}

export async function POST_sellInventoryFreshnessRespond(request: Request) {
  if (!isSellSubmissionEnabled()) return disabled();
  if (!originAllowed(request)) return unavailable();
  const parsed = await readBody(request, SELL_INVENTORY_FRESHNESS_RESPOND_MAX_BODY_BYTES);
  if (
    !parsed
    || Object.keys(parsed).sort().join(",") !== "response,token"
    || typeof parsed.token !== "string"
    || !isSellInventoryFreshnessResponse(parsed.response)
  ) return unavailable();
  if (limited(request, "respond", parsed.token)) return unavailable();

  try {
    const [{ priceCheckDb }, { respondToSellInventoryFreshnessCheck }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/sell-inventory-freshness-service"),
    ]);
    const result = await respondToSellInventoryFreshnessCheck(priceCheckDb, {
      token: parsed.token,
      tokenKey: marketplaceVerifyTokenKey(),
      response: parsed.response,
    });
    // The reference is deliberately not echoed, and neither is the answer: the
    // seller already knows both, and returning either would make this endpoint a
    // way to test a guessed credential against a real submission.
    return result.outcome === "recorded" ? json({ ok: true, status: "recorded" }) : unavailable();
  } catch (error) {
    // Only the error's shape is logged. No credential, no reference, no answer,
    // no address, nothing about the inventory.
    const failure = error && typeof error === "object"
      ? error as { name?: unknown; code?: unknown }
      : {};
    console.error(JSON.stringify({
      event: "SELL_INVENTORY_FRESHNESS_RESPOND_FAILED",
      errorName: typeof failure.name === "string" ? failure.name : "UnknownError",
      errorCode: typeof failure.code === "string" ? failure.code : null,
    }));
    return unavailable();
  }
}
