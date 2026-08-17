import {
  accessErrorResponse,
  privateJson,
  requireAdminApi,
  verifyAdminMutationOrigin,
} from "@/lib/price-check/admin/auth";
import { isStaffId, parseStaffRoleInput } from "@/lib/price-check/admin/staff-validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); }
  catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("manage_staff");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  const { id } = await context.params;
  if (!isStaffId(id)) return privateJson({ ok: false, error: "The invitation is unavailable." }, 404);

  let body: unknown;
  try { body = await request.json(); } catch { return privateJson({ ok: false, error: "The invitation update could not be read." }, 400); }
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const action = record?.action;
  try {
    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/staff-repository"),
    ]);
    if (action === "change_role" && Object.keys(record ?? {}).every((key) => key === "action" || key === "role")) {
      const role = parseStaffRoleInput({ role: record?.role });
      if (!role) return privateJson({ ok: false, error: "Choose a valid staff role." }, 400);
      await repository.changeInvitationRole(priceCheckDb, { invitationId: id, role, actor: access.user });
    } else if (action === "revoke" && Object.keys(record ?? {}).length === 1) {
      await repository.revokeStaffInvitation(priceCheckDb, { invitationId: id, actor: access.user });
    } else {
      return privateJson({ ok: false, error: "The invitation action was rejected." }, 400);
    }
    return privateJson({ ok: true });
  } catch {
    return privateJson({ ok: false, error: "The pending invitation is unavailable." }, 409);
  }
}
