import "../../../db/price-check/server-boundary.ts";

import { createHash, randomBytes } from "node:crypto";
import { PRICE_CHECK_UPLOAD_COOKIE, PRICE_CHECK_UPLOAD_SESSION_SECONDS } from "./constants.ts";

export function newUploadSessionToken() {
  return randomBytes(48).toString("base64url");
}

export function hashUploadSessionToken(token: string) {
  return createHash("sha256")
    .update(`civilon-price-check-upload-session:v1:${token}`)
    .digest("hex");
}

export function readUploadCookie(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === PRICE_CHECK_UPLOAD_COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function uploadSessionCookie(token: string) {
  return `${PRICE_CHECK_UPLOAD_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${PRICE_CHECK_UPLOAD_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

