import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SellEvidenceRequest } from "@/components/marketplace/SellEvidenceRequest";
import { isSellSubmissionEnabled } from "@/lib/marketplace/feature";

/**
 * Private follow-up upload surface. Never indexed, never in the sitemap, never
 * in navigation: it exists only for someone holding a link Civilon emailed
 * them, and the server never sees the credential at all — it arrives in the URL
 * fragment, which is why this page can be rendered without knowing anything
 * about the request it is about to show.
 */
export const metadata: Metadata = {
  title: "Send files to Civilon | Civilon",
  description: "Send Civilon the files requested for your parts submission.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

export default function SellEvidenceRequestPage() {
  if (!isSellSubmissionEnabled()) notFound();

  return (
    <main className="marketplace-verify-main">
      <section className="section price-check-entry">
        <div className="shell marketplace-verify-shell">
          <SellEvidenceRequest />
          <aside className="marketplace-verify-aside" aria-label="What Civilon confirms next">
            <span className="section-label">SUBJECT TO CONFIRMATION</span>
            <p>
              Files are optional evidence for Civilon&rsquo;s internal review.
              Civilon already has your submission, reviews it internally, and is
              not obliged to buy. Interest, availability, stated condition,
              documentation and price all remain subject to confirmation.
            </p>
            <p>
              Documentation varies by part and source. Civilon review, and any
              files you send, are not certification, authentication, regulatory
              approval, airworthiness approval, or a guarantee of authenticity
              or fitness.
            </p>
            <p>
              Nothing you send is published, listed, or shown to a buyer, and
              sending files does not create an account.
            </p>
          </aside>
        </div>
      </section>
    </main>
  );
}
