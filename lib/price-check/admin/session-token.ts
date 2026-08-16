import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type GoogleAdminSession = {
  netlifySubject: string;
  googleSubject: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
};

function sessionSecret() {
  const secret = process.env.PRICE_CHECK_ADMIN_SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("Admin session secret is unavailable.");
  return secret;
}

function sign(payload: string, secret = sessionSecret()) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createGoogleAdminSessionToken(
  input: Pick<GoogleAdminSession, "netlifySubject" | "googleSubject" | "email">,
  now = Date.now(),
  secret?: string,
) {
  const payload = Buffer.from(JSON.stringify({
    ...input,
    issuedAt: Math.floor(now / 1000),
    expiresAt: Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS,
  } satisfies GoogleAdminSession), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyGoogleAdminSessionToken(token: string, now = Date.now(), secret?: string): GoogleAdminSession | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(sign(payload, secret));
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<GoogleAdminSession>;
    if (
      typeof value.netlifySubject !== "string" || typeof value.googleSubject !== "string" ||
      typeof value.email !== "string" || typeof value.issuedAt !== "number" ||
      typeof value.expiresAt !== "number" || value.expiresAt <= Math.floor(now / 1000) ||
      value.issuedAt > Math.floor(now / 1000) + 60
    ) return null;
    return value as GoogleAdminSession;
  } catch {
    return null;
  }
}
