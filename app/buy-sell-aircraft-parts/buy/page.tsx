import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Interior";
import { BuyRequestForm } from "@/components/marketplace/BuyRequestForm";
import { isMarketplaceEnabled } from "@/lib/marketplace/feature";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Request a Part",
  "Send Civilon the aircraft part you need. No account required. Availability, stated condition, documentation, delivery and price remain subject to confirmation.",
  "/buy-sell-aircraft-parts/buy",
);

export default function BuyPartFromCivilonPage() {
  if (!isMarketplaceEnabled()) notFound();

  return (
    <main id="buy-request-form">
      <section className="price-check-hero" data-mobile-aog-suppress>
        <div className="shell">
          <Breadcrumbs
            items={[
              { label: "Home", href: "/" },
              { label: "Request or Offer Aircraft Parts", href: "/buy-sell-aircraft-parts" },
              { label: "Request a Part" },
            ]}
            currentPath="/buy-sell-aircraft-parts/buy"
          />
          <div className="price-check-hero-grid">
            <div>
              <span className="section-label light">PARTS / REQUEST FROM CIVILON</span>
              <h1>Request a Part</h1>
              <p className="pc-proposition">Tell us what you need. We&apos;ll find it.</p>
              <p>
                No account and no sign-in. Civilon is the seller: it reviews the
                requirement, sources the part, and comes back to you with what
                is available and on what terms.
              </p>
              <p className="section-qualifier section-qualifier-dark">
                Your request is never published or listed. Availability, stated
                condition, documentation, delivery and price are confirmed per
                request; documentation varies by part and source.
              </p>
            </div>
            <aside aria-label="What happens after you send a request">
              <span>AFTER YOU SEND</span>
              <ol>
                <li>You receive a reference straight away</li>
                <li>Confirm your email address through the link Civilon sends</li>
                <li>Civilon reviews and sources the part</li>
                <li>Civilon confirms availability, condition, documentation and price</li>
              </ol>
            </aside>
          </div>
        </div>
      </section>

      <section className="section price-check-entry">
        <div className="shell price-check-layout">
          <div className="price-check-intro">
            <span className="section-label">START / PART REQUEST</span>
            <h2>What Civilon needs from you.</h2>
            <p>
              Only the part, a quantity and how to reach you are required. Every
              other field helps Civilon narrow the search, and none of it commits
              you to anything.
            </p>
            <ul>
              <li>No account and no password</li>
              <li>Part number optional if you can describe it</li>
              <li>Nothing is ordered by sending a request</li>
              <li>No request details sent to analytics</li>
            </ul>
          </div>
          <BuyRequestForm />
        </div>
      </section>
    </main>
  );
}
