import { notFound } from "next/navigation";
import { Breadcrumbs, SectionHeading } from "@/components/Interior";
import { MarketplaceHubView } from "@/components/marketplace/MarketplaceHubView";
import { isMarketplaceEnabled, isSellSubmissionEnabled } from "@/lib/marketplace/feature";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Request or Offer Aircraft Parts",
  "Ask Civilon to source a business-aircraft part, or offer parts to Civilon. Availability, condition, documentation and price are always confirmed before anything is agreed.",
  "/buy-sell-aircraft-parts",
);

export default function BuySellAircraftPartsPage() {
  if (!isMarketplaceEnabled()) notFound();

  return (
    <main>
      <section className="price-check-hero" data-mobile-aog-suppress>
        <div className="shell">
          <Breadcrumbs
            items={[{ label: "Home", href: "/" }, { label: "Request or Offer Aircraft Parts" }]}
            currentPath="/buy-sell-aircraft-parts"
          />
          <div className="price-check-hero-grid">
            <div>
              <span className="section-label light">PARTS / REQUEST &amp; OFFER</span>
              <h1>Request or offer aircraft parts</h1>
              <p className="pc-proposition">One desk on both sides of the transaction.</p>
              <p>
                Tell Civilon what you need and Civilon sources it. Or offer
                Civilon the parts you already hold. One desk carries either
                direction from the first message through to delivery.
              </p>
              <p className="section-qualifier section-qualifier-dark">
                Availability, stated condition, documentation, delivery and
                price are confirmed for each request or offer; documentation
                varies by part and source.
              </p>
            </div>
            <aside aria-label="How Civilon handles each path">
              <span>ONE ACCOUNTABLE DESK</span>
              <ol>
                <li>Choose Request a Part or Offer Parts</li>
                <li>Confirm your email address</li>
                <li>Civilon reviews the requirement or inventory</li>
                <li>Civilon follows up directly; buyer and supplier stay separated</li>
              </ol>
            </aside>
          </div>
        </div>
      </section>

      <section className="section price-check-entry">
        <div className="shell">
          <SectionHeading
            label="CHOOSE / DIRECTION"
            title="Choose the path that fits."
            intro="Civilon is the counterparty either way, and nothing on either side is published or listed."
          />
          <MarketplaceHubView sellEnabled={isSellSubmissionEnabled()} priceCheckEnabled={isPriceCheckEnabled()} />
        </div>
      </section>

      <section className="section section-muted">
        <div className="shell">
          <SectionHeading
            label="CONTEXT / HOW CIVILON WORKS"
            title="Civilon sells to you—it does not broker your request."
            intro="Understanding that difference explains what Civilon can and cannot tell you at each step."
          />
          <div className="pc-education-grid">
            <article>
              <span>01</span>
              <h3>Civilon is the seller</h3>
              <p>
                You buy from Civilon. Civilon locates the part, agrees terms on its
                own account, and sells it to you under one transaction with one
                point of contact.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Availability is confirmed, not assumed</h3>
              <p>
                Nothing is treated as available until Civilon confirms it. Stated
                condition, delivery and price are confirmed with it, and no figure
                is a quotation until Civilon issues one.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>Records identified with each option</h3>
              <p>
                Civilon reviews release and supporting documentation and states
                what is available for each quoted option.
              </p>
            </article>
            <article>
              <span>04</span>
              <h3>Repair, where it applies</h3>
              <p>
                Where a requirement involves repair or overhaul, work is
                coordinated with appropriately approved repair facilities.
              </p>
            </article>
          </div>
          <p className="section-qualifier">Documentation varies by part and source. Civilon identifies the available records for each option and does not certify parts or approve airworthiness.</p>
        </div>
      </section>
    </main>
  );
}
