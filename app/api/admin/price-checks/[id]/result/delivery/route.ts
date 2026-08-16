import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("send_result");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    const body = await request.json() as { resultId?: unknown };
    if (typeof body.resultId !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(body.resultId)) throw new Error("Result reference is invalid.");
    const tokenKey = process.env.PRICE_CHECK_RESULT_TOKEN_KEY ?? "";
    const { id } = await context.params;
    const [{ priceCheckDb }, { queueCustomerResultDelivery }] = await Promise.all([import("@/db/price-check"), import("@/db/price-check/repositories/result-delivery-repository")]);
    const queued = await queueCustomerResultDelivery(priceCheckDb, { priceCheckId: id, resultId: body.resultId, actor: access.user, tokenKey });
    return privateJson({ ok: true, delivery: queued.queued ? "queued" : "already_queued", expiresAt: queued.tokenExpiresAt.toISOString() });
  } catch (error) {
    return privateJson({ ok: false, error: error instanceof Error ? error.message : "Result delivery could not be queued." }, 409);
  }
}
