import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { roleCan } from "@/lib/price-check/admin/policy";
import { getOpenAIExtractionConfig } from "@/lib/price-check/extraction/config";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("extract_attachment");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let retry = false;
  try {
    const raw = await request.json() as Record<string, unknown>;
    retry = raw.retry === true;
    if (Object.keys(raw).some((key) => key !== "retry")) throw new Error();
  } catch { return privateJson({ ok: false, error: "The extraction request could not be read." }, 400); }
  if (retry && !roleCan(access.user.role, "retry_extraction")) return privateJson({ ok: false, error: "Access denied." }, 403);
  try {
    const { id, attachmentId } = await context.params;
    const config = getOpenAIExtractionConfig();
    const [{ priceCheckDb }, repository, service] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/extraction-repository"),
      import("@/lib/price-check/extraction/service"),
    ]);
    const queued = await repository.queueAttachmentExtraction(priceCheckDb, {
      priceCheckId: id, attachmentId, actor: access.user, model: config.model,
      schemaVersion: config.schemaVersion, promptVersion: config.promptVersion, retry,
    });
    if (queued.job.state === "succeeded") return privateJson({ ok: true, state: "ready", jobId: queued.job.id });
    if (["failed", "dead_letter"].includes(queued.job.state) && !queued.retried) {
      return privateJson({ ok: true, state: "failed", jobId: queued.job.id, manualReview: true });
    }
    const result = await service.processExtractionJob(priceCheckDb, queued.job.id);
    return privateJson({ ok: true, state: result.state, jobId: queued.job.id, manualReview: result.state === "failed" }, queued.created ? 201 : 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ATTACHMENT_NOT_FOUND") return privateJson({ ok: false, error: "Document was not found." }, 404);
    if (code === "ATTACHMENT_NOT_CLEAN") return privateJson({ ok: false, error: "Only a clean, validated document can be extracted." }, 409);
    if (code === "EXTRACTION_ATTEMPTS_EXHAUSTED") return privateJson({ ok: false, error: "Extraction attempts are exhausted. Review the document manually." }, 409);
    return privateJson({ ok: false, error: "Extraction is unavailable — review the document manually." }, 503);
  }
}

export function GET() { return privateJson({ ok: false, error: "Method not allowed." }, 405); }
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
