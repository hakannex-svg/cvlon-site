import { isPriceCheckEnabled } from "@/lib/price-check/feature";

type PriceCheckPromotionProps = { context?: "homepage" | "parts" | "category" };

export function PriceCheckPromotion({ context = "homepage" }: PriceCheckPromotionProps) {
  if (!isPriceCheckEnabled()) return null;
  const contextual = context !== "homepage";
  const heading = contextual ? "Already have a supplier quote?" : "Before you approve the PO, check the market.";
  const description = contextual
    ? "Check the observed market before you approve the PO. Civilon reviews available comparable evidence and returns a confidential, human-reviewed informational Price Check."
    : "Submit the aircraft part, condition and quoted or purchased price. Civilon reviews available comparable evidence and returns an informational Price Check.";
  const cta = contextual ? "Run a Price Check" : "Check a Part Price";
  return (
    <section className={`price-check-promotion ${contextual ? "price-check-promotion-context" : ""}`} aria-labelledby={`price-check-promotion-${context}`}>
      <div className="shell price-check-promotion-inner">
        <div>
          <span className="section-label">PRICE CHECK / HUMAN-REVIEWED</span>
          <h2 id={`price-check-promotion-${context}`}>{heading}</h2>
          <p>{description}</p>
        </div>
        <a className="button button-primary" href="/price-check">{cta} <span aria-hidden="true">→</span></a>
      </div>
    </section>
  );
}
