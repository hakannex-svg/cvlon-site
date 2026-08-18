import "../../db/price-check/server-boundary.ts";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { isApprovedSubmissionHost } from "../submission-host.ts";
import { BUY_REQUEST_VERIFY_FRAGMENT_KEY, BUY_REQUEST_VERIFY_PATH } from "./contract.ts";
import {
  SELL_SUBMISSION_VERIFY_FRAGMENT_KEY,
  SELL_SUBMISSION_VERIFY_PATH,
} from "./sell-contract.ts";

/**
 * Generic Buy/Sell email-verification token domain.
 *
 * Same construction as the Price Check result token: the credential is derived
 * by HMAC from a server key plus a stored random nonce, and only a second,
 * differently-labelled HMAC of the credential is persisted. A database reader
 * therefore holds neither the credential nor anything that can be replayed
 * without the key, and the plaintext exists only in the outbound email.
 */
export const BUY_REQUEST_VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Base64url of a 32-byte HMAC: the exact shape a redeem endpoint may accept. */
export const VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function keyBytes(key: string) {
  if (key.length < 32) throw new Error("MARKETPLACE_VERIFY_TOKEN_KEY_UNAVAILABLE");
  return Buffer.from(key, "utf8");
}

/**
 * Fails closed. Verification is unavailable rather than falling back to a weak
 * or empty key, which would make every issued token forgeable.
 */
export function marketplaceVerifyTokenKey(env: Record<string, string | undefined> = process.env) {
  return keyBytes(env.MARKETPLACE_VERIFY_TOKEN_KEY ?? "").toString("utf8");
}

export function newVerificationNonce() {
  return randomBytes(32).toString("hex");
}

export function deriveVerificationToken(key: string, nonce: string) {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error("VERIFICATION_NONCE_INVALID");
  return createHmac("sha256", keyBytes(key))
    .update(`civilon-marketplace-verify-token:v1:${nonce}`)
    .digest("base64url");
}

/**
 * Sell Submission credentials are derived under their own HMAC label.
 *
 * The lookup hash namespace is shared (one unique index over every issued
 * credential), but the credential itself is aggregate-scoped: the same nonce
 * yields a different token for a Buy Request than for a Sell Submission. A Buy
 * credential therefore cannot be presented at the Sell endpoint and vice versa,
 * independently of the aggregate and purpose checks the redeem paths already
 * make. Two independent barriers, so neither one has to be the only one.
 */
export function deriveSellVerificationToken(key: string, nonce: string) {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error("VERIFICATION_NONCE_INVALID");
  return createHmac("sha256", keyBytes(key))
    .update(`civilon-marketplace-sell-verify-token:v1:${nonce}`)
    .digest("base64url");
}

export function hashVerificationToken(key: string, token: string) {
  return createHmac("sha256", keyBytes(key))
    .update(`civilon-marketplace-verify-lookup:v1:${token}`)
    .digest("hex");
}

export function isVerificationToken(value: unknown): value is string {
  return typeof value === "string" && VERIFICATION_TOKEN_PATTERN.test(value);
}

export function secureEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

/**
 * The only origins a verification link may be built against: the approved
 * production host and Netlify preview hosts, always over https. Anything else
 * throws, so a misconfigured deploy fails loudly instead of emailing a customer
 * a link pointing at an attacker-controlled host.
 *
 * `MARKETPLACE_PREVIEW_ORIGIN` is consulted first because Netlify's serverless
 * runtime does not expose the build-only deploy variables: `DEPLOY_PRIME_URL`
 * and `DEPLOY_URL` are read-only *build* variables, and of the read-only set
 * only `URL`, `SITE_NAME` and `SITE_ID` reach a function at request time. `URL`
 * is the production site address even inside a deploy preview, so without an
 * explicit branch-scoped origin a preview would email links that land on
 * production. Setting it is opt-in, branch-scoped, and still subject to the
 * same https + approved-host validation as every other candidate — it widens
 * nothing, it only names the deploy the code cannot otherwise see.
 */
export function marketplaceOrigin(env: Record<string, string | undefined> = process.env) {
  const candidate = env.MARKETPLACE_PREVIEW_ORIGIN
    || env.DEPLOY_PRIME_URL
    || env.URL
    || env.NEXT_PUBLIC_SITE_URL
    || "";
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("MARKETPLACE_ORIGIN_INVALID");
  }
  if (url.protocol !== "https:" || !isApprovedSubmissionHost(url.hostname)) {
    throw new Error("MARKETPLACE_ORIGIN_INVALID");
  }
  return url.origin;
}

/**
 * The credential is placed in the URL fragment, never the query string.
 *
 * A fragment is not transmitted with the request, so the credential cannot land
 * in an access log, a CDN log, a Referer header sent to a third party, or an
 * analytics page-path. The verification page reads it client-side, erases it
 * from history, and posts it only on an explicit customer action.
 */
export function buyRequestVerificationUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}${BUY_REQUEST_VERIFY_PATH}#${BUY_REQUEST_VERIFY_FRAGMENT_KEY}=${encodeURIComponent(token)}`;
}

/**
 * The Sell Submission equivalent, on the Sell verification page and using the
 * same fragment rule for the same reason: a credential in a query string ends
 * up in an access log, a CDN log and a Referer header; a credential in a
 * fragment never leaves the browser.
 */
export function sellSubmissionVerificationUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}${SELL_SUBMISSION_VERIFY_PATH}#${SELL_SUBMISSION_VERIFY_FRAGMENT_KEY}=${encodeURIComponent(token)}`;
}

/**
 * The authenticated staff console, addressed to the exact record.
 *
 * Internal mail carries this link instead of request content, so the
 * notification never becomes a copy of the Buy Request. The internal id is not
 * a credential: the destination sits behind Google OIDC and the staff
 * allowlist, and the id is useless without a session.
 */
export function buyRequestAdminUrl(origin: string, buyRequestId: string) {
  return `${origin.replace(/\/$/, "")}/admin/buy-requests/${encodeURIComponent(buyRequestId)}`;
}

/** The Sell Submission equivalent, on the same record-bound principle. */
export function sellSubmissionAdminUrl(origin: string, sellSubmissionId: string) {
  return `${origin.replace(/\/$/, "")}/admin/sell-submissions/${encodeURIComponent(sellSubmissionId)}`;
}
