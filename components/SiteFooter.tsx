/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element -- plain anchors preserve vinext navigation and the supplied SVG asset. */
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { isMarketplaceEnabled } from "@/lib/marketplace/feature";
import { siteConfig } from "@/lib/site-config";
import { partSearchHref } from "@/lib/part-search-cta";
import { PrivacyChoicesButton } from "@/components/ConsentPreferences";

export function SiteFooter() {
  const priceCheckEnabled = isPriceCheckEnabled();
  const marketplaceEnabled = isMarketplaceEnabled();
  // Same resolution as the header: Buy Request where Buy intake is open, the
  // legacy contact anchor only while the marketplace flag is off.
  const searchHref = partSearchHref();
  return <footer><div className="shell footer-grid"><div><a className="brand brand-footer" href="/"><img src="/civilon-logo-dark.svg" alt="Civilon"/></a><p>Business-aircraft parts sourcing, repair management and AOG coordination from Englewood Cliffs, New Jersey.</p></div><div><strong>Contact</strong><a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a><a href={`tel:${siteConfig.officeTel}`}>Office & AOG: {siteConfig.officePhone}</a><span>375 Sylvan Ave, Suite 23<br/>Englewood Cliffs, NJ 07632</span></div><div><strong>Services</strong><a href="/parts">Parts sourcing</a>{marketplaceEnabled && <a href="/buy-sell-aircraft-parts">Buy &amp; sell aircraft parts</a>}{priceCheckEnabled && <a href="/price-check">Aircraft Part Price Check</a>}<a href="/aog-services">AOG support</a><a href="/repair-management">Repair management</a></div><div><strong>Company</strong><a href="/quality-assurance">Quality assurance</a><a href="/about-us">About Civilon</a><a href="/contact-us">Contact</a><a href="/privacy-policy">Privacy Policy</a><a href="/terms-of-use">Terms of Use</a><PrivacyChoicesButton /><a className="footer-quote" href={searchHref}>Start a part search →</a></div></div><div className="shell footer-bottom"><span>© 2026 Civilon LLC. All rights reserved.</span><span>Worldwide coordination, subject to destination and compliance requirements.</span></div></footer>;
}
