import { CallAogAction, WhatsAppAogAction } from "./AogActions";

export function AogContactStrip({ sourcePage = "homepage" }: { sourcePage?: string }) {
  return (
    <section className="aog-band" aria-label="Urgent AOG contact">
      <div className="aog-overlay" aria-hidden="true" />
      <div className="shell aog-inner">
        <div className="aog-strip-copy">
          <span><i className="live-dot" /> 24/7 AOG DESK</span>
          <h2>AOG? Call or message the monitored desk.</h2>
        </div>
        <div className="aog-strip-actions">
          <CallAogAction className="aog-strip-call" source_page={sourcePage}>Call AOG Desk</CallAogAction>
          <WhatsAppAogAction className="aog-strip-whatsapp" source_page={sourcePage}>WhatsApp AOG</WhatsAppAogAction>
        </div>
      </div>
    </section>
  );
}
