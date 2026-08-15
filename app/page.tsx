/* eslint-disable @next/next/no-img-element -- vinext site uses pre-optimized responsive assets and picture sources. */
import { CallAogAction, WhatsAppAogAction } from "@/components/AogActions";
import { RfqForm } from "@/components/RfqForm";

const services = [
  {
    number: "01",
    title: "Parts sourcing",
    body: "Selected items may be in stock; other requirements are sourced on demand through approved and vetted channels. Availability is subject to confirmation.",
  },
  {
    number: "02",
    title: "24/7 AOG coordination",
    body: "Our AOG phone and WhatsApp are monitored by a live person 24/7/365 for urgent search, documentation and transportation coordination.",
  },
  {
    number: "03",
    title: "Repair management",
    body: "Evaluation, workscope, quotation, monitoring and return logistics coordinated with appropriately approved third-party repair facilities.",
  },
];

const platforms = [
  ["Beechcraft", "/aircraft/beechcraft"],
  ["Cessna Citation", "/aircraft/cessna-citation"],
  ["Bombardier", "/aircraft/bombardier"],
  ["Dassault Falcon", "/aircraft/dassault-falcon"],
  ["Embraer", "/aircraft/embraer"],
  ["Gulfstream & more", "/aircraft#other-platforms"],
];

export default function Home() {
  return (
    <main>
      <section className="hero" id="top" data-mobile-aog-suppress>
        <div className="hero-photo" aria-hidden="true" />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-orbit orbit-one" aria-hidden="true" />
        <div className="hero-orbit orbit-two" aria-hidden="true" />
        <div className="shell hero-layout">
          <div className="hero-copy">
            <div className="eyebrow"><span>BUSINESS AIRCRAFT SOURCING</span><b>24/7 AOG</b></div>
            <h1>The right aircraft part.<br /><em>One accountable desk.</em></h1>
            <p>Civilon combines selected in-stock availability with on-demand sourcing, coordinating stated condition, available documentation and delivery requirements from one point of contact.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#rfq">Start a part search <span>→</span></a>
              <CallAogAction className="button button-ghost" source_page="homepage">Call AOG desk</CallAogAction>
              <WhatsAppAogAction className="button button-whatsapp" source_page="homepage">WhatsApp AOG</WhatsAppAogAction>
            </div>
            <div className="hero-proof">
              <div><strong>NE · NS</strong><span>New and new surplus</span></div>
              <div><strong>OH · SV</strong><span>Overhauled and serviceable</span></div>
              <div><strong>AR</strong><span>As removed</span></div>
            </div>
          </div>

          <RfqForm sourcePage="homepage" compactAog />
        </div>
        <div className="hero-ticker">
          <div className="shell ticker-inner">
            <span>FAA 8130-3 / EASA Form 1 where applicable</span><i />
            <span>TRACE-TO-SOURCE REVIEW</span><i />
            <span>CONDITIONAL AVAILABILITY</span><i />
            <span>APPROVED & VETTED SUPPLIERS</span>
          </div>
        </div>
      </section>

      <section className="section services" id="services">
        <div className="shell">
          <div className="section-heading split-heading">
            <div><span className="section-label">CAPABILITY / 01</span><h2>One desk. Every step<br />from search to delivery.</h2></div>
            <p>We are a sourcing partner, not a webshop. Send the part number, quantity, aircraft context, acceptable condition and documentation requirement.</p>
          </div>
          <div className="service-feature">
            <div className="service-photo">
              {/* TODO(production): TEMPORARY IMAGE — replace parts-sourcing.webp with approved authentic Civilon sourcing/inspection photography before release. */}
              <img src="/parts-sourcing.webp" alt="Aircraft component being reviewed in a modern aviation parts facility" />
              <span>PARTS SOURCING / INSPECTION / DISPATCH</span>
            </div>
            <div className="service-note">
              <span className="section-label">ACCOUNTABLE FROM RFQ TO RECEIVING</span>
              <p>Each quotation identifies confirmed availability, stated condition, warranty terms and the release or supporting documentation available where applicable.</p>
              <a href="#rfq">Start a part search <b>→</b></a>
            </div>
          </div>
          <div className="service-grid">
            {services.map((service) => (
              <article className="service-card" key={service.number}>
                <span className="card-number">{service.number}</span>
                <div className="card-icon" aria-hidden="true">✦</div>
                <h3>{service.title}</h3>
                <p>{service.body}</p>
                <a href={service.number === "01" ? "/parts" : service.number === "02" ? "/aog-services" : "/repair-management"}>Learn more <span>→</span></a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section quality" id="quality">
        <div className="shell quality-layout">
          <div className="quality-visual">
            {/* TODO(production): TEMPORARY IMAGE — replace quality-inspection.webp with an approved authentic 3:2 aviation MRO inspection/documentation photo before release. */}
            <picture>
              <source srcSet="/quality-inspection.avif" type="image/avif" />
              <source srcSet="/quality-inspection.webp" type="image/webp" />
              <img src="/quality-inspection.jpg" width="1536" height="1024" alt="Aviation quality inspector measuring a metallic aircraft component" />
            </picture>
            <div className="quality-caption"><span>DOCUMENT CONTROL</span><strong>Records identified with each quotation</strong></div>
          </div>
          <div className="quality-copy">
            <span className="section-label light">QUALITY / 02</span>
            <h2>The paperwork<br />is part of the part.</h2>
            <p>Condition terms and supporting-document expectations are not interchangeable. Civilon reviews the stated condition, trace-to-source and available records for each quoted option.</p>
            <ul>
              <li><span>01</span> FAA 8130-3 or EASA Form 1 where applicable</li>
              <li><span>02</span> Clear NE, NS, OH, SV and AR condition codes</li>
              <li><span>03</span> Material certification and trace-to-source where available</li>
              <li><span>04</span> Shipping and export-document coordination subject to requirements</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section platforms" id="platforms">
        <div className="shell">
          <div className="section-heading platform-heading">
            <div><span className="section-label">PLATFORMS / 03</span><h2>Built around business aviation.</h2></div>
            <p>Primary support for established business-aircraft fleets, with additional platforms reviewed by exact requirement.</p>
          </div>
          <div className="platform-list">
            {platforms.map(([platform, href], index) => <a href={href} key={platform}><span>0{index + 1}</span>{platform}<b>↗</b></a>)}
          </div>
        </div>
      </section>

    </main>
  );
}
