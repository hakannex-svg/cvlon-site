import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { validateReviewedTransaction } from "@/lib/price-check/admin/validation";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("revise");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let raw: unknown;
  try { raw = await request.json(); } catch { return privateJson({ ok: false, error: "The revision could not be read." }, 400); }
  const validation = validateReviewedTransaction(raw);
  if (!validation.success) return privateJson({ ok: false, error: "Review the highlighted correction fields.", fieldErrors: validation.errors }, 400);
  try {
    const { id } = await context.params;
    const [{ priceCheckDb }, { createAdminRevision }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    const revision = await createAdminRevision(priceCheckDb, { priceCheckId: id, actor: access.user, transaction: validation.data });
    return privateJson({ ok: true, version: revision.version }, 201);
  } catch {
    return privateJson({ ok: false, error: "The reviewed transaction could not be saved." }, 409);
  }
}
