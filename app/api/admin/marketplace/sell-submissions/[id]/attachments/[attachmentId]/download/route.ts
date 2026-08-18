import { accessErrorResponse, privateJson, requireStaffApi } from "@/lib/price-check/admin/auth";

export const runtime = "nodejs";

const RECORD_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Every response from this route carries the full private set, including
 * `Referrer-Policy`, so a signed URL can never leak through a Referer header
 * on the page the browser lands on next.
 */
function withPrivacyHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Vary", "Cookie");
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Authenticated, record-bound, scan-gated staff download of seller evidence.
 *
 * The response body never carries the bucket, the object key, the storage
 * configuration or a provider diagnostic. The only thing that leaves with the
 * key in it is the short-lived redirect `Location`, which is the same shape the
 * Price Check attachment download already uses.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  const access = await requireStaffApi("download_marketplace_evidence");
  if (access.status !== "authorized") return withPrivacyHeaders(accessErrorResponse(access.status));

  try {
    const { id, attachmentId } = await context.params;
    if (!RECORD_ID_PATTERN.test(id) || !RECORD_ID_PATTERN.test(attachmentId)) {
      return withPrivacyHeaders(privateJson({ ok: false, error: "This document is not available." }, 404));
    }

    const [{ priceCheckDb }, evidence] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/marketplace/admin/evidence-download"),
    ]);
    const result = await evidence.authorizeSellEvidenceDownload(priceCheckDb, {
      sellSubmissionId: id,
      attachmentId,
      actorId: access.user.id,
    });

    if (result.outcome === "not_found") {
      return withPrivacyHeaders(privateJson({ ok: false, error: "This document is not available." }, 404));
    }
    if (result.outcome === "not_clean") {
      return withPrivacyHeaders(privateJson({
        ok: false,
        error: "This document is not currently available for review. Its malware scan is not clean.",
      }, 409));
    }
    if (result.outcome === "unavailable") {
      return withPrivacyHeaders(privateJson({ ok: false, error: "The secure download could not be created." }, 503));
    }

    return withPrivacyHeaders(new Response(null, {
      status: 303,
      headers: { Location: result.signedUrl },
    }));
  } catch {
    return withPrivacyHeaders(privateJson({ ok: false, error: "The secure download could not be created." }, 503));
  }
}

function methodNotAllowed() {
  const response = privateJson({ ok: false, error: "Method not allowed." }, 405);
  const withHeaders = withPrivacyHeaders(response);
  const headers = new Headers(withHeaders.headers);
  headers.set("Allow", "GET");
  return new Response(withHeaders.body, { status: 405, headers });
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
