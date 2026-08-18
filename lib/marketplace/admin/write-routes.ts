import "../../../db/price-check/server-boundary.ts";

import {
  accessErrorResponse,
  privateJson,
  requireStaffApi,
  verifyAdminMutationOrigin,
} from "../../price-check/admin/auth";
import { roleCan as typedRoleCan } from "../../price-check/admin/policy";
import {
  marketplaceTransitionCapability,
  type MarketplaceAggregate,
} from "../../../db/price-check/domain/marketplace-status-policy.ts";
import {
  isRecordId,
  validateInternalReview,
  validateMarketplaceAssignment,
  validateMarketplaceNote,
  validateMarketplaceStatusChange,
  validateSellEvidenceRequest,
} from "./validation.ts";

/**
 * The shared shape of the six marketplace admin mutations.
 *
 * One implementation rather than six copies, so the origin check, the capability
 * gate, the strict validation, the private headers and the method allowlist
 * cannot drift apart between Buy and Sell. Each route file supplies only its
 * aggregate.
 *
 * Deliberately free of every public product flag: staff must be able to work
 * the records while public intake is closed.
 */

const MAX_BODY_BYTES = 8 * 1024;

/**
 * The domain policy is typed against plain strings so it stays free of the
 * admin auth layer. This is the single adaptation point between the two.
 */
const roleCan = (role: string, capability: string) =>
  typedRoleCan(role as Parameters<typeof typedRoleCan>[0], capability as Parameters<typeof typedRoleCan>[1]);

/** 405 with the method allowlist the route actually implements. */
export function methodNotAllowed() {
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

type Context = { params: Promise<{ id: string }> };
type AttachmentContext = { params: Promise<{ id: string; attachmentId: string }> };

/**
 * Status change. The capability depends on the target: an ordinary move needs
 * `transition_marketplace`, while `spam`, `closed` and the manual verification
 * override need `exceptional_marketplace_transition`. The base capability is
 * checked first so an unauthorised caller never learns the record's status.
 */
export function createStatusRoute(aggregate: MarketplaceAggregate) {
  return async function POST(request: Request, context: Context) {
    const access = await requireStaffApi("transition_marketplace");
    if (access.status !== "authorized") return accessErrorResponse(access.status);
    try {
      verifyAdminMutationOrigin(request);
      const { id } = await context.params;
      if (!isRecordId(id)) return privateJson({ ok: false, error: "This record is not available." }, 404);

      const validation = validateMarketplaceStatusChange(aggregate, await readJsonBody(request));
      if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

      // Exceptional targets are refused before the record is read at all.
      const capability = marketplaceTransitionCapability(aggregate, validation.data.expectedStatus, validation.data.to);
      if (!capability) return privateJson({ ok: false, error: "That status change is not permitted." }, 409);
      if (!roleCan(access.user.role, capability)) return accessErrorResponse("forbidden");

      const [{ priceCheckDb }, repository] = await Promise.all([
        import("@/db/price-check"),
        import("@/db/price-check/repositories/marketplace-write-repository"),
      ]);
      const result = await repository.changeMarketplaceStatus(priceCheckDb, {
        aggregate,
        id,
        expectedStatus: validation.data.expectedStatus,
        to: validation.data.to,
        actor: { id: access.user.id, role: access.user.role },
        roleCan,
      });

      if (!result.ok && result.reason === "not_found") {
        return privateJson({ ok: false, error: "This record is not available." }, 404);
      }
      if (!result.ok && result.reason === "conflict") {
        return privateJson({
          ok: false,
          error: "This record changed while you were working on it. Reload and try again.",
          currentStatus: result.currentStatus,
        }, 409);
      }
      if (!result.ok) return privateJson({ ok: false, error: "That status change is not permitted." }, 409);

      return privateJson({ ok: true, status: result.data.to });
    } catch {
      return privateJson({ ok: false, error: "The status could not be changed." }, 400);
    }
  };
}

export function createAssignmentRoute(aggregate: MarketplaceAggregate) {
  return async function POST(request: Request, context: Context) {
    const access = await requireStaffApi("assign_marketplace");
    if (access.status !== "authorized") return accessErrorResponse(access.status);
    try {
      verifyAdminMutationOrigin(request);
      const { id } = await context.params;
      if (!isRecordId(id)) return privateJson({ ok: false, error: "This record is not available." }, 404);

      const validation = validateMarketplaceAssignment(await readJsonBody(request));
      if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

      const [{ priceCheckDb }, repository] = await Promise.all([
        import("@/db/price-check"),
        import("@/db/price-check/repositories/marketplace-write-repository"),
      ]);
      const result = await repository.assignMarketplaceRecord(priceCheckDb, {
        aggregate,
        id,
        assigneeId: validation.data.assigneeId,
        actor: { id: access.user.id, role: access.user.role },
      });

      if (!result.ok && result.reason === "not_found") {
        return privateJson({ ok: false, error: "This record is not available." }, 404);
      }
      if (!result.ok && result.reason === "assignee_unavailable") {
        return privateJson({ ok: false, error: "That staff member is not available." }, 400);
      }
      if (!result.ok) return privateJson({ ok: false, error: "The assignment could not be saved." }, 400);

      return privateJson({ ok: true, assigneeId: result.data.assigneeId });
    } catch {
      return privateJson({ ok: false, error: "The assignment could not be saved." }, 400);
    }
  };
}

export function createNoteRoute(aggregate: MarketplaceAggregate) {
  return async function POST(request: Request, context: Context) {
    const access = await requireStaffApi("write_marketplace_note");
    if (access.status !== "authorized") return accessErrorResponse(access.status);
    try {
      verifyAdminMutationOrigin(request);
      const { id } = await context.params;
      if (!isRecordId(id)) return privateJson({ ok: false, error: "This record is not available." }, 404);

      const validation = validateMarketplaceNote(await readJsonBody(request));
      if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

      const [{ priceCheckDb }, repository] = await Promise.all([
        import("@/db/price-check"),
        import("@/db/price-check/repositories/marketplace-write-repository"),
      ]);
      const result = await repository.addMarketplaceNote(priceCheckDb, {
        aggregate,
        id,
        body: validation.data.body,
        actor: { id: access.user.id, role: access.user.role },
      });

      if (!result.ok && result.reason === "not_found") {
        return privateJson({ ok: false, error: "This record is not available." }, 404);
      }
      if (!result.ok) return privateJson({ ok: false, error: "The note could not be saved." }, 400);

      // The note id is enough for the client to know it landed; the text is
      // already on the page and is never echoed back through this boundary.
      return privateJson({ ok: true, noteId: result.data.noteId }, 201);
    } catch {
      return privateJson({ ok: false, error: "The note could not be saved." }, 400);
    }
  };
}

/** Internal business review; intentionally independent of e-mail verification. */
export function createBusinessReviewRoute(aggregate: MarketplaceAggregate) {
  return async function POST(request: Request, context: Context) {
    const access = await requireStaffApi("review_marketplace");
    if (access.status !== "authorized") return accessErrorResponse(access.status);
    try {
      verifyAdminMutationOrigin(request);
      const { id } = await context.params;
      if (!isRecordId(id)) return privateJson({ ok: false, error: "This record is not available." }, 404);

      const validation = validateInternalReview(await readJsonBody(request));
      if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

      const [{ priceCheckDb }, repository] = await Promise.all([
        import("@/db/price-check"),
        import("@/db/price-check/repositories/marketplace-write-repository"),
      ]);
      const result = await repository.setContactBusinessReview(priceCheckDb, {
        aggregate,
        id,
        state: validation.data.state,
        actor: { id: access.user.id, role: access.user.role },
      });

      if (!result.ok && result.reason === "not_found") {
        return privateJson({ ok: false, error: "This record is not available." }, 404);
      }
      if (!result.ok && result.reason === "conflict") {
        return privateJson({ ok: false, error: "This review changed while you were working on it. Reload and try again." }, 409);
      }
      if (!result.ok) return privateJson({ ok: false, error: "The business review could not be saved." }, 400);

      return privateJson({ ok: true, reviewState: result.data.to });
    } catch {
      return privateJson({ ok: false, error: "The business review could not be saved." }, 400);
    }
  };
}

/**
 * Asks the seller for follow-up evidence on one Sell Submission.
 *
 * The one mutation here that causes Civilon to contact a customer, so three
 * things are true of it that are not true of the others:
 *
 *  - The secure credential and its URL are minted below this boundary and are
 *    never in the response. A staff browser has no use for the link, and a
 *    response carrying one would put it in a console log, a screenshot, and a
 *    support ticket. Staff learn that a request was recorded, and its expiry.
 *  - The e-mail is queued in the same transaction as the request row and its
 *    audit event, so a seller can never hold a link to a request that was not
 *    recorded, and a recorded request is never silently unqueued. Queued is all
 *    this response can honestly claim: delivery is the outbox's business, and
 *    the detail page reports it from the outbox row rather than from here.
 *  - The seller contact must be verified and the record must not be terminal.
 *    Both are decided against the stored record inside the transaction, not
 *    from anything the browser sent.
 */
export function createEvidenceRequestRoute() {
  return async function POST(request: Request, context: Context) {
    const access = await requireStaffApi("request_marketplace_evidence");
    if (access.status !== "authorized") return accessErrorResponse(access.status);
    try {
      verifyAdminMutationOrigin(request);
      const { id } = await context.params;
      if (!isRecordId(id)) return privateJson({ ok: false, error: "This record is not available." }, 404);

      const validation = validateSellEvidenceRequest(await readJsonBody(request));
      if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

      const [{ priceCheckDb }, service] = await Promise.all([
        import("@/db/price-check"),
        import("@/lib/marketplace/sell-evidence-request-service"),
      ]);
      const result = await service.requestSellEvidence(priceCheckDb, {
        sellSubmissionId: id,
        categories: validation.data.categories,
        actor: { id: access.user.id },
      });

      if (!result.ok && result.reason === "not_found") {
        return privateJson({ ok: false, error: "This record is not available." }, 404);
      }
      if (!result.ok && result.reason === "terminal_record") {
        return privateJson({
          ok: false,
          error: "This submission is closed, so Civilon cannot ask the seller for more evidence.",
        }, 409);
      }
      if (!result.ok) {
        return privateJson({
          ok: false,
          error: "This seller has not confirmed their email address, so there is no address to send a request to.",
        }, 409);
      }

      // Categories, expiry, and the one delivery fact this boundary knows: the
      // message is queued, not sent. No credential, no URL, no recipient.
      return privateJson({
        ok: true,
        delivery: "queued",
        categories: result.data.categories,
        expiresAt: result.data.expiresAt.toISOString(),
      }, 201);
    } catch {
      return privateJson({ ok: false, error: "The evidence request could not be recorded." }, 400);
    }
  };
}

/** Internal review of one live attachment bound to the named Sell Submission. */
export function createAttachmentReviewRoute() {
  return async function POST(request: Request, context: AttachmentContext) {
    const access = await requireStaffApi("review_marketplace");
    if (access.status !== "authorized") return accessErrorResponse(access.status);
    try {
      verifyAdminMutationOrigin(request);
      const { id, attachmentId } = await context.params;
      if (!isRecordId(id) || !isRecordId(attachmentId)) {
        return privateJson({ ok: false, error: "This evidence is not available." }, 404);
      }

      const validation = validateInternalReview(await readJsonBody(request));
      if (!validation.ok) return privateJson({ ok: false, error: validation.error }, 400);

      const [{ priceCheckDb }, repository] = await Promise.all([
        import("@/db/price-check"),
        import("@/db/price-check/repositories/marketplace-write-repository"),
      ]);
      const result = await repository.setAttachmentReview(priceCheckDb, {
        sellSubmissionId: id,
        attachmentId,
        state: validation.data.state,
        actor: { id: access.user.id, role: access.user.role },
      });

      if (!result.ok && result.reason === "not_found") {
        return privateJson({ ok: false, error: "This evidence is not available." }, 404);
      }
      if (!result.ok && result.reason === "conflict") {
        return privateJson({ ok: false, error: "This review changed while you were working on it. Reload and try again." }, 409);
      }
      if (!result.ok) return privateJson({ ok: false, error: "The evidence review could not be saved." }, 400);

      return privateJson({ ok: true, reviewState: result.data.to });
    } catch {
      return privateJson({ ok: false, error: "The evidence review could not be saved." }, 400);
    }
  };
}
