import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SellInventoryFreshness } from "@/components/marketplace/SellInventoryFreshness";
import { isSellSubmissionEnabled } from "@/lib/marketplace/feature";

/**
 * Private bulk-inventory availability surface. Never indexed, never in the
 * sitemap, never in navigation: it exists only for someone holding a link
 * Civilon emailed them, and the server never sees the credential at all — it
 * arrives in the URL fragment, which is why this page can be rendered without
 * knowing anything about the check it is about to show.
 */
export const metadata: Metadata = {
  title: "Is this still available? | Civilon",
  description: "Tell Civilon whether the parts you offered are still available.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

export default function SellInventoryFreshnessPage() {
  if (!isSellSubmissionEnabled()) notFound();

  return (
    <main className="marketplace-verify-main">
      <section className="section price-check-entry">
        <div className="shell marketplace-verify-shell">
          <SellInventoryFreshness />
          <aside className="marketplace-verify-aside" aria-label="What Civilon confirms next">
            <span className="section-label">SUBJECT TO CONFIRMATION</span>
            <p>
              Your answer is your own statement about your stock at this moment.
              Civilon already has your submission. Every submission gets an
              internal review; offers are at Civilon&apos;s discretion. Interest, availability, stated condition,
              documentation and price all remain subject to confirmation either
              way.
            </p>
            <p>
              Documentation varies by part and source. Neither this question nor
              your answer is certification, authentication, regulatory approval,
              airworthiness approval, or a guarantee of authenticity or fitness.
            </p>
            <p>
              Nothing you answer is published, listed, or shown to a buyer, and
              answering does not create an account.
            </p>
          </aside>
        </div>
      </section>
    </main>
  );
}
