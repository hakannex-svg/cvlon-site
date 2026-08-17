import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { isPreviewResultDeliveryWorkerEnabled } from "@/lib/price-check/email/preview-worker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("send_result");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  if (!isPreviewResultDeliveryWorkerEnabled(process.env, new URL(request.url).hostname)) return privateJson({ ok: false, error: "Manual delivery processing is unavailable." }, 404);
  const [{ priceCheckDb }, { processOneResultNotification }] = await Promise.all([import("@/db/price-check"), import("@/lib/price-check/email/worker")]);
  const result = await processOneResultNotification(priceCheckDb);
  return privateJson({ ok: true, status: result.status });
}
