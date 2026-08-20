import { BUY_REQUEST_SOURCE_PAGE, SELL_SUBMISSION_PAGE } from "@/lib/marketplace/contract";
import { isSellSubmissionEnabled } from "@/lib/marketplace/feature";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { PUBLIC_CTA } from "@/lib/public-cta";

type HeroRoute = {
  key: string;
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
    title: "CHECK A PART PRICE",
    body: "Review a quoted or purchased aircraft part price using Civilon’s human-reviewed Price Check.",
    href: "/price-check",
    cta: PUBLIC_CTA.priceCheck,
  });

  routes.push({
    key: "buy",
    title: "BUY AN AIRCRAFT PART",
    body: "Send Civilon the part number, condition and delivery requirements.",
    href: BUY_REQUEST_SOURCE_PAGE,
    cta: PUBLIC_CTA.buy,
  });

  if (isSellSubmissionEnabled()) routes.push({
    key: "sell",
    title: "SELL AIRCRAFT PARTS",
    body: "Privately submit one aircraft part or a bulk inventory file to Civilon.",
    href: SELL_SUBMISSION_PAGE,
    cta: PUBLIC_CTA.sell,
  });

  return (
    <aside className="hero-decision-card" aria-labelledby="hero-decision-title">
      <span className="hero-decision-kicker">QUICK ROUTES</span>
      <h2 id="hero-decision-title">What do you need?</h2>
      <div className="hero-decision-routes">
        {routes.map((route) => (
          <section className="hero-decision-route" key={route.key}>
            <div>
              <h3>{route.title}</h3>
              <p>{route.body}</p>
            </div>
            <a href={route.href}>{route.cta} <span aria-hidden="true">→</span></a>
          </section>
        ))}
      </div>
    </aside>
  );
}
