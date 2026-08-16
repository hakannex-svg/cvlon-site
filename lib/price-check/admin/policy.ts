export const adminRoles = ["ANALYST", "REVIEWER", "ADMIN", "AUDITOR"] as const;
export type AdminRole = (typeof adminRoles)[number];

export type AdminCapability =
  | "view"
  | "self_assign"
  | "assign_any"
  | "revise"
  | "request_information"
  | "transition"
  | "exceptional_transition"
  | "manage_staff";

const capabilities: Record<AdminRole, readonly AdminCapability[]> = {
  ANALYST: ["view", "self_assign", "revise", "request_information", "transition"],
  REVIEWER: ["view", "self_assign", "revise", "request_information", "transition"],
  ADMIN: [
    "view",
    "self_assign",
    "assign_any",
    "revise",
    "request_information",
    "transition",
    "exceptional_transition",
    "manage_staff",
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
    return ["needs_information", "ready_for_analysis", "processing_failed", "spam", "withdrawn", "closed"] as const;
  }
  return ["needs_information", "ready_for_analysis", "withdrawn"] as const;
}
