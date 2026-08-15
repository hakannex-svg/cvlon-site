export type AnalyticsEventName =
  | "aog_call_click"
  | "aog_whatsapp_click"
  | "rfq_submit"
  | "aog_rfq_submit";

export type AnalyticsContext = {
  source_page?: string;
  aircraft_brand?: string;
  part_category?: string;
};

declare global {
  interface Window {
    dataLayer?: Array<Record<string, string>>;
  }
}

export function trackCivilonEvent(name: AnalyticsEventName, context: AnalyticsContext = {}) {
  if (typeof window === "undefined") return;

  const detail = {
    event: name,
    ...(context.source_page ? { source_page: context.source_page } : {}),
    ...(context.aircraft_brand ? { aircraft_brand: context.aircraft_brand } : {}),
    ...(context.part_category ? { part_category: context.part_category } : {}),
  };

  window.dataLayer?.push(detail);
  window.dispatchEvent(new CustomEvent("civilon:analytics", { detail }));
}
