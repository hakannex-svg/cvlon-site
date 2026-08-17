import {
  accessErrorResponse,
  privateJson,
  requireAdminApi,
  verifyAdminMutationOrigin,
} from "@/lib/price-check/admin/auth";
import { isStaffId, parseStaffRoleInput } from "@/lib/price-check/admin/staff-validation";

export const runtime = "nodejs";

function safeStaffError(error: unknown) {
  return error instanceof Error && error.message === "The final active ADMIN cannot be changed or disabled."
    ? error.message
    : "The staff account update could not be completed.";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); }
  catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("manage_staff");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  const { id } = await context.params;
  if (!isStaffId(id)) return privateJson({ ok: false, error: "The staff account is unavailable." }, 404);

  let body: unknown;
  try { body = await request.json(); } catch { return privateJson({ ok: false, error: "The staff update could not be read." }, 400); }
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
      await repository.changeBoundStaffRole(priceCheckDb, { adminUserId: id, role, actor: access.user });
    } else if (action === "disable" && Object.keys(record ?? {}).length === 1) {
      await repository.setBoundStaffActive(priceCheckDb, { adminUserId: id, active: false, actor: access.user });
    } else if (action === "enable" && Object.keys(record ?? {}).length === 1) {
      await repository.setBoundStaffActive(priceCheckDb, { adminUserId: id, active: true, actor: access.user });
    } else if (action === "revoke_sessions" && Object.keys(record ?? {}).length === 1) {
      await repository.revokeBoundStaffSessions(priceCheckDb, { adminUserId: id, actor: access.user });
    } else {
      return privateJson({ ok: false, error: "The staff action was rejected." }, 400);
    }
    return privateJson({ ok: true });
  } catch (error) {
    return privateJson({ ok: false, error: safeStaffError(error) }, 409);
  }
}
