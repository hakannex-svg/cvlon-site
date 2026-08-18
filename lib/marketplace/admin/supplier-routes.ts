import "../../../db/price-check/server-boundary.ts";

import {
  accessErrorResponse,
  privateJson,
  requireStaffApi,
  verifyAdminMutationOrigin,
} from "../../price-check/admin/auth";
import { isRecordId } from "./validation.ts";
import {
  validateSupplierResponse,
  validateSupplierResponseStatus,
} from "./supplier-validation.ts";

/**
 * The two internal supplier-response mutations.
 *
 * Both are staff-only, origin-checked, parent-bound, POST-only and private.
 * Neither has a buyer-facing counterpart: there is no public endpoint through
 * which any of this reaches a buyer, and none of these handlers touches the
 * Buy Request, `buyer_offers`, or the notification outbox.
 */

const MAX_BODY_BYTES = 16 * 1024;

export function supplierMethodNotAllowed() {
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

export async function POST_supplierResponse(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireStaffApi("record_supplier_response");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    verifyAdminMutationOrigin(request);
    const { id } = await context.params;
    if (!isRecordId(id)) return privateJson({ ok: false, error: "This record is not available." }, 404);

    const validation = validateSupplierResponse(await readJsonBody(request));
    if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/supplier-response-repository"),
    ]);
    const result = await repository.recordSupplierResponse(priceCheckDb, {
      buyRequestId: id,
      response: validation.data,
      actor: { id: access.user.id, role: access.user.role },
    });

    if (!result.ok && result.reason === "not_found") {
      return privateJson({ ok: false, error: "This record is not available." }, 404);
    }
    if (!result.ok && result.reason === "contact_unavailable") {
      return privateJson({ ok: false, error: "That registered contact cannot be used as a supplier." }, 400);
    }
    if (!result.ok) return privateJson({ ok: false, error: "The supplier response could not be saved." }, 400);

    // The id only. The response body never echoes supplier identity or cost.
    return privateJson({ ok: true, supplierResponseId: result.data.supplierResponseId }, 201);
  } catch {
    return privateJson({ ok: false, error: "The supplier response could not be saved." }, 400);
  }
}

export async function POST_supplierResponseStatus(
  request: Request,
  context: { params: Promise<{ id: string; responseId: string }> },
) {
  const access = await requireStaffApi("record_supplier_response");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    verifyAdminMutationOrigin(request);
    const { id, responseId } = await context.params;
    if (!isRecordId(id) || !isRecordId(responseId)) {
      return privateJson({ ok: false, error: "This record is not available." }, 404);
    }

    const validation = validateSupplierResponseStatus(await readJsonBody(request));
    if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/supplier-response-repository"),
    ]);
    const result = await repository.changeSupplierResponseStatus(priceCheckDb, {
      buyRequestId: id,
      supplierResponseId: responseId,
      expectedStatus: validation.data.expectedStatus,
      to: validation.data.to,
      actor: { id: access.user.id, role: access.user.role },
    });

    if (!result.ok && result.reason === "not_found") {
      return privateJson({ ok: false, error: "This record is not available." }, 404);
    }
    if (!result.ok && result.reason === "conflict") {
      return privateJson({
        ok: false,
        error: "This response changed while you were working on it. Reload and try again.",
        currentStatus: result.currentStatus,
      }, 409);
    }
    if (!result.ok) return privateJson({ ok: false, error: "That status change is not permitted." }, 409);

    return privateJson({ ok: true, status: result.data.to });
  } catch {
    return privateJson({ ok: false, error: "The status could not be changed." }, 400);
  }
}
