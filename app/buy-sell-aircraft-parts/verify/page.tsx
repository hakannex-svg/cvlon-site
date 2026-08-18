import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BuyRequestVerification } from "@/components/marketplace/BuyRequestVerification";
import { isMarketplaceEnabled } from "@/lib/marketplace/feature";

/**
 * Private confirmation surface. It is never indexed, never in the sitemap, and
 * never in navigation regardless of the site-wide indexing flag: the page exists
 * only for someone holding a link Civilon emailed them.
 */
export const metadata: Metadata = {
  title: "Confirm your email address | Civilon",
  description: "Confirm the email address on your Civilon parts request.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

export default function BuyRequestVerifyPage() {
  if (!isMarketplaceEnabled()) notFound();

  return (
    <main className="marketplace-verify-main">
      <section className="section price-check-entry">
        <div className="shell marketplace-verify-shell">
          <BuyRequestVerification />
          <aside className="marketplace-verify-aside" aria-label="What Civilon confirms next">
            <span className="section-label">SUBJECT TO CONFIRMATION</span>
            <p>
              Civilon reviews and sources each request internally. Availability,
              stated condition, documentation, delivery and price all remain
              subject to confirmation.
            </p>
            <p>
              Documentation varies by part and source. Where a requirement
              involves repair or overhaul, work is coordinated with appropriately
              approved repair facilities.
            </p>
            <p>
              Confirming your email address does not create an account, does not
              place an order, and is not a quotation.
            </p>
          </aside>
        </div>
      </section>
    </main>
  );
}
