import { CallAogAction, WhatsAppAogAction } from "./AogActions";

export function MobileAogBar({ sourcePage = "homepage" }: { sourcePage?: string }) {
  return (
    <aside className="mobile-urgent" aria-label="Urgent AOG contact options">
      <CallAogAction source_page={sourcePage}><span>Call</span><strong>AOG desk</strong></CallAogAction>
      <WhatsAppAogAction className="mobile-whatsapp" source_page={sourcePage}><span>WhatsApp</span><strong>Message AOG</strong></WhatsAppAogAction>
    </aside>
  );
}
