import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { validateInformationRequest } from "@/lib/price-check/admin/validation";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("request_information");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let raw: unknown;
  try { raw = await request.json(); } catch { return privateJson({ ok: false, error: "The information request could not be read." }, 400); }
  const validation = validateInformationRequest(raw);
  if (!validation.success) return privateJson({ ok: false, error: "Complete the required information-request fields.", fieldErrors: validation.errors }, 400);
  try {
    const { id } = await context.params;
    const [{ priceCheckDb }, { changePriceCheckStatus }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    await changePriceCheckStatus(priceCheckDb, {
      priceCheckId: id,
      to: "needs_information",
      actor: access.user,
      action: "PRICE_CHECK_INFORMATION_REQUESTED",
      metadata: validation.data,
    });
    return privateJson({ ok: true, deliveryEnabled: false });
  } catch {
    return privateJson({ ok: false, error: "This request cannot move to needs information from its current status." }, 409);
  }
}
