import { accessErrorResponse, privateJson, requireStaffApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { staffRoles } from "@/db/price-check/repositories/admin-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireStaffApi("manage_staff");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    return privateJson({ ok: true, staff: await repository.listStaff(priceCheckDb) });
  } catch {
    return privateJson({ ok: false, error: "Staff records are temporarily unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  const access = await requireStaffApi("manage_staff");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    verifyAdminMutationOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : "";
    const role = typeof body.role === "string" ? body.role : "";
    if (!staffRoles.includes(role as typeof staffRoles[number])) return privateJson({ ok: false, error: "Choose a valid role." }, 400);
    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    const created = await repository.createPendingStaff(priceCheckDb, { email, role: role as typeof staffRoles[number], actor: access.user });
    return privateJson({ ok: true, staff: created }, 201);
  } catch (error) {
    return privateJson({ ok: false, error: error instanceof Error ? error.message : "Staff record could not be created." }, 400);
  }
}

export async function PATCH(request: Request) {
  const access = await requireStaffApi("manage_staff");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    verifyAdminMutationOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    const action = body.action;
    if (!id || !["role", "disable", "enable", "revoke"].includes(String(action))) return privateJson({ ok: false, error: "Invalid staff action." }, 400);
    const role = typeof body.role === "string" ? body.role : undefined;
    if (action === "role" && !staffRoles.includes(role as typeof staffRoles[number])) return privateJson({ ok: false, error: "Choose a valid role." }, 400);
    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    const updated = await repository.updateStaff(priceCheckDb, { id, action: action as "role" | "disable" | "enable" | "revoke", role: role as typeof staffRoles[number] | undefined, actor: access.user });
    return privateJson({ ok: true, staff: updated });
  } catch (error) {
    return privateJson({ ok: false, error: error instanceof Error ? error.message : "Staff action failed." }, 400);
  }
}
