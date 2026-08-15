/* eslint-disable @next/next/no-img-element -- vinext site uses pre-optimized responsive assets and picture sources. */
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

const whatsappAogUrl = "https://wa.me/19093444444?text=AOG%20request%3A%20I%20need%20urgent%20aircraft%20parts%20support.%20Please%20contact%20me%20as%20soon%20as%20possible.";

function FieldLabel({ htmlFor, children, required = false }: { htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return (
    <span className="field-label" id={`${htmlFor}-label`}>
      <span>{children}</span>
      {required && <span className="required-mark" aria-hidden="true">*</span>}
    </span>
  );
}

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
              <a className="button button-ghost" href="tel:+19093444444">Call AOG desk</a>
              <a className="button button-whatsapp" href={whatsappAogUrl} target="_blank" rel="noreferrer">WhatsApp AOG</a>
            </div>
            <div className="hero-proof">
              <div><strong>&lt; 1 hr</strong><span>Typical quote response</span></div>
              <div><strong>24 / 7 / 365</strong><span>Urgent AOG support</span></div>
              <div><strong>100%</strong><span>Trace documentation</span></div>
            </div>
          </div>

          <form className="quick-rfq" id="rfq" name="quick-rfq" method="POST" data-netlify="true">
            <input type="hidden" name="form-name" value="quick-rfq" />
            <div className="form-kicker"><span>RFQ</span> START A PART SEARCH</div>
            <h2>What do you need?</h2>
            <p>Send the basics. Our sourcing desk will follow up directly.</p>
            <label htmlFor="part-number">
              <FieldLabel htmlFor="part-number" required>Part number</FieldLabel>
              <input id="part-number" required aria-required="true" name="part-number" placeholder="e.g. 101-384025-5" />
            </label>
            <div className="field-row">
              <label htmlFor="quantity">
                <FieldLabel htmlFor="quantity">Quantity</FieldLabel>
                <input id="quantity" name="quantity" placeholder="1 EA" />
              </label>
              <label htmlFor="condition">
                <FieldLabel htmlFor="condition">Condition</FieldLabel>
                <select id="condition" name="condition" defaultValue="Any acceptable">
                  <option>Any acceptable</option>
                  <option>New</option>
                  <option>Overhauled</option>
                  <option>Serviceable</option>
                  <option>As removed</option>
                </select>
              </label>
            </div>
            <label htmlFor="email">
              <FieldLabel htmlFor="email" required>Email</FieldLabel>
              <input id="email" required aria-required="true" type="email" name="email" placeholder="name@company.com" />
            </label>
            <label className="aog-check" htmlFor="aog" aria-label="Mark this request as AOG">
              <input id="aog" type="checkbox" name="aog" />
              <span><strong>Aircraft on ground (AOG)</strong><small>Mark for immediate handling.</small></span>
            </label>
            <button type="submit">Request availability <span>→</span></button>
            <small className="privacy">Your request goes directly to the Civilon sourcing desk.</small>
          </form>
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

      <section className="aog-band">
        <div className="aog-photo" aria-hidden="true" />
        <div className="aog-overlay" aria-hidden="true" />
        <div className="shell aog-inner">
          <div><span className="live-dot" /> AIRCRAFT ON GROUND?</div>
          <h2>One call starts the search.</h2>
          <a href="tel:+19093444444">+1 909 344 4444 <span>→</span></a>
        </div>
      </section>

      <aside className="mobile-urgent" aria-label="Urgent AOG contact options">
        <a href="tel:+19093444444"><span>Call</span><strong>AOG desk</strong></a>
        <a className="mobile-whatsapp" href={whatsappAogUrl} target="_blank" rel="noreferrer"><span>WhatsApp</span><strong>Message AOG</strong></a>
      </aside>

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
