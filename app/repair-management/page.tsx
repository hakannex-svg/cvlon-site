import { InteriorHero, ProcessSteps, RfqSection, SectionHeading } from "@/components/Interior";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Aircraft Component Repair Management",
  "Coordinate removed-unit intake, evaluation, workscope and quote review, monitoring, release-document review and return logistics.",
  "/repair-management",
);

export default function Page() {
  return <main>
    <InteriorHero
      eyebrow="SERVICES / REPAIR"
      title="Aircraft component repair management"
      intro="We manage the repair end to end—evaluation, workscope, quote, monitoring and return—through appropriately approved repair facilities where required."
      qualifier="The selected third-party facility performs the physical inspection, test, repair or overhaul; Civilon coordinates the commercial, documentation and logistics path."
      path="/repair-management"
      crumbs={[{label:"Home",href:"/"},{label:"Repair Management"}]}
      variant="sourcing"
      searchHref="#rfq"
      panelItems={["Part and serial number", "Removal reason and aircraft context", "Available records", "Required return timing"]}
    />

    <section className="section section-tight">
      <div className="shell">
        <SectionHeading label="PROCESS / 01" title="One desk through the repair cycle" />
        <ProcessSteps steps={[
          "Receive the removed unit and requirement",
          "Review removal information and available records",
          "Identify an appropriately approved repair facility",
          "Coordinate evaluation, teardown findings and workscope",
          "Review quotation, over-and-above findings and turnaround",
          "Obtain customer approval at commercial checkpoints",
          "Monitor progress and review release documentation",
          "Coordinate warranty follow-up and return shipment",
        ]} />
      </div>
    </section>

    <section className="section section-muted section-tight">
      <div className="shell two-column">
        <div>
          <SectionHeading label="DECISION SUPPORT / 02" title="Repair, exchange or replacement" />
          <ul className="technical-list">
            <li>Evaluation and workscope review</li>
            <li>Over-and-above findings</li>
            <li>Repair-versus-exchange comparison</li>
            <li>BER decision support</li>
            <li>Turn-time monitoring</li>
            <li>Warranty terms stated by source</li>
          </ul>
        </div>
        <div>
          <SectionHeading label="COMPONENT FAMILIES / 03" title="Typical repair requirements" />
          <ul className="technical-list">
            <li>Starter generators and accessories</li>
            <li>Fuel pumps, controls and valves</li>
            <li>Hydraulic actuators</li>
            <li>Wheels, brakes and landing-gear components</li>
            <li>Avionics and instruments</li>
            <li>ECS, pneumatics, lighting and transparencies</li>
          </ul>
        </div>
      </div>
    </section>

    <RfqSection
      sourcePage="/repair-management"
      heading="Send the removed-unit requirement."
      description="Include part and serial information, removal reason, available records, aircraft context and required return timing."
      supportingPoints={[
        "Civilon coordinates evaluation, quotation and progress updates",
        "You approve the work at each commercial checkpoint",
        "Civilon reviews release-document and return requirements before shipment",
      ]}
    />
  </main>;
}
