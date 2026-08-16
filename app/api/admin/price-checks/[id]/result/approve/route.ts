import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("approve_result");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    const body = await request.json() as { resultId?: unknown };
    if (typeof body.resultId !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(body.resultId)) throw new Error("Result reference is invalid.");
    const { id } = await context.params;
    const [{ priceCheckDb }, { approveCustomerResult }] = await Promise.all([import("@/db/price-check"), import("@/db/price-check/repositories/result-delivery-repository")]);
    const result = await approveCustomerResult(priceCheckDb, { priceCheckId: id, resultId: body.resultId, actor: access.user });
    return privateJson({ ok: true, state: result.state });
  } catch (error) {
    return privateJson({ ok: false, error: error instanceof Error ? error.message : "Result could not be approved." }, 409);
  }
}
