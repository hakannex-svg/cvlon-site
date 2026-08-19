import type { BuyerDecision } from "@/db/price-check/domain/buyer-decision";
import type { SellInventoryFreshnessFilter } from "@/db/price-check/domain/sell-inventory-freshness";

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

/**
 * The four bulk-inventory freshness states a Sell Submission list can be
 * narrowed to, labelled exactly as the All Work counters label them, so a staff
 * member who clicked "Backoff" lands on a control that still says "Backoff".
 *
 * Each names stored workflow state and nothing Civilon has concluded about the
 * parts. Delivery concerns is absent on purpose: it counts queued emails rather
 * than records, so it is not a state a record list can be narrowed to.
 */
export const sellInventoryFreshnessFilterLabels: Record<SellInventoryFreshnessFilter, string> = {
  due: "Due now",
  live: "Live links",
  backoff: "Backoff",
  seller_changes: "Seller changes",
};

/**
 * The two buyer decisions a Buy Request list can be narrowed to, labelled
 * exactly as the All Work counters label them, so a staff member who clicked
 * "Accepted — act now" lands on a control that still says it.
 *
 * Each names what the buyer said and what Civilon owes them next. Neither says
 * anything Civilon has concluded about the part, the paperwork or the deal.
 */
export const buyerDecisionLabels: Record<BuyerDecision, string> = {
  accepted: "Accepted — act now",
  declined: "Declined — follow up",
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
