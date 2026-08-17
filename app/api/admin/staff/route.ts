import {
  accessErrorResponse,
  privateJson,
  requireAdminApi,
  verifyAdminMutationOrigin,
} from "@/lib/price-check/admin/auth";
import { parseStaffInvitationInput } from "@/lib/price-check/admin/staff-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { verifyAdminMutationOrigin(request); }
  catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("manage_staff");
  if (access.status !== "authorized") return accessErrorResponse(access.status);

  let input;
  try { input = parseStaffInvitationInput(await request.json()); }
  catch { input = null; }
  if (!input) return privateJson({ ok: false, error: "Enter a valid staff email and role." }, 400);

  try {
    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/staff-repository"),
    ]);
    const invitation = await repository.createStaffInvitation(priceCheckDb, {
      ...input,
      actor: access.user,
    });
    return privateJson({ ok: true, invitationId: invitation.id }, 201);
  } catch (error) {
    const message = error instanceof Error && /already/.test(error.message)
      ? error.message
      : "The staff invitation could not be saved.";
    return privateJson({ ok: false, error: message }, 409);
  }
}
