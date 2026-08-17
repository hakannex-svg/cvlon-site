import "../../../db/price-check/server-boundary.ts";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

import { verifiedGoogleIdentity, type VerifiedStaffIdentity } from "./identity.ts";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const TRANSACTION_ISSUER = "civilon-price-check";
const TRANSACTION_AUDIENCE = "civilon-google-oidc-callback";
const TRANSACTION_TTL_SECONDS = 10 * 60;
const SAFE_TOKEN_EXCHANGE_ERRORS = new Set([
  "invalid_client",
  "invalid_grant",
  "invalid_request",
  "redirect_uri_mismatch",
  "unauthorized_client",
]);

export const GOOGLE_OIDC_TRANSACTION_COOKIE = "__Host-cvlon_oidc_transaction";

export type GoogleOidcConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
};

export class GoogleTokenExchangeError extends Error {
  readonly safeCode: string;

  constructor(code: unknown) {
    const safeCode =
      typeof code === "string" && SAFE_TOKEN_EXCHANGE_ERRORS.has(code)
        ? code
        : "provider_error";
    super("Google token exchange failed.");
    this.name = "GoogleTokenExchangeError";
    this.safeCode = safeCode;
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export function getGoogleOidcConfig(): GoogleOidcConfig {
  const redirectUri = requiredEnvironment("GOOGLE_OIDC_REDIRECT_URI");
  const parsedRedirect = new URL(redirectUri);
  if (parsedRedirect.protocol !== "https:" || parsedRedirect.pathname !== "/api/admin/auth/google/callback") {
    throw new Error("Invalid GOOGLE_OIDC_REDIRECT_URI.");
  }
  return {
    clientId: requiredEnvironment("GOOGLE_OIDC_CLIENT_ID"),
    clientSecret: requiredEnvironment("GOOGLE_OIDC_CLIENT_SECRET"),
    redirectUri,
    sessionSecret: requiredEnvironment("GOOGLE_OIDC_SESSION_SECRET"),
  };
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signingKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function createGoogleAuthorizationRequest(config: GoogleOidcConfig) {
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(48);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const transaction = await new SignJWT({ state, nonce, codeVerifier })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(TRANSACTION_ISSUER)
    .setAudience(TRANSACTION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TRANSACTION_TTL_SECONDS}s`)
    .setJti(randomToken())
    .sign(signingKey(config.sessionSecret));

  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url, transaction };
}

export async function verifyGoogleAuthorizationTransaction(
  transaction: string,
  returnedState: string,
  config: GoogleOidcConfig,
) {
  const { payload } = await jwtVerify(transaction, signingKey(config.sessionSecret), {
    issuer: TRANSACTION_ISSUER,
    audience: TRANSACTION_AUDIENCE,
    algorithms: ["HS256"],
  });
  if (
    typeof payload.state !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.codeVerifier !== "string" ||
    !constantTimeEqual(payload.state, returnedState)
  ) {
    throw new Error("Invalid OAuth transaction.");
  }
  return {
    nonce: payload.nonce,
    codeVerifier: payload.codeVerifier,
  };
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  transaction: { nonce: string; codeVerifier: string },
  config: GoogleOidcConfig,
): Promise<VerifiedStaffIdentity> {
  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: transaction.codeVerifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const tokenBody = await tokenResponse.json() as { error?: unknown; id_token?: unknown };
  if (!tokenResponse.ok) throw new GoogleTokenExchangeError(tokenBody.error);
  if (typeof tokenBody.id_token !== "string") throw new Error("Google ID token missing.");

  const { payload } = await jwtVerify(tokenBody.id_token, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience: config.clientId,
    algorithms: ["RS256"],
  });
  const identity = verifiedGoogleIdentity(payload, transaction.nonce);
  if (!identity) throw new Error("Google identity claims rejected.");
  return identity;
}

export function oidcRedirectOrigin(config: GoogleOidcConfig) {
  return new URL(config.redirectUri).origin;
}

export const googleOidcTransactionMaxAge = TRANSACTION_TTL_SECONDS;
