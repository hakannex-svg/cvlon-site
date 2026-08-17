import { cookies } from "next/headers";
import { privateJson } from "@/lib/price-check/admin/auth";
import { RESULT_SESSION_COOKIE, resultTokenKey, verifyResultSession } from "@/lib/price-check/result-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return privateJson({ ok: false }, 403);
  try {
    const session = verifyResultSession(resultTokenKey(), (await cookies()).get(RESULT_SESSION_COOKIE)?.value);
    if (!session) return privateJson({ ok: false }, 401);
    const [{ priceCheckDb }, { createResultSourcingOpportunity }] = await Promise.all([import("@/db/price-check"), import("@/db/price-check/repositories/result-delivery-repository")]);
    const result = await createResultSourcingOpportunity(priceCheckDb, session);
    return privateJson({ ok: true, created: result.created });
  } catch {
    return privateJson({ ok: false }, 409);
  }
}
