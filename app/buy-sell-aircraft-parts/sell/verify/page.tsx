import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SellSubmissionVerification } from "@/components/marketplace/SellSubmissionVerification";
import { isSellSubmissionEnabled } from "@/lib/marketplace/feature";

/**
 * Private confirmation surface. It is never indexed, never in the sitemap, and
 * never in navigation regardless of the site-wide indexing flag: the page exists
 * only for someone holding a link Civilon emailed them.
 */
export const metadata: Metadata = {
  title: "Confirm your email address | Civilon",
  description: "Confirm the email address on your Civilon parts submission.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

export default function SellSubmissionVerifyPage() {
  if (!isSellSubmissionEnabled()) notFound();

  return (
    <main className="marketplace-verify-main">
      <section className="section price-check-entry">
        <div className="shell marketplace-verify-shell">
          <SellSubmissionVerification />
          <aside className="marketplace-verify-aside" aria-label="What Civilon confirms next">
            <span className="section-label">SUBJECT TO CONFIRMATION</span>
            <p>
              Civilon reviews each submission internally and is not obliged to
              buy. Interest, availability, stated condition, documentation and
              price all remain subject to confirmation.
            </p>
            <p>
              Documentation varies by part and source. Civilon review, and any
              evidence you uploaded, are not certification, regulatory approval,
              airworthiness approval, or a guarantee of authenticity or fitness.
            </p>
            <p>
              Confirming your email address does not create an account, does not
              sell anything, and nothing you submitted is published or listed.
            </p>
          </aside>
        </div>
      </section>
    </main>
  );
}
