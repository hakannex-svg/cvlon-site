import "../../../db/price-check/server-boundary.ts";

import {
  accessErrorResponse,
  privateJson,
  requireStaffApi,
  verifyAdminMutationOrigin,
} from "../../price-check/admin/auth";
import { isRecordId } from "./validation.ts";
import { validateAcceptedDealExecution } from "./accepted-deal-validation.ts";

const MAX_BODY_BYTES = 1024;

export function acceptedDealMethodNotAllowed() {
  const response = privateJson({ ok: false, error: "Method not allowed." }, 405);
  const headers = new Headers(response.headers);
  headers.set("Allow", "POST");
  return new Response(response.body, { status: 405, headers });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

export async function POST_startAcceptedDealExecution(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireStaffApi("transition_marketplace");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    verifyAdminMutationOrigin(request);
    const { id } = await context.params;
    if (!isRecordId(id)) return privateJson({ ok: false, error: "This record is not available." }, 404);

    const validation = validateAcceptedDealExecution(await readJsonBody(request));
    if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/accepted-deal-repository"),
    ]);
    const result = await repository.startAcceptedDealExecution(priceCheckDb, {
      buyRequestId: id,
      expectedStatus: validation.data.expectedStatus,
      actorId: access.user.id,
    });

    if (!result.ok && result.reason === "not_found") {
      return privateJson({ ok: false, error: "This record is not available." }, 404);
    }
    if (!result.ok && result.reason === "conflict") {
      return privateJson({
        ok: false,
        error: "This request or its latest offer changed while you were working on it. Reload and try again.",
        currentStatus: result.currentStatus,
      }, 409);
    }
    if (!result.ok && result.reason === "latest_offer_not_accepted") {
      return privateJson({ ok: false, error: "The newest Civilon offer is not accepted." }, 409);
    }
    if (!result.ok) {
      return privateJson({ ok: false, error: "Execution cannot start from this request status." }, 409);
    }

    return privateJson({ ok: true, status: result.data.to, offerVersion: result.data.offerVersion });
  } catch {
    return privateJson({ ok: false, error: "Execution could not be started." }, 400);
  }
}
