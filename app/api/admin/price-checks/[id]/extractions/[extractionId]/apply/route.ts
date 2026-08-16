import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string; extractionId: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("apply_extraction");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let raw: Record<string, unknown>;
  try {
    raw = await request.json() as Record<string, unknown>;
    if (!raw || Array.isArray(raw) || Object.keys(raw).some((key) => !["lineItemIndex", "acceptedFields", "changeReason"].includes(key))) throw new Error();
  } catch { return privateJson({ ok: false, error: "The confirmation could not be read." }, 400); }
  if (!Number.isInteger(raw.lineItemIndex) || !Array.isArray(raw.acceptedFields) || raw.acceptedFields.some((field) => typeof field !== "string") || typeof raw.changeReason !== "string") {
    return privateJson({ ok: false, error: "Choose the fields to confirm and provide a change reason." }, 400);
  }
  try {
    const { id, extractionId } = await context.params;
    const [{ priceCheckDb }, { applyConfirmedExtraction }] = await Promise.all([
      import("@/db/price-check"), import("@/db/price-check/repositories/extraction-repository"),
    ]);
    const result = await applyConfirmedExtraction(priceCheckDb, {
      priceCheckId: id, extractionId, lineItemIndex: raw.lineItemIndex as number,
      acceptedFields: raw.acceptedFields as string[], changeReason: raw.changeReason, actor: access.user,
    });
    return privateJson({ ok: true, version: result.version, acceptanceState: result.acceptanceState }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "EXTRACTION_NOT_READY") return privateJson({ ok: false, error: "The extraction is not ready for review." }, 409);
    return privateJson({ ok: false, error: "Confirmed document details could not be applied." }, 409);
  }
}

export function GET() { return privateJson({ ok: false, error: "Method not allowed." }, 405); }
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
