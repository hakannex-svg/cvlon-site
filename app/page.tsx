/* eslint-disable @next/next/no-img-element -- vinext site uses pre-optimized responsive assets and picture sources. */
import { CallAogAction, WhatsAppAogAction } from "@/components/AogActions";
import { RfqForm } from "@/components/RfqForm";
import { HeroDecisionRouter } from "@/components/HeroDecisionRouter";
import { PriceCheckPromotion } from "@/components/PriceCheckPromotion";
import { isMarketplaceEnabled } from "@/lib/marketplace/feature";
import { LEGACY_PART_SEARCH_ANCHOR, partSearchHref } from "@/lib/part-search-cta";
import { PUBLIC_CTA } from "@/lib/public-cta";

const services = [
  {
    number: "01",
    title: "Parts sourcing",
    body: "Stock when we have it; targeted sourcing when we don’t, through approved and vetted suppliers.",
    href: "/parts",
    cta: "View categories",
  },
  {
    number: "02",
    title: "24/7 AOG coordination",
    body: "A live person coordinates the urgent search, documentation and transportation through one accountable desk.",
    href: "/aog-services",
    cta: "Review AOG support",
  },
  {
    number: "03",
    title: "Repair management",
    body: "We manage the repair end to end—evaluation, workscope, quote, monitoring and return—through appropriately approved repair facilities where required.",
    href: "/repair-management",
    cta: "Review service",
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
  // With Buy intake open an ordinary part search is a Buy Request, and the
  // homepage stops presenting the legacy Netlify form as the primary intake.
  // With the marketplace flag off the form remains the only intake there is.
  const buyRequestIntake = isMarketplaceEnabled();
  const searchHref = partSearchHref(LEGACY_PART_SEARCH_ANCHOR);

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
            <p>Stock when we have it, sourcing when we don’t—condition, paperwork and delivery handled by one accountable desk.</p>
            <div className="hero-actions">
              <a className="button button-primary" href={searchHref}>{PUBLIC_CTA.buy} <span>→</span></a>
              <CallAogAction className="button button-ghost" source_page="homepage">{PUBLIC_CTA.callAog}</CallAogAction>
              <WhatsAppAogAction className="button button-tertiary" source_page="homepage">{PUBLIC_CTA.whatsAppAog} <span aria-hidden="true">→</span></WhatsAppAogAction>
            </div>
            <p className="hero-aog-assurance">The AOG line is answered by a live person, 24/7/365.</p>
            <div className="hero-proof">
              <div><strong>NE · NS</strong><span>New and new surplus</span></div>
              <div><strong>OH · SV</strong><span>Overhauled and serviceable</span></div>
              <div><strong>AR</strong><span>As removed</span></div>
            </div>
          </div>

          {buyRequestIntake
            ? <HeroDecisionRouter />
            : <RfqForm sourcePage="homepage" compactAog />}
        </div>
        <div className="hero-ticker">
          <div className="shell ticker-inner">
            <span>FAA 8130-3 / EASA Form 1 where applicable</span><i />
            <span>TRACE-TO-SOURCE REVIEW</span><i />
            <span>APPROVED & VETTED SUPPLIERS</span>
          </div>
        </div>
      </section>

      <section className="section services" id="services">
        <div className="shell">
          <div className="section-heading split-heading">
            <div><span className="section-label">CAPABILITY / 01</span><h2>One desk. Every step<br />from search to delivery.</h2></div>
            <p>Civilon is the seller and accountable point of contact. Buyer and supplier remain separated while our desk coordinates the requirement from RFQ through delivery.</p>
          </div>
          <div className="service-feature">
            <div className="service-photo">
              {/* TODO(production): TEMPORARY IMAGE — replace parts-sourcing.webp with approved authentic Civilon sourcing/inspection photography before release. */}
              <img src="/parts-sourcing.webp" alt="Aircraft component being reviewed in a modern aviation parts facility" />
              <span>PARTS SOURCING / INSPECTION / DISPATCH</span>
            </div>
            <div className="service-note">
              <span className="section-label">ACCOUNTABLE FROM RFQ TO RECEIVING</span>
              <p>Each quotation brings condition, warranty terms, supporting records and delivery requirements into one accountable path.</p>
              <a href={searchHref}>{PUBLIC_CTA.buy} <b>→</b></a>
            </div>
          </div>
          <div className="service-grid">
            {services.map((service) => (
              <a className="service-card" href={service.href} key={service.number}>
                <span className="card-number">{service.number}</span>
                <div className="card-icon" aria-hidden="true">✦</div>
                <h3>{service.title}</h3>
                <p>{service.body}</p>
                <strong className="service-card-action">{service.cta} <span aria-hidden="true">→</span></strong>
              </a>
            ))}
          </div>
          <p className="section-qualifier">Each option is confirmed for availability, together with the documentation supplied with it.</p>
        </div>
      </section>

      <section className="section section-muted section-tight home-about">
        <div className="shell two-column">
          <div className="section-heading"><span className="section-label">WHO WE ARE</span><h2>Built to be accountable.</h2></div>
          <div><p className="large-copy">Civilon is an independent parts-sourcing desk in Englewood Cliffs, New Jersey, established in 2012 — a team drawn from aviation sourcing and freight logistics. When you buy through Civilon, Civilon is the seller: one desk accountable for the part, the paperwork and the delivery.</p><a className="button button-outline" href="/about-us">About Civilon</a></div>
        </div>
      </section>

      <PriceCheckPromotion />

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
            <p>Condition terms and supporting records are not interchangeable. Civilon reviews the stated condition, trace-to-source and records behind each quoted option.</p>
            <ul>
              <li><span>01</span> Release documents identified with the quotation</li>
              <li><span>02</span> Clear NE, NS, OH, SV and AR condition codes</li>
              <li><span>03</span> Material records and trace-to-source review</li>
              <li><span>04</span> Shipping and export-document coordination</li>
            </ul>
            <p className="section-qualifier section-qualifier-dark">FAA 8130-3, EASA Form 1 and other records are provided where applicable and available; export support depends on destination and requirements.</p>
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
