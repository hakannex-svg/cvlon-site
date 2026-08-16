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
  | "approve_result"
  | "send_result"
  | "exceptional_transition"
  | "manage_staff"
  | "download_attachment"
  | "reconcile_attachment";

const capabilities: Record<AdminRole, readonly AdminCapability[]> = {
  ANALYST: ["view", "self_assign", "revise", "request_information", "transition", "analyze", "create_observation", "draft_result", "download_attachment"],
  REVIEWER: ["view", "self_assign", "revise", "request_information", "transition", "analyze", "create_observation", "draft_result", "approve_result", "send_result", "download_attachment"],
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
    "approve_result",
    "send_result",
    "exceptional_transition",
    "manage_staff",
    "download_attachment",
    "reconcile_attachment",
  ],
  AUDITOR: ["view"],
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
