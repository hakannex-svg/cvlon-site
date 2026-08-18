import "../../../db/price-check/server-boundary.ts";

import {
  accessErrorResponse,
  privateJson,
  requireStaffApi,
  verifyAdminMutationOrigin,
} from "../../price-check/admin/auth";
import { isRecordId } from "./validation.ts";
import {
  validateBuyerOffer,
  validateBuyerOfferDelivery,
  validateBuyerOfferStatus,
} from "./buyer-offer-validation.ts";

/**
 * Buyer-offer mutations.
 *
 * `manage_buyer_offer` is REVIEWER and ADMIN only under the current policy
 * matrix: setting Civilon's sale price to a customer is the commercial
 * equivalent of approving and sending a Price Check result, which ANALYST also
 * cannot do.
 *
 * Sending is a dedicated mutation that atomically queues Civilon's customer
 * email. The generic status route cannot claim a send or a buyer response.
 */

const MAX_BODY_BYTES = 16 * 1024;

export function buyerOfferMethodNotAllowed() {
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

export async function POST_buyerOffer(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireStaffApi("manage_buyer_offer");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    verifyAdminMutationOrigin(request);
    const { id } = await context.params;
    if (!isRecordId(id)) return privateJson({ ok: false, error: "This record is not available." }, 404);

    const validation = validateBuyerOffer(await readJsonBody(request));
    if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/buyer-offer-repository"),
    ]);
    const result = await repository.createBuyerOffer(priceCheckDb, {
      buyRequestId: id,
      offer: validation.data,
      actor: { id: access.user.id, role: access.user.role },
    });

    if (!result.ok && result.reason === "not_found") {
      return privateJson({ ok: false, error: "This record is not available." }, 404);
    }
    if (!result.ok && result.reason === "supplier_response_unavailable") {
      return privateJson({ ok: false, error: "That supplier response does not belong to this request." }, 400);
    }
    if (!result.ok) return privateJson({ ok: false, error: "The offer could not be saved." }, 400);

    // The id and version only. No price, no supplier pointer, echoed back.
    return privateJson({ ok: true, buyerOfferId: result.data.buyerOfferId, version: result.data.version }, 201);
  } catch {
    return privateJson({ ok: false, error: "The offer could not be saved." }, 400);
  }
}

export async function POST_buyerOfferStatus(
  request: Request,
  context: { params: Promise<{ id: string; offerId: string }> },
) {
  const access = await requireStaffApi("manage_buyer_offer");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    verifyAdminMutationOrigin(request);
    const { id, offerId } = await context.params;
    if (!isRecordId(id) || !isRecordId(offerId)) {
      return privateJson({ ok: false, error: "This record is not available." }, 404);
    }

    const validation = validateBuyerOfferStatus(await readJsonBody(request));
    if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);
    if (
      validation.data.expectedStatus !== "sent"
      || !(validation.data.to === "expired" || validation.data.to === "withdrawn")
    ) {
      return privateJson({
        ok: false,
        error: "Use Send Civilon Offer for delivery. Buyer acceptance or decline can only come from the buyer's secure link.",
      }, 409);
    }

    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/buyer-offer-repository"),
    ]);
    const result = await repository.changeBuyerOfferStatus(priceCheckDb, {
      buyRequestId: id,
      buyerOfferId: offerId,
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
        error: "This offer changed while you were working on it. Reload and try again.",
        currentStatus: result.currentStatus,
      }, 409);
    }
    if (!result.ok) return privateJson({ ok: false, error: "That status change is not permitted." }, 409);

    return privateJson({ ok: true, status: result.data.to });
  } catch {
    return privateJson({ ok: false, error: "The status could not be changed." }, 400);
  }
}

export async function POST_buyerOfferDelivery(
  request: Request,
  context: { params: Promise<{ id: string; offerId: string }> },
) {
  const access = await requireStaffApi("manage_buyer_offer");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    verifyAdminMutationOrigin(request);
    const { id, offerId } = await context.params;
    if (!isRecordId(id) || !isRecordId(offerId)) {
      return privateJson({ ok: false, error: "This record is not available." }, 404);
    }
    const validation = validateBuyerOfferDelivery(await readJsonBody(request));
    if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

    // Validate the configured signing key before committing an outbox message
    // whose secure response URL could never be produced.
    const [{ priceCheckDb }, repository, { marketplaceVerifyTokenKey }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/buyer-offer-repository"),
      import("@/lib/marketplace/verification"),
    ]);
    marketplaceVerifyTokenKey();
    const result = await repository.queueBuyerOfferDelivery(priceCheckDb, {
      buyRequestId: id,
      buyerOfferId: offerId,
      expectedStatus: validation.data.expectedStatus,
      actor: { id: access.user.id, role: access.user.role },
    });
    if (!result.ok && result.reason === "not_found") {
      return privateJson({ ok: false, error: "This record is not available." }, 404);
    }
    if (!result.ok && result.reason === "buyer_unverified") {
      return privateJson({ ok: false, error: "Confirm the buyer's email address before sending an offer." }, 409);
    }
    if (!result.ok && result.reason === "expiry_required") {
      return privateJson({ ok: false, error: "Add a future expiry date before sending this offer." }, 409);
    }
    if (!result.ok && result.reason === "expiry_in_past") {
      return privateJson({ ok: false, error: "Update the expiry date before sending this offer." }, 409);
    }
    if (!result.ok && result.reason === "conflict") {
      return privateJson({
        ok: false,
        error: "This offer changed while you were working on it. Reload and try again.",
        currentStatus: result.currentStatus,
      }, 409);
    }
    if (!result.ok) return privateJson({ ok: false, error: "The offer could not be queued." }, 409);
    return privateJson({ ok: true, status: "sent", version: result.data.version });
  } catch {
    return privateJson({ ok: false, error: "The offer could not be queued for delivery." }, 400);
  }
}
