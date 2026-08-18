import "../../db/price-check/server-boundary.ts";

import { isApprovedSubmissionHost } from "../submission-host.ts";
import { isSellSubmissionEnabled } from "./feature.ts";
import { consumeMarketplaceAttempt, marketplaceRateLimitKey } from "./rate-limit.ts";
import {
  SELL_EVIDENCE_HANDLE_PATTERN,
  SELL_EVIDENCE_SUBMIT_MAX_BODY_BYTES,
  SELL_EVIDENCE_VIEW_MAX_BODY_BYTES,
  type SellEvidenceSubmitResponse,
  type SellEvidenceViewResponse,
} from "./sell-evidence-contract.ts";
import { readMarketplaceUploadCookie } from "./uploads/session.ts";
import { MARKETPLACE_UPLOAD_MAX_FILES } from "./uploads/constants.ts";
import { MARKETPLACE_SCAN_REJECTED_CODE, isRetryableScanCode } from "./uploads/scan.ts";
import { marketplaceVerifyTokenKey } from "./verification.ts";

/**
 * The two account-free endpoints behind the seller-evidence link.
 *
 * Both are POST-only and both take the credential in the body, never in the
 * URL: a credential in a path or query string ends up in an access log, a CDN
 * log and a Referer header, and the page's whole design is that it never leaves
 * the browser except in a body Civilon receives directly.
 *
 * `view` is deliberately non-consuming. Mail scanners, link previewers and
 * browser prefetchers all follow emailed links; if arriving spent the
 * credential, those systems would burn it before the seller read the message.
 *
 * Every refusal on both endpoints is the same opaque `unavailable`, except the
 * two that describe the seller's own file — a scan still running, or content
 * that is not what it claimed to be. Those are safe to say plainly because they
 * are about the file in front of the seller and reveal nothing about whether
 * any other submission, session or handle exists.
 */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
} as const;

function json(
  body: SellEvidenceViewResponse | SellEvidenceSubmitResponse,
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

export function sellEvidenceMethodNotAllowed() {
  return Response.json({ ok: false, error: "Method not allowed." }, {
    status: 405,
    headers: { ...PRIVATE_HEADERS, Allow: "POST" },
  });
}

/**
 * An Origin header is required and must be an approved Civilon origin. Unlike
 * the intake routes, a missing Origin is not tolerated: these requests only
 * ever originate from an already-loaded Civilon page, and the submit endpoint
 * relies on a `SameSite=Strict` cookie that a non-browser client cannot have.
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
    marketplaceRateLimitKey(`sell-evidence-${action}:${clientNetworkKey(request)}:${token.slice(0, 16)}`),
  ).allowed;
}

export async function POST_sellEvidenceView(request: Request) {
  if (!isSellSubmissionEnabled()) return disabled();
  if (!originAllowed(request)) return unavailable();
  const parsed = await readBody(request, SELL_EVIDENCE_VIEW_MAX_BODY_BYTES);
  if (!parsed || Object.keys(parsed).length !== 1 || typeof parsed.token !== "string") {
    return unavailable();
  }
  if (limited(request, "view", parsed.token)) return unavailable();
  try {
    const [{ priceCheckDb }, { viewSellEvidenceRequest }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/sell-evidence-service"),
    ]);
    const snapshot = await viewSellEvidenceRequest(priceCheckDb, {
      token: parsed.token,
      tokenKey: marketplaceVerifyTokenKey(),
    });
    if (!snapshot) return unavailable();
    // Reference, category labels and expiry. Deliberately not the submission
    // id, the contact, the request id, or anything about the offer.
    return json({
      ok: true,
      request: {
        reference: snapshot.publicReference,
        categories: snapshot.categories,
        expiresAt: snapshot.expiresAt.toISOString(),
      },
    });
  } catch {
    return unavailable();
  }
}

function handleList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > MARKETPLACE_UPLOAD_MAX_FILES) return null;
  const handles: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !SELL_EVIDENCE_HANDLE_PATTERN.test(entry)) return null;
    handles.push(entry);
  }
  // A duplicated handle is a caller trying to bind one file twice. The binding
  // layer refuses it too; refusing here keeps it out of a storage round trip.
  return new Set(handles).size === handles.length ? handles : null;
}

/** Content verdicts that describe the seller's own file and are safe to echo. */
const CONTENT_REFUSAL = /Macro-enabled|Password-protected|not a valid|not a plain CSV|must be UTF-8|does not match its declared type|structure (is incomplete|could not be verified)|dimensions|stored file/i;

export async function POST_sellEvidenceSubmit(request: Request) {
  if (!isSellSubmissionEnabled()) return disabled();
  if (!originAllowed(request)) return unavailable();
  const parsed = await readBody(request, SELL_EVIDENCE_SUBMIT_MAX_BODY_BYTES);
  if (
    !parsed
    || Object.keys(parsed).sort().join(",") !== "attachmentHandles,token"
    || typeof parsed.token !== "string"
  ) return unavailable();
  const handles = handleList(parsed.attachmentHandles);
  if (!handles) return unavailable();
  if (limited(request, "submit", parsed.token)) return unavailable();

  try {
    const [{ priceCheckDb }, { submitSellEvidence }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/sell-evidence-service"),
    ]);
    const result = await submitSellEvidence(priceCheckDb, {
      token: parsed.token,
      tokenKey: marketplaceVerifyTokenKey(),
      handles,
      // The upload session travels in a host-only HttpOnly cookie, never in the
      // body. A caller cannot name someone else's session, and a handle on its
      // own proves nothing without it.
      uploadSessionToken: readMarketplaceUploadCookie(request.headers.get("cookie")),
    });
    // The reference is deliberately not echoed: the seller already has it, and
    // returning it would make this endpoint a way to test whether a guessed
    // credential belongs to a real submission.
    return result.outcome === "bound" ? json({ ok: true, status: "received" }) : unavailable();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    // Scan evidence still pending is a retry, not a refusal: nothing was
    // stored, nothing was claimed clean, and the seller did nothing wrong.
    if (isRetryableScanCode(message)) {
      return json({
        ok: false,
        status: "retry",
        error: "Your files are still being checked. Please try again in a moment.",
      }, 409, { "Retry-After": "20" });
    }
    if (message === MARKETPLACE_SCAN_REJECTED_CODE) {
      return json({
        ok: false,
        status: "rejected",
        error: "One of your files did not pass our safety check. Remove it and try again.",
      }, 400);
    }
    if (CONTENT_REFUSAL.test(message)) {
      return json({ ok: false, status: "rejected", error: message }, 400);
    }

    // Only the error's shape is logged. No credential, no reference, no
    // filename, no handle, no address.
    const failure = error && typeof error === "object"
      ? error as { name?: unknown; code?: unknown }
      : {};
    console.error(JSON.stringify({
      event: "SELL_EVIDENCE_SUBMIT_FAILED",
      errorName: typeof failure.name === "string" ? failure.name : "UnknownError",
      errorCode: typeof failure.code === "string" ? failure.code : null,
    }));
    return unavailable();
  }
}
