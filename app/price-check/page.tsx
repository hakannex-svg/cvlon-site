import { notFound } from "next/navigation";
import { Breadcrumbs, SectionHeading } from "@/components/Interior";
import { PriceCheckForm } from "@/components/PriceCheckForm";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Aircraft Part Price Check",
  "Submit aircraft-part transaction details for a confidential, human-reviewed Civilon market-context Price Check.",
  "/price-check",
);

const conditions = [
  ["NE", "New"], ["NS", "New Surplus"], ["OH", "Overhauled"],
  ["SV", "Serviceable"], ["AR", "As Removed"],
] as const;

export default function PriceCheckPage() {
  if (!isPriceCheckEnabled()) notFound();
  return <main id="price-check-form">
    <section className="price-check-hero" data-mobile-aog-suppress>
      <div className="shell">
        <Breadcrumbs items={[{label:"Home",href:"/"},{label:"Aircraft Part Price Check"}]} currentPath="/price-check" />
        <div className="price-check-hero-grid"><div><span className="section-label light">MARKET CONTEXT / HUMAN REVIEW</span><h1>Aircraft Part Price Check</h1><p className="pc-proposition">Before you approve the PO, check the market.</p><p>Share the transaction context Civilon should review. The current launch service is informational, confidential and human-reviewed—not an appraisal, an instant result or a determination of supplier cost or margin.</p><div className="pc-launch-points"><span>Free for launch</span><span>Confidential</span><span>No obligation</span></div></div><aside aria-label="What happens next"><span>REVIEW PATH</span><ol><li>Submit the transaction</li><li>Civilon reviews its context</li><li>Additional information may be requested</li><li>A human-reviewed result is prepared later</li></ol></aside></div>
      </div>
    </section>
    <section className="section price-check-entry"><div className="shell price-check-layout"><div className="price-check-intro"><span className="section-label">START / PRICE CHECK</span><h2>Describe the transaction as quoted or purchased.</h2><p>Price varies with condition, documentation, core exposure, warranty, timing, availability, freight and aircraft application. Keep those details attached to the request.</p><ul><li>Optional private supporting-document upload</li><li>No automated price conclusion</li><li>No transaction details sent to analytics</li></ul></div><PriceCheckForm /></div></section>
    <section className="section section-muted price-check-education"><div className="shell"><SectionHeading label="CONTEXT / WHY PRICES VARY" title="The same part number can represent different transactions." intro="Price is meaningful only when the commercial and technical context is understood."/><div className="pc-education-grid"><article><span>01</span><h3>Condition</h3><dl>{conditions.map(([code,label]) => <div key={code}><dt>{code}</dt><dd>{label}</dd></div>)}</dl></article><article><span>02</span><h3>Outright, exchange and core</h3><p>An outright sale and an exchange are different transactions. A refundable core remains separate from purchase cost; forfeiture or unclear core terms can materially change exposure.</p></article><article><span>03</span><h3>Documentation and warranty</h3><p>Release requirements, trace and supporting records vary by part and condition. Warranty length, units, exclusions and stated coverage also affect comparison.</p></article><article><span>04</span><h3>Availability, AOG and delivery</h3><p>Urgency, available supply, aircraft application, location and freight can change what is commercially usable. Active AOG sourcing should also go to Civilon&apos;s monitored desk.</p></article></div><div className="information-note"><span>WHY ADDITIONAL REVIEW MAY BE NEEDED</span><p>Sparse evidence, mixed conditions, uncertain core terms, unusual documentation requirements or incomplete transaction detail can prevent a reliable like-for-like comparison.</p></div></div></section>
  </main>;
}
