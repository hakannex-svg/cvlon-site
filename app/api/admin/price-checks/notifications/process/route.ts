import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("send_result");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  if (!(process.env.CONTEXT === "deploy-preview" && process.env.BRANCH === "codex/civilon-price-check-phase-6" && process.env.PRICE_CHECK_PHASE6_PREVIEW_WORKER_ENABLED === "true")) return privateJson({ ok: false, error: "Manual delivery processing is unavailable." }, 404);
  const [{ priceCheckDb }, { processOneResultNotification }] = await Promise.all([import("@/db/price-check"), import("@/lib/price-check/email/worker")]);
  const result = await processOneResultNotification(priceCheckDb);
  return privateJson({ ok: true, status: result.status });
}
