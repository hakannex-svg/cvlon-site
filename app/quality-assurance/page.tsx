import { InteriorHero, ProcessSteps, RfqSection, SectionHeading } from "@/components/Interior";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Aircraft Parts Documentation & Quality Review",
  "Understand how part identity, condition, trace-to-source, release and supporting shipment records are reviewed for quoted aircraft components.",
  "/quality-assurance",
);

export default function Page() {
  return <main>
    <InteriorHero
      eyebrow="QUALITY / DOCUMENTATION"
      title="Aircraft parts documentation and quality review"
      intro="Civilon reviews part identity, stated condition, trace-to-source, supplier information and available records before quoting an option."
      qualifier="Civilon review does not certify parts, approve airworthiness, or guarantee authenticity or fitness."
      path="/quality-assurance"
      crumbs={[{label:"Home",href:"/"},{label:"Quality Assurance"}]}
      variant="quality"
      searchHref="#rfq"
      panelItems={["Part-number identity", "Serial or lot reference", "Stated condition", "Trace-to-source", "Available release records", "Packing and export records"]}
    />

    <section className="section section-tight">
      <div className="shell">
        <div className="two-column">
          <div>
            <SectionHeading label="IDENTITY / 01" title="Part, serial and source review" />
            <ul className="technical-list">
              <li>Part-number and effectivity context</li>
              <li>Serial or lot reference</li>
              <li>Trace-to-source and supporting records</li>
              <li>Removal, test or evaluation reports</li>
              <li>Supplier and document review</li>
            </ul>
          </div>
          <div>
            <SectionHeading label="CONDITION / 02" title="Clear terminology" />
            <p className="large-copy">NE — New, NS — New Surplus, OH — Overhauled, SV — Serviceable and AR — As Removed describe different conditions. Condition terms and supporting-document expectations are not interchangeable.</p>
          </div>
        </div>
        <p className="section-qualifier">Serial or lot references, trace, removal, test, evaluation and warranty records vary by part, condition and source; Civilon reviews what is applicable and available.</p>
      </div>
    </section>

    <section className="section section-muted section-tight">
      <div className="shell">
        <SectionHeading label="DOCUMENTS / 03" title="Records identified with each quotation" />
        <p>Civilon reviews release, trace, test, removal, material, packing, shipping and export records, then identifies what is available for the quoted option.</p>
        <ul className="technical-list columns">
          <li>FAA 8130-3</li>
          <li>EASA Form 1 or dual release</li>
          <li>OEM or manufacturer Certificate of Conformity</li>
          <li>Material certification</li>
          <li>Removal, teardown, evaluation or test records</li>
          <li>Commercial invoice and packing list</li>
          <li>Air waybill and transport records</li>
          <li>Export records</li>
        </ul>
        <p className="section-qualifier">Release and export records vary by part, condition, source, destination and requirements; documentation is provided only where applicable and available.</p>
      </div>
    </section>

    <section className="section section-tight">
      <div className="shell">
        <SectionHeading label="CONTROL POINTS / 04" title="Review and discrepancy handling" />
        <ProcessSteps steps={[
          "Confirm part identity and application",
          "Review supplier and source information",
          "Check stated condition and available records",
          "Align release-document expectations",
          "Escalate discrepancies under internal procedures",
          "Support receiving-inspection questions",
        ]} />
        <p>Civilon documents discrepancies and escalates them for review. The quotation and governing terms state the applicable quarantine, return, warranty or remedy path.</p>
      </div>
    </section>

    <RfqSection
      sourcePage="/quality-assurance"
      heading="State the condition and documentation required."
      supportingPoints={["Exact part and serial or lot information", "Acceptable condition", "Required trace, release and supporting records"]}
    />
  </main>;
}
