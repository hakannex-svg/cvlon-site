import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { draftToHumanExplanation } from "@/lib/price-check/explanation/schema";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string; artifactId: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("draft_ai_explanation");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let analysisId = "";
  try {
    const raw = await request.json() as Record<string, unknown>;
    if (!raw || Array.isArray(raw) || Object.keys(raw).some((key) => key !== "analysisId") || typeof raw.analysisId !== "string") throw new Error();
    analysisId = raw.analysisId;
  } catch { return privateJson({ ok: false, error: "The draft selection could not be read." }, 400); }
  try {
    const { id, artifactId } = await context.params;
    const [{ priceCheckDb }, { applyExplanationDraft }] = await Promise.all([import("@/db/price-check"), import("@/db/price-check/repositories/explanation-repository")]);
    const result = await applyExplanationDraft(priceCheckDb, { priceCheckId: id, analysisId, artifactId, actor: access.user });
    return privateJson({ ok: true, artifactId: result.artifactId, explanation: draftToHumanExplanation(result.draft) });
  } catch { return privateJson({ ok: false, error: "This AI draft is stale or unavailable. Refresh and write the explanation manually." }, 409); }
}

export function GET() { return privateJson({ ok: false, error: "Method not allowed." }, 405); }
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
