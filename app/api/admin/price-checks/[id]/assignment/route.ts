import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { roleCan } from "@/lib/price-check/admin/policy";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("self_assign");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let body: unknown;
  try { body = await request.json(); } catch { return privateJson({ ok: false, error: "The assignment could not be read." }, 400); }
  const assigneeId = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).assigneeId : null;
  if (typeof assigneeId !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(assigneeId)) return privateJson({ ok: false, error: "Choose an active staff member." }, 400);
  if (assigneeId !== access.user.id && !roleCan(access.user.role, "assign_any")) return privateJson({ ok: false, error: "You may only assign this request to yourself." }, 403);
  try {
    const { id } = await context.params;
    const [{ priceCheckDb }, { assignPriceCheck }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    await assignPriceCheck(priceCheckDb, { priceCheckId: id, assigneeId, actor: access.user });
    return privateJson({ ok: true });
  } catch {
    return privateJson({ ok: false, error: "The assignment could not be saved." }, 409);
  }
}
