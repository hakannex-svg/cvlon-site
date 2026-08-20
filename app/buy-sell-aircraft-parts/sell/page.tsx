import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Interior";
import { SellSubmissionForm } from "@/components/marketplace/SellSubmissionForm";
import { isSellSubmissionEnabled } from "@/lib/marketplace/feature";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Offer Parts",
  "Offer aircraft parts or inventory to Civilon. No account required. Nothing is published or listed, and interest, condition, documentation and price remain subject to confirmation.",
  "/buy-sell-aircraft-parts/sell",
);

export default function SellPartsToCivilonPage() {
  // Both the marketplace flag and the Sell flag must be on. Sell is gated
  // separately from Buy and entirely independently of Price Check.
  if (!isSellSubmissionEnabled()) notFound();

  return (
    <main id="sell-submission-form">
      <section className="price-check-hero" data-mobile-aog-suppress>
        <div className="shell">
          <Breadcrumbs
            items={[
              { label: "Home", href: "/" },
              { label: "Request or Offer Aircraft Parts", href: "/buy-sell-aircraft-parts" },
              { label: "Offer Parts" },
            ]}
            currentPath="/buy-sell-aircraft-parts/sell"
          />
          <div className="price-check-hero-grid">
            <div>
              <span className="section-label light">PARTS / OFFER TO CIVILON</span>
              <h1>Offer Parts</h1>
              <p className="pc-proposition">One part or a whole inventory. One counterparty.</p>
              <p>
                Civilon buys on its own account. Tell us what you hold and the
                Civilon team reviews it internally—no account, no sign-in, and
                nothing you send is published, listed, or shown to a buyer.
              </p>
            </div>
            <aside aria-label="What happens after you submit">
              <span>AFTER YOU SEND</span>
              <ol>
                <li>You receive a reference straight away</li>
                <li>Confirm your email address through the link Civilon sends</li>
                <li>Civilon reviews what you have offered</li>
                <li>A member of the team contacts you to discuss it</li>
              </ol>
            </aside>
          </div>
        </div>
      </section>

      <section className="section price-check-entry">
        <div className="shell price-check-layout">
          <div className="price-check-intro">
            <span className="section-label">START / PARTS OFFER</span>
            <h2>What Civilon needs from you.</h2>
            <p>
              A way to reach you, where the parts are, and enough about the part
              or the list to know what you are offering. Price is optional and on
              request is normal.
            </p>
            <ul>
              <li>No account and no password</li>
              <li>Part number optional if you can describe it</li>
              <li>Files are optional—send without them if you prefer</li>
              <li>No submission details sent to analytics</li>
            </ul>
          </div>
          <SellSubmissionForm />
        </div>
      </section>
    </main>
  );
}
