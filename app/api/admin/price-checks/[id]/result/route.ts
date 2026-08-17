import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { parseResultDraftInput } from "@/lib/price-check/admin/result-validation";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("draft_result");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    const input = parseResultDraftInput(await request.json());
    const { id } = await context.params;
    const [{ priceCheckDb }, { createCustomerResultDraft }] = await Promise.all([import("@/db/price-check"), import("@/db/price-check/repositories/result-delivery-repository")]);
    const result = await createCustomerResultDraft(priceCheckDb, { priceCheckId: id, actor: access.user, ...input });
    return privateJson({ ok: true, resultId: result.id, version: result.version }, 201);
  } catch (error) {
    return privateJson({ ok: false, error: error instanceof Error ? error.message : "Result draft could not be saved." }, 409);
  }
}
