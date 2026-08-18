import "@/db/price-check/server-boundary";

import { cookies } from "next/headers";

import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { getGoogleOidcConfig, oidcRedirectOrigin } from "./oidc";
import { ADMIN_SESSION_COOKIE } from "./session";
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

/**
 * General Civilon staff authentication: Google OIDC session, active user and a
 * recognised role. Deliberately independent of any single product's feature
 * flag so a second workflow's admin surface does not have to enable Price Check.
 * Each surface is responsible for its own feature gate.
 */
export async function getAdminAccess(): Promise<AdminAccess> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return { status: "unauthenticated" };

  try {
    const config = getGoogleOidcConfig();
    const [{ priceCheckDb }, { resolveAdminSession }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/session-repository"),
    ]);
    const user = await resolveAdminSession(priceCheckDb, token, config.sessionSecret);
    if (!user) return { status: "unauthenticated" };
    if (!user.active || !isAdminRole(user.role)) return { status: "forbidden" };
    return {
      status: "authorized",
      user: {
        id: user.id,
        email: user.displayEmail,
        role: user.role,
        active: user.active,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

/** Price Check admin access stays fail-closed behind the Price Check feature flag. */
export async function getPriceCheckAdminAccess(): Promise<AdminAccess> {
  if (!isPriceCheckEnabled()) return { status: "disabled" };
  return getAdminAccess();
}

/**
 * Staff API guard for surfaces that are not part of Price Check. Uses the
 * product-flag-independent `getAdminAccess()`, so a marketplace admin route stays
 * reachable when `NEXT_PUBLIC_PRICE_CHECK_ENABLED` is off. Each caller is still
 * responsible for its own feature gate if it needs one.
 *
 * Deliberately a sibling of `requireAdminApi` rather than a change to it: the
 * Price Check admin API must keep failing closed behind its own flag.
 */
export async function requireStaffApi(capability: AdminCapability) {
  const access = await getAdminAccess();
  if (access.status !== "authorized") return access;
  if (!roleCan(access.user.role, capability)) return { status: "forbidden" as const };
  return access;
}

export async function requireAdminApi(capability: AdminCapability) {
  const access = await getPriceCheckAdminAccess();
  if (access.status !== "authorized") return access;
  if (!roleCan(access.user.role, capability)) return { status: "forbidden" as const };
  return access;
}

export function verifyAdminMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = oidcRedirectOrigin(getGoogleOidcConfig());
  if (!origin || origin !== expectedOrigin) throw new Error("Invalid request origin.");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") throw new Error("Cross-site request denied.");
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
