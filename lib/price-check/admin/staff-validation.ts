import { adminRoles, type AdminRole } from "./policy";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const orderedIdPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeStaffEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const displayEmail = value.trim();
  const normalizedEmail = displayEmail.toLowerCase();
  if (!displayEmail || displayEmail.length > 320 || !emailPattern.test(normalizedEmail)) return null;
  return { displayEmail, normalizedEmail };
}

export function parseStaffInvitationInput(value: unknown) {
  const input = record(value);
  if (!input || Object.keys(input).some((key) => key !== "email" && key !== "role")) return null;
  const email = normalizeStaffEmail(input.email);
  const role = typeof input.role === "string" && adminRoles.includes(input.role as AdminRole)
    ? input.role as AdminRole
    : null;
  return email && role ? { ...email, role } : null;
}

export function parseStaffRoleInput(value: unknown) {
  const input = record(value);
  if (!input || Object.keys(input).some((key) => key !== "role")) return null;
  return typeof input.role === "string" && adminRoles.includes(input.role as AdminRole)
    ? input.role as AdminRole
    : null;
}

export function parseStaffActionInput(value: unknown, allowed: readonly string[]) {
  const input = record(value);
  if (!input || Object.keys(input).some((key) => key !== "action")) return null;
  return typeof input.action === "string" && allowed.includes(input.action) ? input.action : null;
}

export function isStaffId(value: string) {
  return orderedIdPattern.test(value);
}
