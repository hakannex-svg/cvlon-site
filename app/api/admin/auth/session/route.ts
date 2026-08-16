import { privateJson, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { clearGoogleAdminSessionCookie } from "@/lib/price-check/admin/session";

export async function DELETE(request: Request) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const response = privateJson({ ok: true });
  response.headers.append("Set-Cookie", clearGoogleAdminSessionCookie());
  return response;
}
