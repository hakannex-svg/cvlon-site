import { notFound } from "next/navigation";
import { Breadcrumbs, SectionHeading } from "@/components/Interior";
import { MarketplaceHubView } from "@/components/marketplace/MarketplaceHubView";
import { isMarketplaceEnabled, isSellSubmissionEnabled } from "@/lib/marketplace/feature";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Buy & Sell Aircraft Parts",
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
            items={[{ label: "Home", href: "/" }, { label: "Buy & Sell Aircraft Parts" }]}
            currentPath="/buy-sell-aircraft-parts"
          />
          <div className="price-check-hero-grid">
            <div>
              <span className="section-label light">PARTS / BUY &amp; SELL</span>
              <h1>Buy &amp; sell aircraft parts</h1>
              <p className="pc-proposition">One desk on both sides of the transaction.</p>
              <p>
                Tell Civilon what you need and Civilon reviews and sources it. Or
                offer Civilon parts you hold. Availability, stated condition,
                documentation, delivery and price all remain subject to
                confirmation, and documentation varies by part and source.
              </p>
            </div>
            <aside aria-label="How a Civilon request works">
              <span>REQUEST PATH</span>
              <ol>
                <li>Tell Civilon what you need</li>
                <li>Confirm your email address</li>
                <li>Civilon reviews and sources the part</li>
                <li>Civilon comes back with what is available and on what terms</li>
              </ol>
            </aside>
          </div>
        </div>
      </section>

      <section className="section price-check-entry">
        <div className="shell">
          <SectionHeading
            label="CHOOSE / DIRECTION"
            title="Which side of the transaction are you on?"
            intro="Choose the side you are on. Civilon is the counterparty either way, and nothing on either side is published or listed."
          />
          <MarketplaceHubView sellEnabled={isSellSubmissionEnabled()} />
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
              <h3>Documentation varies</h3>
              <p>
                Release documentation varies by part and source. Civilon states
                what is available for a specific part; it does not certify parts
                or approve airworthiness.
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
        </div>
      </section>
    </main>
  );
}
