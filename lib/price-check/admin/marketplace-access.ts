import "@/db/price-check/server-boundary";

import { redirect } from "next/navigation";

import { getAdminAccess, type PriceCheckAdmin } from "./auth";
import { roleCan, type AdminCapability, type AdminRole } from "./policy";
import {
  allowedMarketplaceTransitions,
  type MarketplaceAggregate,
} from "@/db/price-check/domain/marketplace-status-policy";

/**
 * Page guard for the marketplace staff surfaces.
 *
 * Product-flag independent by design: Civilon may close all public intake while
 * staff still need the records, so this reads `getAdminAccess()` and never a
 * public marketplace, Sell or Price Check flag. Authorization is the ordinary
 * capability check, so an AUDITOR reads and no one else is widened.
 *
 * Returns `null` when the console is temporarily unavailable, which the caller
 * renders as the generic unavailable card. Unauthenticated and unauthorized
 * staff are redirected before this returns.
 */
export async function requireMarketplacePageAccess(): Promise<PriceCheckAdmin | null> {
  const access = await getAdminAccess();
  if (access.status === "unauthenticated") redirect("/admin/login");
  if (access.status === "forbidden") redirect("/admin/access-denied");
  if (access.status !== "authorized") return null;
  if (!roleCan(access.user.role, "view_marketplace")) redirect("/admin/access-denied");
  return access.user;
}

/**
 * Everything a detail page needs to render its action controls: the transitions
 * this staff member may actually choose from the record's current status, the
 * active staff list for assignment, and the capability flags.
 *
 * The status options are computed server side from the policy graph and the
 * caller's role. The client never receives a target it is not allowed to pick,
 * and the route re-checks the same policy anyway.
 */
export type MarketplaceActionContext = {
  statusOptions: readonly string[];
  staff: readonly { id: string; displayEmail: string }[];
  canTransition: boolean;
  canAssign: boolean;
  canWriteNote: boolean;
  canReview: boolean;
  /** Ordinary marketplace work: asks a seller for files Civilon does not have. */
  canRequestEvidence: boolean;
};

export function buildMarketplaceActionContext(input: {
  aggregate: MarketplaceAggregate;
  currentStatus: string;
  role: string;
  staff: readonly { id: string; displayEmail: string }[];
}): MarketplaceActionContext {
  const can = (role: string, capability: string) =>
    roleCan(role as AdminRole, capability as AdminCapability);
  return {
    statusOptions: allowedMarketplaceTransitions(input.aggregate, input.currentStatus, input.role, can),
    staff: input.staff,
    canTransition: can(input.role, "transition_marketplace"),
    canAssign: can(input.role, "assign_marketplace"),
    canWriteNote: can(input.role, "write_marketplace_note"),
    canReview: can(input.role, "review_marketplace"),
    canRequestEvidence: can(input.role, "request_marketplace_evidence"),
  };
}
