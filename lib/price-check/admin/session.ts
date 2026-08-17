import "../../../db/price-check/server-boundary.ts";

import { createHmac, randomBytes } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "__Host-cvlon_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

export function newAdminSessionToken() {
  return randomBytes(48).toString("base64url");
}

export function hashAdminSessionToken(token: string, secret: string) {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

export function secureCookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSecureCookie(name: string) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
