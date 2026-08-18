export type AnalyticsEventName =
  | "aog_call_click"
  | "whatsapp_click"
  | "rfq_submit"
  | "contact_submit"
  | "price_check_view"
  | "price_check_start"
  | "price_check_submit"
  | "price_check_upload_started"
  | "price_check_upload_completed"
  | "buy_sell_hub_view"
  | "buy_request_view"
  | "buy_request_start"
  | "buy_request_submit"
  | "buy_request_verification_confirmed"
  | "sell_submission_view"
  | "sell_submission_start"
  | "sell_submission_upload_started"
  | "sell_submission_upload_completed"
  | "sell_submission_submit"
  | "sell_submission_verification_confirmed"
  // Follow-up seller evidence. Like every event above, these are page-level
  // facts and carry only `source_page` — never a credential, a file name, a
  // storage key, a category, a size, an upload identifier, a Civilon
  // reference, or anything read from inside a file.
  | "sell_evidence_request_opened"
  | "sell_evidence_request_submitted"
  // Bulk-inventory freshness. Page-level facts only: `source_page` and nothing
  // else. Never the credential, never the Civilon reference, and deliberately
  // never the seller's answer — which of the three a seller chose is a fact
  // about their stock, and a per-answer event name would put it into an
  // analytics stream Civilon does not control.
  | "sell_inventory_freshness_opened"
  | "sell_inventory_freshness_answered";

export type AnalyticsContext = {
  source_page?: string;
  cta_location?: string;
};

declare global {
  interface Window {
    civilonAnalyticsConsentGranted?: boolean;
    civilonPendingAnalyticsEvents?: Array<Record<string, unknown>>;
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export function trackCivilonEvent(name: AnalyticsEventName, context: AnalyticsContext = {}) {
  if (typeof window === "undefined") return;
  const detail = {
    event: name,
    ...(context.source_page ? { source_page: context.source_page } : {}),
    ...(context.cta_location ? { cta_location: context.cta_location } : {}),
  };

  if (window.civilonAnalyticsConsentGranted === false) return;
  if (window.civilonAnalyticsConsentGranted !== true) {
    window.civilonPendingAnalyticsEvents = [...(window.civilonPendingAnalyticsEvents ?? []), detail];
    return;
  }

  window.dataLayer?.push(detail);
  window.dispatchEvent(new CustomEvent("civilon:analytics", { detail }));
}
