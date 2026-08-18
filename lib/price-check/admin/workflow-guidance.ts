import type { PriceCheckStatus } from "../../../db/price-check/domain/status-policy.ts";

export const workflowPhases = [
  { id: "intake", title: "Intake" },
  { id: "verify", title: "Verify Transaction" },
  { id: "analyze", title: "Analyze Evidence" },
  { id: "result", title: "Prepare Result" },
  { id: "delivery", title: "Delivery & Follow-up" },
] as const;

const statusPhase: Record<PriceCheckStatus, number> = {
  submitted: 0,
  upload_processing: 1,
  extraction_review: 1,
  processing_failed: 1,
  needs_information: 1,
  ready_for_analysis: 2,
  analysis_ready: 3,
  human_review: 3,
  approved: 3,
  sent: 4,
  quote_requested: 4,
  converted: 4,
  closed: 4,
  spam: 0,
  withdrawn: 0,
};

const attentionStatuses = new Set<PriceCheckStatus>(["processing_failed", "needs_information", "quote_requested", "spam"]);

const nextActions: Record<PriceCheckStatus, string> = {
  submitted: "Confirm ownership, then verify the customer submission and any stated documentation requirements.",
  upload_processing: "Monitor document checks. Review files marked Clean and the extraction proposal when it is ready.",
  extraction_review: "Compare the extraction proposal with the clean source document and apply only confirmed fields.",
  processing_failed: "Review the safe processing error. Continue with manual document review or retry only the permitted processing step.",
  needs_information: "Resolve the recorded information gap before moving the transaction into evidence analysis.",
  ready_for_analysis: "Select only relevant governed comparable evidence, record each decision, and save the deterministic analysis.",
  analysis_ready: "Prepare the customer result and review every statement against the persisted deterministic analysis.",
  human_review: "Complete human review of the result. Revise it or approve it only when the customer-facing content is accurate.",
  approved: "Send the approved result, then confirm that secure delivery succeeds.",
  sent: "The result was delivered. Monitor customer follow-up and any sourcing request.",
  quote_requested: "The customer created a linked Buy Request. Open that record and begin the approved Civilon sourcing workflow; older records may retain only a legacy sourcing opportunity.",
  converted: "The sourcing opportunity was converted. Continue the operational follow-up and close the Price Check when appropriate.",
  closed: "This Price Check is closed. No further workflow action is expected.",
  spam: "This request is classified as spam. No operational Price Check action is available.",
  withdrawn: "This request was withdrawn. No further Price Check action is expected.",
};

export type WorkflowPhaseState = "completed" | "current" | "upcoming" | "attention";

export function getPriceCheckWorkflowGuidance(status: PriceCheckStatus, assigned: boolean) {
  const currentPhase = statusPhase[status];
  const terminal = status === "closed";
  return {
    currentPhase,
    nextAction: status === "submitted" && !assigned
      ? "Assign the request, then verify the customer submission and any stated documentation requirements."
      : nextActions[status],
    phases: workflowPhases.map((phase, index) => ({
      ...phase,
      state: (terminal
        ? "completed"
        : index < currentPhase
          ? "completed"
          : index > currentPhase
            ? "upcoming"
            : attentionStatuses.has(status)
              ? "attention"
              : "current") as WorkflowPhaseState,
    })),
  };
}
