export const statusLabels: Record<string, string> = {
  submitted: "Submitted",
  upload_processing: "Upload processing",
  extraction_review: "Extraction review",
  processing_failed: "Processing failed",
  needs_information: "Needs information",
  ready_for_analysis: "Ready for analysis",
  analysis_ready: "Analysis ready",
  human_review: "Human review",
  approved: "Approved",
  sent: "Sent",
  quote_requested: "Quote requested",
  converted: "Converted",
  closed: "Closed",
  spam: "Spam",
  withdrawn: "Withdrawn",
};

/** Buy Request and Sell Submission status labels, alongside the Price Check set above. */
export const marketplaceStatusLabels: Record<string, string> = {
  pending_verification: "Pending verification",
  verified: "Verified",
  sourcing: "Sourcing",
  quoted: "Quoted",
  under_review: "Under review",
  accepted: "Accepted",
  declined: "Declined",
  converted: "Converted",
  closed: "Closed",
  spam: "Spam",
  withdrawn: "Withdrawn",
};

export const unifiedTypeLabels: Record<string, string> = {
  price_check: "Price Check",
  buy_request: "Buy Request",
  sell_submission: "Sell Submission",
};

/** Falls back to the raw value so an unmapped status is visible, not blank. */
export function unifiedStatusLabel(type: string, status: string) {
  const label = type === "price_check" ? statusLabels[status] : marketplaceStatusLabels[status];
  return label ?? status.replaceAll("_", " ");
}

export function staffDisplayName(email: string | null) {
  if (!email) return "Unassigned";
  if (email === "david@cvlon.com") return "David";
  if (email === "hakannex@gmail.com") return "Hakan";
  return "Authorized staff";
}

export function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(value));
}

export function formatAge(value: Date | string) {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(value).valueOf()) / 3_600_000));
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatMoney(value: string, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value));
}
