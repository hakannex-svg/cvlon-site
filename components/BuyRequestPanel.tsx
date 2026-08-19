import { BUY_REQUEST_SOURCE_PAGE } from "@/lib/marketplace/contract";

type BuyRequestPanelProps = {
  /** Dark for the homepage hero, light for a section on an interior page. */
  tone?: "dark" | "light";
  /** The section that hosts the panel already owns an h2 on interior pages. */
  headingLevel?: "h2" | "h3";
  headingId: string;
};

/**
 * The compact entry point into the admin-backed Buy Request flow.
 *
 * It replaces the legacy Netlify quick-rfq form as the ordinary part-search
 * intake wherever Buy intake is open. It is deliberately a panel and a link
 * rather than a second form: the Buy Request page is the one intake that
 * reaches the database, the admin queue and the email-verification workflow,
 * and duplicating its fields here would mean two intakes to keep in step.
 */
export function BuyRequestPanel({ tone = "light", headingLevel = "h2", headingId }: BuyRequestPanelProps) {
  const Heading = headingLevel;
  return (
    <aside className={`buy-request-panel tone-${tone}`} aria-labelledby={headingId}>
      <span className="buy-request-panel-kicker">BUY REQUEST</span>
      <Heading id={headingId}>Ask Civilon to source the part</Heading>
      <p>
        Send the part number—or describe the part if you do not have one—and
        Civilon reviews and sources it. No account, no sign-in. You confirm your
        email address once and keep one reference to follow the request.
      </p>
      <ul>
        <li>Reviewed by the Civilon team; nothing is published or listed</li>
        <li>Availability, stated condition, documentation, delivery and price remain subject to confirmation</li>
        <li>Documentation varies by part and source</li>
      </ul>
      <a className="button button-primary" href={BUY_REQUEST_SOURCE_PAGE}>
        Start a Buy Request <span aria-hidden="true">→</span>
      </a>
      <a className="buy-request-panel-link" href="/aog-services">
        Aircraft on ground? Use the monitored AOG desk <span aria-hidden="true">→</span>
      </a>
    </aside>
  );
}
