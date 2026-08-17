import { NextResponse } from "next/server";
import { rateLimitKey, consumePriceCheckAttempt } from "@/lib/price-check/rate-limit";
import { RESULT_SESSION_COOKIE, createResultSession, resultTokenKey } from "@/lib/price-check/result-session";

export const runtime = "nodejs";

function unavailable(request: Request) {
  const response = NextResponse.redirect(new URL("/price-check/result?unavailable=1", request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function cleanResultUrl(request: Request) {
  // Netlify preserves the inbound query when a redirect target has no query.
  // A non-sensitive marker replaces the bearer credential; the result page
  // removes the marker from browser history immediately after hydration.
  return new URL("/price-check/result?redeemed=1", request.url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const forwarded = request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rate = consumePriceCheckAttempt(rateLimitKey(`result:${forwarded}:${token.slice(0, 12)}`));
  if (!rate.allowed || !/^[A-Za-z0-9_-]{43}$/.test(token)) return unavailable(request);
  try {
    const key = resultTokenKey();
    const [{ priceCheckDb }, { redeemResultToken }] = await Promise.all([import("@/db/price-check"), import("@/db/price-check/repositories/result-delivery-repository")]);
    const redeemed = await redeemResultToken(priceCheckDb, { token, tokenKey: key });
    if (!redeemed) return unavailable(request);
    const response = NextResponse.redirect(cleanResultUrl(request), 303);
    response.cookies.set(RESULT_SESSION_COOKIE, createResultSession(key, redeemed), { secure: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 60 });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return unavailable(request);
  }
}
