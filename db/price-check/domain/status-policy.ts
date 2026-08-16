import "../server-boundary.ts";

export const priceCheckStatuses = [
  "submitted",
  "upload_processing",
  "extraction_review",
  "processing_failed",
  "needs_information",
  "ready_for_analysis",
  "analysis_ready",
  "human_review",
  "approved",
  "sent",
  "quote_requested",
  "converted",
  "closed",
  "spam",
  "withdrawn",
] as const;

export type PriceCheckStatus = (typeof priceCheckStatuses)[number];

const transitionPolicy: Readonly<Record<PriceCheckStatus, readonly PriceCheckStatus[]>> = {
  submitted: ["upload_processing", "ready_for_analysis", "spam", "withdrawn"],
  upload_processing: ["extraction_review", "processing_failed", "withdrawn"],
  extraction_review: ["ready_for_analysis", "needs_information", "withdrawn"],
  processing_failed: ["ready_for_analysis", "needs_information", "withdrawn"],
  needs_information: ["ready_for_analysis", "withdrawn"],
  ready_for_analysis: ["analysis_ready", "needs_information", "withdrawn"],
  analysis_ready: ["human_review", "needs_information", "withdrawn"],
  human_review: ["approved", "needs_information", "withdrawn"],
  approved: ["sent", "human_review", "withdrawn"],
  sent: ["quote_requested", "closed"],
  quote_requested: ["converted", "closed"],
  converted: ["closed"],
  closed: [],
  spam: [],
  withdrawn: [],
};

export function canTransitionPriceCheck(
  from: PriceCheckStatus,
  to: PriceCheckStatus,
) {
  return transitionPolicy[from].includes(to);
}

export function assertPriceCheckTransition(
  from: PriceCheckStatus,
  to: PriceCheckStatus,
) {
  if (!canTransitionPriceCheck(from, to)) {
    throw new Error(`Price Check transition ${from} -> ${to} is not allowed.`);
  }
}

export const processingJobStates = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "dead_letter",
] as const;
