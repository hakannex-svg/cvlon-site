export const TOPBAR_TICKER_MESSAGES = [
  "24/7 monitored AOG phone & WhatsApp",
  "FAA 8130-3 / EASA Form 1 where applicable",
  "Trace-to-source review",
  "Expedited routing options subject to availability",
] as const;

/** Decorative utility-bar rotation; the AOG phone remains visible beside it. */
export function TopbarTicker() {
  return (
    <div className="topbar-message" aria-hidden="true">
      {TOPBAR_TICKER_MESSAGES.map((message) => <span key={message}>{message}</span>)}
    </div>
  );
}
