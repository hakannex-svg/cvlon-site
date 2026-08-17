import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { parseAnalysisInput } from "@/lib/price-check/admin/analysis-validation";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("analyze");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let input;
  try { input = parseAnalysisInput(await request.json()); }
  catch (error) { return privateJson({ ok: false, error: error instanceof Error ? error.message : "Analysis input is invalid." }, 400); }
  try {
    const { id } = await context.params;
    const [{ priceCheckDb }, { runGovernedAnalysis }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/comparable-repository"),
    ]);
    const result = await runGovernedAnalysis(priceCheckDb, { priceCheckId: id, actor: access.user, ...input });
    return privateJson({ ok: true, version: result.analysis.version, analysisId: result.analysis.id }, 201);
  } catch (error) {
    return privateJson({ ok: false, error: error instanceof Error ? error.message : "Analysis could not be saved." }, 409);
  }
}
