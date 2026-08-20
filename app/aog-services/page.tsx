import { InteriorHero, ProcessSteps, RfqSection, SectionHeading } from "@/components/Interior";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Aircraft AOG Parts Coordination",
  "Call, WhatsApp or send an AOG request with part number, aircraft location, condition, required-by time and documentation needs.",
  "/aog-services",
);

export default function Page() {
  return <main>
    <InteriorHero
      eyebrow="URGENT / AOG"
      title="Aircraft-on-ground parts coordination"
      intro="The AOG line is answered by a live person, 24/7/365. One accountable desk carries the requirement through search, documentation and delivery."
      path="/aog-services"
      crumbs={[{label:"Home",href:"/"},{label:"AOG Support"}]}
      variant="aog"
    />
    <RfqSection
      sourcePage="/aog-services"
      defaultAog
      compact
      heading="Start the urgent request."
      description="Call or send a WhatsApp message first, then use the form to share the operational details Civilon needs to continue the search."
    />
    <section className="section section-tight aog-preparation">
      <div className="shell two-column">
        <div className="preparation-panel">
          <SectionHeading
            label="BEFORE YOU CONTACT US / 01"
            title="Prepare these details"
            intro="Share what is known now. Missing information can follow as the requirement develops."
          />
          <ul className="technical-checklist">
            <li>Exact part and dash number</li>
            <li>Quantity and acceptable condition</li>
            <li>Aircraft type and tail reference</li>
            <li>Aircraft location</li>
            <li>Required-by date and time</li>
            <li>Required release and supporting documentation</li>
          </ul>
        </div>
        <div className="preparation-panel">
          <SectionHeading
            label="DELIVERY PLANNING / 02"
            title="Delivery and approval details"
            intro="These contacts and routing constraints help us coordinate the customer-approved shipment path."
          />
          <ul className="technical-checklist">
            <li>Destination and ship-to address</li>
            <li>Customs or import contact where applicable</li>
            <li>Person authorized to approve the option</li>
            <li>Carrier or routing restrictions</li>
            <li>Contact for progress updates</li>
          </ul>
        </div>
      </div>
    </section>
    <section className="section section-muted section-tight">
      <div className="shell">
        <SectionHeading label="PROCESS / 03" title="What happens after initial contact" />
        <ProcessSteps steps={[
          "Confirm the requirement, location and urgency",
          "Review selected stock and applicable sourcing channels",
          "Identify stated condition and available documentation",
          "Present availability, commercial terms and routing options",
          "Coordinate the customer-approved shipment path and updates",
        ]} />
        <p>Civilon can coordinate same-day dispatch, next-flight-out, counter-to-counter, dedicated courier or hand-carry, depending on route, cutoff, flight availability, carrier acceptance and customer approval.</p>
        <p className="section-qualifier">Civilon does not guarantee a shipping method or an arrival time.</p>
      </div>
    </section>
    <section className="section section-tight">
      <div className="shell">
        <SectionHeading label="INTERNATIONAL / 04" title="Export and import responsibilities" />
        <p className="large-copy">Civilon coordinates international shipment and export requirements subject to destination, transaction and compliance requirements. When Civilon acts as exporter of record, it may coordinate AES/EEI and applicable export screening. Destination import clearance remains the responsibility of the importer or consignee.</p>
      </div>
    </section>
  </main>;
}
