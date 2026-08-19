/**
 * The only Buy Request states from which staff can begin execution of the
 * newest accepted Civilon offer. `pending_verification` has not cleared the
 * buyer gate, while `converted` already records this exact fact and the three
 * terminal states cannot be reopened.
 */
export const acceptedDealExecutionSourceStatuses = ["verified", "sourcing", "quoted"] as const;

export type AcceptedDealExecutionSourceStatus =
  (typeof acceptedDealExecutionSourceStatuses)[number];

export function canStartAcceptedDealExecution(
  status: string,
): status is AcceptedDealExecutionSourceStatus {
  return (acceptedDealExecutionSourceStatuses as readonly string[]).includes(status);
}

export const ACCEPTED_DEAL_EXECUTION_STARTED_ACTION = "BUY_REQUEST_EXECUTION_STARTED";
