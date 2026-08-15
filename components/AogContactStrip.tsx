import { CallAogAction, WhatsAppAogAction } from "./AogActions";

export function AogContactStrip({ sourcePage = "homepage" }: { sourcePage?: string }) {
  return (
    <section className="aog-band" aria-label="Urgent AOG contact">
      {/* TODO(production): TEMPORARY IMAGE — replace aog-logistics.webp with approved authentic Civilon AOG logistics photography before release. */}
      <div className="aog-overlay" aria-hidden="true" />
      <div className="shell aog-inner">
        <div className="aog-strip-copy">
          <span><i className="live-dot" /> 24/7 AOG DESK</span>
          <h2>AOG? Reach us immediately.</h2>
        </div>
        <div className="aog-strip-actions">
          <CallAogAction className="aog-strip-call" source_page={sourcePage}>Call +1 909 344 4444</CallAogAction>
          <WhatsAppAogAction className="aog-strip-whatsapp" source_page={sourcePage}>WhatsApp AOG</WhatsAppAogAction>
        </div>
      </div>
    </section>
  );
}
