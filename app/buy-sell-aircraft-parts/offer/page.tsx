import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BuyerOfferResponse } from "@/components/marketplace/BuyerOfferResponse";
import { isMarketplaceEnabled } from "@/lib/marketplace/feature";

export const metadata: Metadata = {
  title: "Review Civilon's offer | Civilon",
  description: "Privately review and respond to Civilon's aircraft-parts offer.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

export default function BuyerOfferPage() {
  if (!isMarketplaceEnabled()) notFound();
  return <main className="marketplace-verify-main">
    <section className="section price-check-entry">
      <div className="shell marketplace-verify-shell">
        <BuyerOfferResponse />
        <aside className="marketplace-verify-aside" aria-label="About this Civilon offer">
          <span className="section-label">PRIVATE / NO SIGN-IN</span>
          <p>This page shows Civilon&apos;s offer only. Civilon manages sourcing, documentation, shipping and export arrangements as applicable.</p>
          <p>Documentation varies by part and source, and all availability is subject to confirmation.</p>
          <p>This page is not a certification, airworthiness approval or regulatory approval, and it does not guarantee authenticity or fitness.</p>
          <p>No payment is taken here and no buyer or supplier contact is exchanged.</p>
        </aside>
      </div>
    </section>
  </main>;
}
