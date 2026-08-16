import "../../../db/price-check/server-boundary.ts";

import { cookies } from "next/headers";
import {
  ADMIN_SESSION_TTL_SECONDS,
  verifyGoogleAdminSessionToken,
} from "./session-token";

export { createGoogleAdminSessionToken } from "./session-token";

export const ADMIN_SESSION_COOKIE = "__Secure-civilon-price-check-admin";
export async function readGoogleAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  return token ? verifyGoogleAdminSessionToken(token) : null;
}

export function googleAdminSessionCookie(token: string) {
  return `${ADMIN_SESSION_COOKIE}=${token}; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearGoogleAdminSessionCookie() {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
