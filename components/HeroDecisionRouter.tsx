import { BUY_REQUEST_SOURCE_PAGE, SELL_SUBMISSION_PAGE } from "@/lib/marketplace/contract";
import { isSellSubmissionEnabled } from "@/lib/marketplace/feature";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { PUBLIC_CTA } from "@/lib/public-cta";

type HeroRoute = {
  key: string;
  chip: string;
  title: string;
  body: string;
  href: string;
  cta: string;
};

/** A compact route selector; each destination keeps its own dedicated intake. */
export function HeroDecisionRouter() {
  const routes: HeroRoute[] = [];

  if (isPriceCheckEnabled()) routes.push({
    key: "price-check",
    chip: "PRICE CHECK",
    title: "Check a part price",
    body: "Review a quoted or purchased aircraft-part price against comparable evidence.",
    href: "/price-check",
    cta: PUBLIC_CTA.priceCheck,
  });

  routes.push({
    key: "buy",
    chip: "RFQ",
    title: "Buy a part",
    body: "Send the part number, condition and delivery requirements directly to Civilon.",
    href: BUY_REQUEST_SOURCE_PAGE,
    cta: PUBLIC_CTA.buy,
  });

  if (isSellSubmissionEnabled()) routes.push({
    key: "sell",
    chip: "SELL",
    title: "Offer parts to Civilon",
    body: "Privately offer one aircraft part or a bulk inventory file to Civilon.",
    href: SELL_SUBMISSION_PAGE,
    cta: PUBLIC_CTA.sell,
  });

  return (
    <aside className="hero-decision-card" aria-labelledby="hero-decision-title">
      <span className="hero-decision-kicker">QUICK ROUTES</span>
      <h2 id="hero-decision-title">Start here.</h2>
      <div className="hero-decision-routes">
        {routes.map((route) => (
          <section className="hero-decision-route" key={route.key}>
            <div className="hero-decision-route-head">
              <span className="hero-decision-chip" aria-hidden="true">{route.chip}</span>
              <h3>{route.title}</h3>
            </div>
            <div className="hero-decision-route-body">
              <p>{route.body}</p>
              <a href={route.href}>{route.cta} <span aria-hidden="true">→</span></a>
            </div>
          </section>
        ))}
      </div>
      <p className="hero-decision-qualifier">Nothing is publicly listed. Availability and documentation are confirmed per request.</p>
    </aside>
  );
}
