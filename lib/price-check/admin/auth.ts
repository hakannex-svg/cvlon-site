import "@/db/price-check/server-boundary";

import { getUser, verifyRequestOrigin } from "@netlify/identity";

import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { isBootstrapAdmin, verifiedStaffIdentity } from "./identity";
import { isAdminRole, roleCan, type AdminCapability, type AdminRole } from "./policy";

export type PriceCheckAdmin = {
  id: string;
  email: string;
  role: AdminRole;
  active: boolean;
};

export type AdminAccess =
  | { status: "disabled" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "unavailable" }
  | { status: "authorized"; user: PriceCheckAdmin };

export async function getPriceCheckAdminAccess(): Promise<AdminAccess> {
  if (!isPriceCheckEnabled()) return { status: "disabled" };
  const identityUser = await getUser();
  if (!identityUser) return { status: "unauthenticated" };
  const identity = verifiedStaffIdentity(identityUser);
  if (!identity) return { status: "forbidden" };

  try {
    const [{ priceCheckDb }, { bindOrAuthorizeAdmin }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    const result = await bindOrAuthorizeAdmin(
      priceCheckDb,
      identity,
      isBootstrapAdmin(identity.email),
    );
    if ((result.status !== "authorized" && result.status !== "bound") || !isAdminRole(result.user.role)) {
      return { status: "forbidden" };
    }
    return {
      status: "authorized",
      user: {
        id: result.user.id,
        email: result.user.displayEmail,
        role: result.user.role,
        active: result.user.active,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function requireAdminApi(capability: AdminCapability) {
  const access = await getPriceCheckAdminAccess();
  if (access.status !== "authorized") return access;
  if (!roleCan(access.user.role, capability)) return { status: "forbidden" as const };
  return access;
}

export function verifyAdminMutationOrigin(request: Request) {
  verifyRequestOrigin(request);
  if (!request.headers.get("origin")) throw new Error("Missing request origin.");
}

export function privateJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      Vary: "Cookie",
    },
  });
}

export function accessErrorResponse(status: Exclude<AdminAccess["status"], "authorized">) {
  if (status === "disabled") return privateJson({ ok: false, error: "Not found." }, 404);
  if (status === "unauthenticated") return privateJson({ ok: false, error: "Authentication required." }, 401);
  if (status === "forbidden") return privateJson({ ok: false, error: "Access denied." }, 403);
  return privateJson({ ok: false, error: "Administration is temporarily unavailable." }, 503);
}
