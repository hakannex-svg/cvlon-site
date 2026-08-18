export const adminRoles = ["ANALYST", "REVIEWER", "ADMIN", "AUDITOR"] as const;
export type AdminRole = (typeof adminRoles)[number];

export type AdminCapability =
  | "view"
  | "self_assign"
  | "assign_any"
  | "revise"
  | "request_information"
  | "transition"
  | "analyze"
  | "create_observation"
  | "manage_relationships"
  | "draft_result"
  | "draft_ai_explanation"
  | "approve_result"
  | "send_result"
  | "exceptional_transition"
  | "manage_staff"
  | "download_attachment"
  | "reconcile_attachment"
  | "extract_attachment"
  | "retry_extraction"
  | "apply_extraction"
  // Civilon marketplace (Buy Request / Sell Submission) staff capabilities. Kept
  // separate from the Price Check capabilities above so a role can be granted
  // marketplace work without inheriting Price Check authority, and vice versa.
  | "view_marketplace"
  | "assign_marketplace"
  | "transition_marketplace"
  | "write_marketplace_note"
  | "download_marketplace_evidence"
  // Internal business/evidence review. A staff working status only — never a
  // certification, approval, or any customer-facing signal.
  | "review_marketplace"
  | "record_supplier_response"
  | "manage_buyer_offer"
  | "exceptional_marketplace_transition"
  // Preview-only operational control. Drains the marketplace half of the shared
  // notification outbox by hand so Buy/Sell email can be proven on a controlled
  // Netlify preview, where the production schedule deliberately never runs.
  | "process_marketplace_notifications";

/**
 * Marketplace capabilities held above ordinary staff, and why:
 *
 * - `manage_buyer_offer` sets Civilon's own sale price to a buyer. It is the
 *   commercial equivalent of `approve_result`/`send_result`, which ANALYST also
 *   lacks, so ANALYST does not get it; REVIEWER and ADMIN do.
 * - `exceptional_marketplace_transition` covers `spam`, `closed`, and any manual
 *   override of email verification. It mirrors `exceptional_transition` and is
 *   ADMIN-only for the same reason: those transitions are terminal, or they
 *   bypass a customer-driven control.
 * - `process_marketplace_notifications` sends real customer and internal mail on
 *   demand. It exists only so a controlled preview can prove the Buy/Sell email
 *   path, and it is ADMIN-only because nobody else should be able to make the
 *   system e-mail people at a time of their choosing.
 *
 * Everything else needed for ordinary marketplace work (view, assign, transition,
 * note, evidence download, supplier response capture) is granted to ANALYST and
 * REVIEWER. AUDITOR gets `view_marketplace` and nothing else, matching its
 * Price Check posture of `["view"]`.
 */
export const marketplaceCapabilities = [
  "view_marketplace",
  "assign_marketplace",
  "transition_marketplace",
  "write_marketplace_note",
  "download_marketplace_evidence",
  "review_marketplace",
  "record_supplier_response",
  "manage_buyer_offer",
  "exceptional_marketplace_transition",
  "process_marketplace_notifications",
] as const satisfies readonly AdminCapability[];

const capabilities: Record<AdminRole, readonly AdminCapability[]> = {
  ANALYST: ["view", "self_assign", "revise", "request_information", "transition", "analyze", "create_observation", "draft_result", "draft_ai_explanation", "download_attachment", "extract_attachment", "apply_extraction",
    "view_marketplace", "assign_marketplace", "transition_marketplace", "write_marketplace_note", "download_marketplace_evidence", "review_marketplace", "record_supplier_response"],
  REVIEWER: ["view", "self_assign", "revise", "request_information", "transition", "analyze", "create_observation", "draft_result", "draft_ai_explanation", "approve_result", "send_result", "download_attachment", "extract_attachment", "apply_extraction",
    "view_marketplace", "assign_marketplace", "transition_marketplace", "write_marketplace_note", "download_marketplace_evidence", "review_marketplace", "record_supplier_response", "manage_buyer_offer"],
  ADMIN: [
    "view",
    "self_assign",
    "assign_any",
    "revise",
    "request_information",
    "transition",
    "analyze",
    "create_observation",
    "manage_relationships",
    "draft_result",
    "draft_ai_explanation",
    "approve_result",
    "send_result",
    "exceptional_transition",
    "manage_staff",
    "download_attachment",
    "reconcile_attachment",
    "extract_attachment",
    "retry_extraction",
    "apply_extraction",
    "view_marketplace",
    "assign_marketplace",
    "transition_marketplace",
    "write_marketplace_note",
    "download_marketplace_evidence",
    "review_marketplace",
    "record_supplier_response",
    "manage_buyer_offer",
    "exceptional_marketplace_transition",
    "process_marketplace_notifications",
  ],
  AUDITOR: ["view", "view_marketplace"],
};

export function roleCan(role: AdminRole, capability: AdminCapability) {
  return capabilities[role].includes(capability);
}

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && adminRoles.includes(value as AdminRole);
}

export function allowedOperationalStatuses(role: AdminRole) {
  if (role === "AUDITOR") return [];
  if (role === "ADMIN") {
    return ["needs_information", "ready_for_analysis", "analysis_ready", "processing_failed", "spam", "withdrawn", "closed"] as const;
  }
  return ["needs_information", "ready_for_analysis", "analysis_ready", "withdrawn"] as const;
}
