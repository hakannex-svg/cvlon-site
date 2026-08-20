import { BUY_REQUEST_SOURCE_PAGE, MARKETPLACE_HUB_PAGE, SELL_SUBMISSION_PAGE } from "@/lib/marketplace/contract";
import { isMarketplaceEnabled, isSellSubmissionEnabled } from "@/lib/marketplace/feature";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { PUBLIC_CTA } from "@/lib/public-cta";

type PublicChoice = {
  key: string;
  title: string;
  body: string;
  points: string[];
  href: string;
  cta: string;
};

/**
 * The three public choices, in one place, on the homepage.
 *
 * Price Check, Buy and Sell are three different requests with three different
 * intakes, and a visitor who cannot tell them apart picks the wrong one. Each
 * card states what the request actually is and links to that intake only.
 *
 * Every card is gated on the flag that governs the page it links to, so a card
 * can never point at a route that answers 404. With every flag off the section
 * does not render at all rather than leaving an empty heading behind.
 */
export function PublicChoices() {
  const marketplaceEnabled = isMarketplaceEnabled();
  const choices: PublicChoice[] = [];

  if (isPriceCheckEnabled()) choices.push({
    key: "price-check",
    title: "Price Check",
    body: "Review a quoted or purchased aircraft-part price against available comparable evidence with a confidential, human-reviewed result.",
    points: [
      "Informational and human-reviewed",
      "Not an appraisal, an instant result or a price guarantee",
      "The result stays private to you",
    ],
    href: "/price-check",
    cta: PUBLIC_CTA.priceCheck,
  });

  if (marketplaceEnabled) choices.push({
    key: "buy",
    title: "Request an aircraft part",
    body: "Send Civilon the part number and requirements. Civilon sources and sells the part to you; your request is never publicly listed.",
    points: [
      "Civilon is the seller, not a broker of your request",
      "Availability, stated condition, documentation, delivery and price remain subject to confirmation",
      "No account or sign-in required",
    ],
    href: BUY_REQUEST_SOURCE_PAGE,
    cta: PUBLIC_CTA.buy,
  });

  if (isSellSubmissionEnabled()) choices.push({
    key: "sell",
    title: "Submit aircraft parts",
    body: "Privately offer a single part or bulk inventory file for Civilon’s internal review; nothing you send is publicly listed.",
    points: [
      "Single parts or private bulk inventory",
      "Civilon is not obliged to buy",
      "Interest, condition, documentation and price remain subject to confirmation",
    ],
    href: SELL_SUBMISSION_PAGE,
    cta: PUBLIC_CTA.sell,
  });

  if (choices.length === 0) return null;

  return (
    <section className="section public-choices" aria-labelledby="public-choices-title">
      <div className="shell">
        <div className="interior-heading">
          <span className="section-label">CHOOSE / DIRECTION</span>
          <h2 id="public-choices-title">Which of these do you need?</h2>
          <p>
            Civilon handles each request directly. Buy and Sell are private
            Civilon transactions; Price Check is a confidential review. Nothing
            here is a public listing, and no transaction is agreed until Civilon
            confirms it.
          </p>
        </div>
        <div className={`marketplace-choice-grid${choices.length === 3 ? " choice-grid-three" : ""}`}>
          {choices.map((choice, index) => (
            <article className="marketplace-choice is-open" key={choice.key}>
              <span className="marketplace-choice-index">0{index + 1}</span>
              <h3>{choice.title}</h3>
              <p>{choice.body}</p>
              <ul>{choice.points.map((point) => <li key={point}>{point}</li>)}</ul>
              <a className="button button-primary" href={choice.href}>
                {choice.cta} <span aria-hidden="true">→</span>
              </a>
            </article>
          ))}
        </div>
        {marketplaceEnabled && (
          <p className="public-choices-note">
            Buying and selling both start at <a href={MARKETPLACE_HUB_PAGE}>Buy &amp; sell aircraft parts</a>.
            For an aircraft on ground, use the <a href="/aog-services">monitored AOG desk</a> instead.
          </p>
        )}
      </div>
    </section>
  );
}
