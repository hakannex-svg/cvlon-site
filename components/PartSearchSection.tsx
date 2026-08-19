import { RfqSection } from "@/components/Interior";
import { BuyRequestPanel } from "@/components/BuyRequestPanel";
import { isMarketplaceEnabled } from "@/lib/marketplace/feature";

type PartSearchSectionProps = React.ComponentProps<typeof RfqSection>;

/**
 * The ordinary parts-sourcing section on a public page.
 *
 * With Buy intake open it routes the visitor into the Buy Request flow, so an
 * ordinary part search reaches the database, the admin queue and the
 * email-verification workflow instead of the legacy Netlify form. With the
 * marketplace flag off there is no Buy Request page to route to, so the legacy
 * section renders exactly as before, with the props it always received.
 *
 * It keeps id="rfq" in both states: every existing in-page "Start a part
 * search" anchor on these pages points at it, and an anchor that resolves to
 * nothing is worse than one that resolves to the routing panel.
 *
 * Service-specific intake — urgent AOG, repair management, documentation-only
 * requests — deliberately does not come through here. Those requests do not fit
 * the Buy Request schema, so those pages keep RfqSection directly.
 */
export function PartSearchSection(props: PartSearchSectionProps) {
  if (!isMarketplaceEnabled()) return <RfqSection {...props} />;

  const {
    eyebrow = "START / PART SEARCH",
    heading = "Tell the sourcing desk what you need.",
    description = "Send the part number and the details you know. Civilon reviews the requirement and sources the part.",
    supportingPoints = [],
  } = props;

  return <section className="section rfq-section part-search-section" id="rfq">
    <div className="shell rfq-layout">
      <div>
        <span className="section-label">{eyebrow}</span>
        <h2>{heading}</h2>
        <p>{description}</p>
        {supportingPoints.length > 0 && <ul className="rfq-points">{supportingPoints.map((point) => <li key={point}>{point}</li>)}</ul>}
      </div>
      <BuyRequestPanel headingLevel="h3" headingId="part-search-buy-request" />
    </div>
  </section>;
}
