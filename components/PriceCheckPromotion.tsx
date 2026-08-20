import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { PUBLIC_CTA } from "@/lib/public-cta";

type PriceCheckPromotionProps = { context?: "homepage" | "parts" | "category" };

export function PriceCheckPromotion({ context = "homepage" }: PriceCheckPromotionProps) {
  if (!isPriceCheckEnabled()) return null;
  const contextual = context !== "homepage";
  const heading = contextual ? "Already have a supplier quote?" : "Before you approve the PO, check the market.";
  const description = contextual
    ? "Check the observed market before you approve the PO. Civilon reviews available comparable evidence and returns a confidential informational Price Check."
    : "Submit the aircraft part, condition and quoted or purchased price. Civilon reviews available comparable evidence and returns an informational Price Check.";
  const cta = PUBLIC_CTA.priceCheck;

  if (!contextual) {
    return (
      <section className="price-check-promotion price-check-promotion-feature" aria-labelledby="price-check-promotion-homepage">
        <div className="shell price-check-feature-layout">
          <div className="price-check-feature-copy">
            <span className="section-label">PRICE CHECK / HUMAN-REVIEWED</span>
            <h2 id="price-check-promotion-homepage">{heading}</h2>
            <p className="price-check-feature-intro">Submit the part number, condition, and quoted or purchased price. A Civilon analyst reviews comparable evidence and explains whether the price appears below, within, or above the observed comparable range.</p>
            <ul className="price-check-benefits" aria-label="Price Check benefits">
              <li><strong>A person, not an algorithm</strong><span>Our desk reviews the transaction and comparable evidence before release.</span></li>
              <li><strong>Comparable evidence</strong><span>See how the submitted price relates to available relevant observations.</span></li>
              <li><strong>Built for aircraft parts</strong><span>Accounts for condition, documentation, exchange, repair and core terms.</span></li>
              <li><strong>Private result</strong><span>Receive a secure result and optionally ask Civilon to source the part.</span></li>
            </ul>
            <div className="price-check-feature-actions">
              <a className="button button-primary" href="/price-check">{cta} <span aria-hidden="true">→</span></a>
              <a className="price-check-feature-link" href="/price-check">How Price Check works <span aria-hidden="true">→</span></a>
            </div>
            <p className="section-qualifier section-qualifier-dark">Price Check is informational—not an appraisal, instant result or price guarantee.</p>
          </div>
          <aside className="price-check-flow" aria-label="How Price Check works">
            <span className="price-check-flow-kicker">HOW PRICE CHECK WORKS</span>
            <ol>
              <li><span>01</span><div><strong>Submit</strong><p>Part number, condition and quoted or purchased price.</p></div></li>
              <li><span>02</span><div><strong>Review</strong><p>Civilon reviews comparable evidence and transaction factors.</p></div></li>
              <li><span>03</span><div><strong>Result</strong><p>Receive a private Price Check reviewed by our desk.</p></div></li>
            </ol>
            <div className="price-check-flow-trust" aria-label="Price Check trust attributes">
              <span>Human-reviewed</span><span>Comparable evidence</span><span>Secure private result</span>
            </div>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className={`price-check-promotion ${contextual ? "price-check-promotion-context" : ""}`} aria-labelledby={`price-check-promotion-${context}`}>
      <div className="shell price-check-promotion-inner">
        <div>
          <span className="section-label">PRICE CHECK / DESK REVIEW</span>
          <h2 id={`price-check-promotion-${context}`}>{heading}</h2>
          <p>{description}</p>
        </div>
        <a className="button button-primary" href="/price-check">{cta} <span aria-hidden="true">→</span></a>
      </div>
    </section>
  );
}
