import { isPriceCheckEnabled } from "@/lib/price-check/feature";

type PriceCheckPromotionProps = { context?: "homepage" | "parts" | "category" };

export function PriceCheckPromotion({ context = "homepage" }: PriceCheckPromotionProps) {
  if (!isPriceCheckEnabled()) return null;
  const contextual = context !== "homepage";
  return (
    <section className={`price-check-promotion ${contextual ? "price-check-promotion-context" : ""}`} aria-labelledby={`price-check-promotion-${context}`}>
      <div className="shell price-check-promotion-inner">
        <div>
          <span className="section-label">PRICE CHECK / HUMAN-REVIEWED</span>
          <h2 id={`price-check-promotion-${context}`}>Need context before you approve the PO?</h2>
          <p>Share the quoted or purchased transaction details for a confidential, human-reviewed Civilon Price Check. It is informational context, not an appraisal or a price guarantee.</p>
        </div>
        <a className="button button-primary" href="/price-check">Learn about Price Check <span aria-hidden="true">→</span></a>
      </div>
    </section>
  );
}
