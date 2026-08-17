import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { getOpenAIExplanationConfig } from "@/lib/price-check/explanation/config";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("draft_ai_explanation");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let raw: Record<string, unknown>;
  try {
    raw = await request.json() as Record<string, unknown>;
    if (!raw || Array.isArray(raw) || Object.keys(raw).some((key) => !["analysisId", "regenerate"].includes(key))) throw new Error();
  } catch { return privateJson({ ok: false, error: "The explanation request could not be read." }, 400); }
  if (typeof raw.analysisId !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(raw.analysisId) || typeof raw.regenerate !== "boolean") {
    return privateJson({ ok: false, error: "The analysis reference is invalid." }, 400);
  }
  try {
    const { id } = await context.params;
    const config = getOpenAIExplanationConfig();
    const [{ priceCheckDb }, repository, service] = await Promise.all([
      import("@/db/price-check"), import("@/db/price-check/repositories/explanation-repository"), import("@/lib/price-check/explanation/service"),
    ]);
    const queued = await repository.queueExplanationDraft(priceCheckDb, { priceCheckId: id, analysisId: raw.analysisId, actor: access.user, config, regenerate: raw.regenerate });
    if (queued.state === "ready") return privateJson({ ok: true, state: "ready", artifactId: queued.artifact?.id });
    if (!queued.created && queued.state === "running") return privateJson({ ok: true, state: "generating", jobId: queued.job?.id });
    const result = await service.processExplanationJob(priceCheckDb, { jobId: queued.job!.id, config });
    if (result.state === "succeeded") return privateJson({ ok: true, state: "ready", artifactId: result.artifactId }, 201);
    return privateJson({ ok: false, state: "failed", error: result.state === "rejected" ? "The generated draft did not pass Civilon's explanation policy." : "AI drafting is unavailable. Continue with the human explanation editor." }, 503);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "EXPLANATION_ATTEMPTS_EXHAUSTED") return privateJson({ ok: false, error: "The AI drafting attempt limit has been reached. Continue with the human editor." }, 409);
    if (code.includes("NOT_CURRENT") || code.includes("STALE")) return privateJson({ ok: false, error: "The analysis changed. Refresh before requesting another draft." }, 409);
    return privateJson({ ok: false, error: "AI drafting is unavailable. Continue with the human explanation editor." }, 503);
  }
}

export function GET() { return privateJson({ ok: false, error: "Method not allowed." }, 405); }
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
