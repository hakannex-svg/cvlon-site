import { pageMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = pageMetadata("Terms of Use", "Terms governing Civilon LLC's website, RFQ, AOG and Aircraft Part Price Check services.", "/terms-of-use");

export default function TermsOfUsePage() {
  return <main>
    <section className="interior-hero legal-hero"><div className="shell"><span className="section-label">LEGAL / TERMS</span><h1>Terms of Use</h1><p>These terms govern business use of the Civilon website and requests submitted through it.</p></div></section>
    <article className="section legal-page"><div className="shell legal-prose">
      <p className="legal-meta">Last updated August 16, 2026</p>
      <section><h2>Business service and requests</h2><p>Civilon LLC provides business-aircraft sourcing, AOG coordination, repair-management and related request handling. Website information and request responses are for business use. Availability, condition, documentation, warranty, delivery, export and compliance requirements remain subject to confirmation and the applicable quotation or transaction documents.</p></section>
      <section><h2>Aircraft Part Price Check</h2><p>A Civilon Aircraft Part Price Check provides confidential, human-reviewed informational market context for the transaction submitted. It is not an appraisal, certification, price guarantee, offer, inventory representation, supplier-cost determination, margin determination or a recommendation to buy or sell. Results may be limited or unavailable where comparable evidence is insufficient. Actual transaction suitability and pricing depend on factors including part number, condition, documentation, core terms, warranty, availability, timing, freight, aircraft application and commercial terms.</p></section>
      <section><h2>Your submissions</h2><p>You represent that you may provide the information and any optional document you submit, that it is accurate to the best of your knowledge, and that it does not infringe another party&apos;s rights or include unlawful material. Do not submit credentials, payment-card data, export-controlled data, personal information that is not necessary, or any material you are not authorized to share. Civilon may decline, quarantine or remove a submission where necessary for security, compliance or service integrity.</p></section>
      <section><h2>Acceptable use</h2><p>You may not interfere with the website, bypass security controls, use automated extraction or scraping without permission, submit malware or misleading materials, impersonate another person, or use the service in violation of law or applicable aviation, export or trade requirements.</p></section>
      <section><h2>Intellectual property and third-party services</h2><p>Website content is owned by Civilon or its licensors and may be used only for evaluating Civilon&apos;s services. Third-party websites, suppliers and service providers operate under their own terms. Civilon does not control third-party content or availability.</p></section>
      <section><h2>Disclaimers, liability and governing terms</h2><p>Service availability and website content are provided on an as-available basis to the extent permitted by applicable law. Nothing in these terms waives rights or obligations that cannot lawfully be waived.</p></section>
      <section><h2>Contact and updates</h2><p>For questions, contact <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>, call <a href={`tel:${siteConfig.officeTel}`}>{siteConfig.officePhone}</a>, or write to Civilon LLC at 375 Sylvan Ave, Suite 23, Englewood Cliffs, NJ 07632. We may update these terms by posting a revised version here.</p></section>
    </div></article>
  </main>;
}
