import {
  accessErrorResponse,
  privateJson,
  requireAdminApi,
  verifyAdminMutationOrigin,
} from "@/lib/price-check/admin/auth";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch {
    return privateJson({ ok: false, error: "Request origin was rejected." }, 403);
  }
  const access = await requireAdminApi("reconcile_attachment");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    const { id } = await context.params;
    const [{ priceCheckDb }, { reconcilePriceCheckAttachments }] = await Promise.all([
      import("@/db/price-check"),
      import("@/lib/price-check/uploads/reconciliation"),
    ]);
    const results = await reconcilePriceCheckAttachments(priceCheckDb, id, access.user.id);
    return privateJson({ ok: true, results });
  } catch {
    return privateJson({ ok: false, error: "Document scan status could not be refreshed." }, 503);
  }
}

export function GET() { return privateJson({ ok: false, error: "Method not allowed." }, 405); }
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;

