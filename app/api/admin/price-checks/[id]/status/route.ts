import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { allowedOperationalStatuses, roleCan } from "@/lib/price-check/admin/policy";
import type { PriceCheckStatus } from "@/db/price-check/domain/status-policy";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("transition");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let raw: unknown;
  try { raw = await request.json(); } catch { return privateJson({ ok: false, error: "The status action could not be read." }, 400); }
  const to = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).to : null;
  const allowed = allowedOperationalStatuses(access.user.role) as readonly string[];
  if (typeof to !== "string" || !allowed.includes(to)) return privateJson({ ok: false, error: "That status action is not permitted." }, 403);
  if (["processing_failed", "spam", "closed"].includes(to) && !roleCan(access.user.role, "exceptional_transition")) return privateJson({ ok: false, error: "That status action requires an administrator." }, 403);
  try {
    const { id } = await context.params;
    const [{ priceCheckDb }, { changePriceCheckStatus }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    await changePriceCheckStatus(priceCheckDb, {
      priceCheckId: id,
      to: to as PriceCheckStatus,
      actor: access.user,
      action: to === "spam" ? "PRICE_CHECK_MARKED_SPAM" : to === "closed" ? "PRICE_CHECK_CLOSED" : undefined,
    });
    return privateJson({ ok: true, status: to });
  } catch {
    return privateJson({ ok: false, error: "That transition is not valid from the current status." }, 409);
  }
}
