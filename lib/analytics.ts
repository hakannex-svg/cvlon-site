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
  | "price_check_result_view"
  | "price_check_quote_request";

export type AnalyticsContext = {
  source_page?: string;
  cta_location?: string;
};

declare global {
  interface Window {
    civilonAnalyticsConsentGranted?: boolean;
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export function trackCivilonEvent(name: AnalyticsEventName, context: AnalyticsContext = {}) {
  if (typeof window === "undefined" || window.civilonAnalyticsConsentGranted !== true) return;

  const detail = {
    event: name,
    ...(context.source_page ? { source_page: context.source_page } : {}),
    ...(context.cta_location ? { cta_location: context.cta_location } : {}),
  };

  window.dataLayer?.push(detail);
  window.dispatchEvent(new CustomEvent("civilon:analytics", { detail }));
}
