import {
  canStartAcceptedDealExecution,
  type AcceptedDealExecutionSourceStatus,
} from "../../../db/price-check/domain/accepted-deal-policy.ts";
import type { ValidationResult } from "./validation.ts";

export type AcceptedDealExecutionInput = {
  expectedStatus: AcceptedDealExecutionSourceStatus;
};

export function validateAcceptedDealExecution(
  raw: unknown,
): ValidationResult<AcceptedDealExecutionInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "A request body is required." };
  }
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== "expectedStatus")) {
    return { ok: false, error: "Unexpected fields were rejected." };
  }
  if (typeof body.expectedStatus !== "string" || !canStartAcceptedDealExecution(body.expectedStatus)) {
    return { ok: false, error: "This request cannot start execution from its current status." };
  }
  return { ok: true, data: { expectedStatus: body.expectedStatus } };
}
