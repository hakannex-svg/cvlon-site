import {
  accessErrorResponse,
  privateJson,
  requireStaffApi,
  verifyAdminMutationOrigin,
} from "@/lib/price-check/admin/auth";
import { isMarketplacePreviewDrainEnabled } from "@/lib/marketplace/notifications/preview-drain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual, ADMIN-only, preview-only drain of the marketplace notification outbox.
 *
 * This route exists for exactly one reason: the production scheduled drain
 * refuses to run in a non-production Netlify context, so a controlled preview
 * would otherwise have no way to prove that Buy/Sell verification mail reaches
 * a customer and that the internal notice reaches the approved recipients.
 *
 * Four independent gates, in this order:
 *
 *  1. An authenticated staff session holding `process_marketplace_notifications`,
 *     which is ADMIN-only. Checked first, so an anonymous prober is turned away
 *     before it can learn anything about this deploy's configuration.
 *  2. A same-origin admin mutation Origin, exactly as every other admin write.
 *  3. The preview opt-in: an explicit non-production `CONTEXT`, the preview flag
 *     set to the literal "true", and marketplace intake enabled. Anything else —
 *     including a missing `CONTEXT` — answers 404, because a production deploy
 *     must not admit that this endpoint is even a thing.
 *  4. POST only. There is nothing to read here.
 *
 * The response is counts. No recipient address, no message body, no subject, no
 * token, no notification or aggregate id, no provider message id and no failure
 * code leaves this boundary — an operator flushing a preview queue needs to know
 * how many and whether any failed, not who was e-mailed about what.
 */

/** Marketplace drains never touch Price Check messages; see `preview-drain.ts`. */
function withPrivacyHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Vary", "Cookie");
  return new Response(response.body, { status: response.status, headers });
}

function notFound() {
  return withPrivacyHeaders(privateJson({ ok: false, error: "Not found." }, 404));
}

export async function POST(request: Request) {
  const access = await requireStaffApi("process_marketplace_notifications");
  if (access.status !== "authorized") return withPrivacyHeaders(accessErrorResponse(access.status));

  // Configuration is only consulted once the caller is known to be an
  // authorized administrator, so the 404 below never doubles as a probe.
  if (!isMarketplacePreviewDrainEnabled()) return notFound();

  try {
    verifyAdminMutationOrigin(request);
  } catch {
    return withPrivacyHeaders(privateJson({ ok: false, error: "The request origin was rejected." }, 403));
  }

  try {
    const [{ priceCheckDb }, drain] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/notifications/preview-drain"),
    ]);
    const summary = await drain.drainMarketplaceNotifications(priceCheckDb);
    return withPrivacyHeaders(privateJson({ ok: true, ...summary }));
  } catch {
    // Nothing about the failure is described: a storage, provider or database
    // fault must not be narrated through an operator-facing endpoint.
    return withPrivacyHeaders(privateJson({
      ok: false,
      error: "Notifications could not be processed.",
    }, 503));
  }
}

/** Nothing here is readable. Processing is a POST and only a POST. */
function methodNotAllowed() {
  const response = withPrivacyHeaders(privateJson({ ok: false, error: "Method not allowed." }, 405));
  const headers = new Headers(response.headers);
  headers.set("Allow", "POST");
  return new Response(response.body, { status: 405, headers });
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
