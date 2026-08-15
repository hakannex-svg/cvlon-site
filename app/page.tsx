/* eslint-disable @next/next/no-img-element -- vinext site uses pre-optimized responsive assets and picture sources. */
import { AogContactStrip } from "@/components/AogContactStrip";
import { CallAogAction, WhatsAppAogAction } from "@/components/AogActions";
import { MobileAogBar } from "@/components/MobileAogBar";
import { RfqForm } from "@/components/RfqForm";

const services = [
  {
    number: "01",
    title: "Global parts sourcing",
    body: "New, overhauled, serviceable and as-removed components sourced through OEM, repair-station and vetted surplus channels.",
  },
  {
    number: "02",
    title: "24/7 AOG response",
    body: "Urgent search, documentation review and same-day dispatch coordinated by a real person—not a voicemail queue.",
  },
  {
    number: "03",
    title: "Repair management",
    body: "Workscope, repair-station routing, turn-time negotiation and certification managed through one accountable contact.",
  },
];

const platforms = [
  "Beechcraft",
  "Cessna Citation",
  "Bombardier",
  "Dassault Falcon",
  "Embraer",
  "Gulfstream & more",
];

export default function Home() {
  return (
    <main>
      <header className="topbar">
        <div className="shell topbar-inner">
          <span><i /> 24/7 AOG DESK</span>
          <a href="tel:+19093444444">+1 909 344 4444</a>
          <span className="topbar-place">Englewood Cliffs, New Jersey</span>
          <a className="topbar-mail" href="mailto:sales@cvlon.com">sales@cvlon.com</a>
        </div>
      </header>

      <nav className="nav" aria-label="Main navigation">
        <div className="shell nav-inner">
          <a className="brand" href="#top" aria-label="Civilon Air home">
            <img src="/civilon-logo.svg" alt="Civilon Air" />
          </a>
          <div className="nav-links">
            <a href="#services">Services</a>
            <a href="#platforms">Aircraft</a>
            <a href="#quality">Quality</a>
            <a href="#company">Company</a>
          </div>
          <a className="nav-cta" href="#rfq">Start a part search <span>↗</span></a>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-photo" aria-hidden="true" />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-orbit orbit-one" aria-hidden="true" />
        <div className="hero-orbit orbit-two" aria-hidden="true" />
        <div className="shell hero-layout">
          <div className="hero-copy">
            <div className="eyebrow"><span>GLOBAL SOURCING</span><b>24/7 AOG</b></div>
            <h1>The right aircraft part.<br /><em>Certified and moving.</em></h1>
            <p>Civilon Air sources fully traceable business-aircraft components and coordinates urgent AOG delivery worldwide—from one accountable desk.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#rfq">Start a part search <span>→</span></a>
              <CallAogAction className="button button-ghost" source_page="homepage">Call AOG desk</CallAogAction>
              <WhatsAppAogAction className="button button-whatsapp" source_page="homepage">WhatsApp AOG</WhatsAppAogAction>
            </div>
            <div className="hero-proof">
              <div><strong>&lt; 1 hr</strong><span>Typical quote response</span></div>
              <div><strong>24 / 7 / 365</strong><span>Urgent AOG support</span></div>
              <div><strong>100%</strong><span>Trace documentation</span></div>
            </div>
          </div>

          <RfqForm sourcePage="homepage" />
        </div>
        <div className="hero-ticker">
          <div className="shell ticker-inner">
            <span>FAA 8130-3</span><i />
            <span>EASA FORM 1</span><i />
            <span>FULL TRACE</span><i />
            <span>WORLDWIDE DISPATCH</span><i />
            <span>VETTED SUPPLY CHAIN</span>
          </div>
        </div>
      </section>

      <section className="section services" id="services">
        <div className="shell">
          <div className="section-heading split-heading">
            <div><span className="section-label">CAPABILITY / 01</span><h2>One desk. Every step<br />from search to delivery.</h2></div>
            <p>We are a sourcing partner, not a webshop. Send the part number and we work the channels, verify the paperwork and coordinate delivery.</p>
          </div>
          <div className="service-feature">
            <div className="service-photo">
              {/* TODO(production): TEMPORARY IMAGE — replace parts-sourcing.webp with approved authentic Civilon sourcing/inspection photography before release. */}
              <img src="/parts-sourcing.webp" alt="Aircraft component being reviewed in a modern aviation parts facility" />
              <span>PARTS SOURCING / INSPECTION / DISPATCH</span>
            </div>
            <div className="service-note">
              <span className="section-label">ACCOUNTABLE FROM RFQ TO RECEIVING</span>
              <p>Every request stays with one sourcing desk through availability, condition review, documentation and delivery.</p>
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
                <a href="#rfq">Start a part search <span>→</span></a>
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
            <div className="quality-caption"><span>DOCUMENT CONTROL</span><strong>Every unit verified before release</strong></div>
          </div>
          <div className="quality-copy">
            <span className="section-label light">QUALITY / 02</span>
            <h2>The paperwork<br />is part of the part.</h2>
            <p>In aviation, documentation determines value. Civilon reviews condition, source and certification before a unit moves to your receiving dock.</p>
            <ul>
              <li><span>01</span> FAA 8130-3 or EASA Form 1 where applicable</li>
              <li><span>02</span> Clear NE, NS, OH, SV and AR condition codes</li>
              <li><span>03</span> Material certification and trace-to-source review</li>
              <li><span>04</span> Export and worldwide shipping coordination</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section platforms" id="platforms">
        <div className="shell">
          <div className="section-heading platform-heading">
            <div><span className="section-label">PLATFORMS / 03</span><h2>Built around business aviation.</h2></div>
            <p>Deep sourcing coverage across the aircraft your operation depends on.</p>
          </div>
          <div className="platform-list">
            {platforms.map((platform, index) => <a href="#rfq" key={platform}><span>0{index + 1}</span>{platform}<b>↗</b></a>)}
          </div>
        </div>
      </section>

      <AogContactStrip sourcePage="homepage" />

      <MobileAogBar sourcePage="homepage" />

      <footer id="company">
        <div className="shell footer-grid">
          <div>
            <a className="brand brand-footer" href="#top"><img src="/civilon-logo-dark.svg" alt="Civilon Air" /></a>
            <p>Business-aircraft parts sourcing, repair management and 24/7 AOG coordination from the New York metro area.</p>
          </div>
          <div><strong>Contact</strong><a href="mailto:sales@cvlon.com">sales@cvlon.com</a><a href="tel:+12019036461">+1 201 903 6461</a><span>Englewood Cliffs, NJ</span></div>
          <div><strong>Services</strong><a href="#services">Parts sourcing</a><a href="#services">AOG support</a><a href="#quality">Quality assurance</a></div>
          <div><strong>Response</strong><a className="footer-quote" href="#rfq">Start a part search →</a><span>Available 24/7 for AOG</span></div>
        </div>
        <div className="shell footer-bottom"><span>© 2026 Civilon Air. All rights reserved.</span><span>New Jersey · USA · Worldwide</span></div>
      </footer>
    </main>
  );
}
