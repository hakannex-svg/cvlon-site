"use client";

import { useEffect } from "react";
import { trackCivilonEvent } from "@/lib/analytics";
import { MARKETPLACE_HUB_PAGE } from "@/lib/marketplace/contract";

/**
 * The hub cards.
 *
 * Selling opens only when the server says its own flag is on. Until then the
 * card stays a controlled preview with no form and no submission path: a card
 * that looked like a working intake but silently discarded a supplier's
 * inventory would be worse than no card at all. The flag is resolved on the
 * server and passed in, because a client-side read of a public env var would
 * make the card's state a build artefact rather than a deploy decision.
 *
 * Price Check is the third card, under its own independent flag. It belongs
 * here because a visitor holding a supplier quote arrives asking a question
 * neither Buy nor Sell answers; it carries no analytics of its own, because a
 * click on it says nothing the hub view event does not already record.
 */
export function MarketplaceHubView({ sellEnabled = false, priceCheckEnabled = false }: { sellEnabled?: boolean; priceCheckEnabled?: boolean }) {
  useEffect(() => {
    trackCivilonEvent("buy_sell_hub_view", { source_page: MARKETPLACE_HUB_PAGE });
  }, []);

  return (
    <div className={`marketplace-choice-grid${priceCheckEnabled ? " choice-grid-three" : ""}`}>
      <article className="marketplace-choice is-open">
        <span className="marketplace-choice-index">01</span>
        <h3>Buy a Part from Civilon</h3>
        <p>
          Send the part number—or describe the part if you do not have one—and
          Civilon reviews and sources it. No account, no sign-in.
        </p>
        <ul>
          <li>Part number or plain description</li>
          <li>Condition and urgency as you state them</li>
          <li>One reference to follow the request</li>
        </ul>
        <a
          className="button button-primary"
          href="/buy-sell-aircraft-parts/buy"
          onClick={() => trackCivilonEvent("buy_request_start", {
            source_page: MARKETPLACE_HUB_PAGE,
            cta_location: "hub_buy_card",
          })}
        >
          Request a part <span aria-hidden="true">→</span>
        </a>
      </article>

      {sellEnabled ? (
        <article className="marketplace-choice is-open">
          <span className="marketplace-choice-index">02</span>
          <h3>Sell Parts to Civilon</h3>
          <p>
            Civilon buys parts and inventory on its own account. Offer a single
            part or a whole list. No account, no sign-in, and nothing you send is
            published or listed.
          </p>
          <ul>
            <li>Single parts or bulk inventory</li>
            <li>Pricing on request is normal; no listing is published</li>
            <li>Reviewed internally by the Civilon team</li>
          </ul>
          <a
            className="button button-primary"
            href="/buy-sell-aircraft-parts/sell"
            onClick={() => trackCivilonEvent("sell_submission_start", {
              source_page: MARKETPLACE_HUB_PAGE,
              cta_location: "hub_sell_card",
            })}
          >
            Offer parts to Civilon <span aria-hidden="true">→</span>
          </a>
        </article>
      ) : (
        <article className="marketplace-choice is-preview">
          <span className="marketplace-choice-index">02</span>
          <p className="marketplace-choice-status">Controlled preview — coming next</p>
          <h3>Sell Parts to Civilon</h3>
          <p>
            Civilon buys parts and inventory on its own account. Online submission
            is being introduced with a small group of suppliers first and is not
            open here yet.
          </p>
          <ul>
            <li>Single parts or bulk inventory</li>
            <li>Pricing on request; no listing is published</li>
            <li>Handled directly by the Civilon team today</li>
          </ul>
          <a
            className="button button-ghost"
            href="/contact-us"
            onClick={() => trackCivilonEvent("buy_sell_hub_view", {
              source_page: MARKETPLACE_HUB_PAGE,
              cta_location: "hub_sell_card",
            })}
          >
            Contact the Civilon team <span aria-hidden="true">→</span>
          </a>
        </article>
      )}

      {priceCheckEnabled && (
        <article className="marketplace-choice is-open">
          <span className="marketplace-choice-index">03</span>
          <h3>Check a quoted or purchased price</h3>
          <p>
            Neither buying nor selling yet? If you already hold a supplier quote
            or have already bought the part, Civilon reviews the transaction
            against available comparable evidence and returns a confidential,
            human-reviewed Price Check.
          </p>
          <ul>
            <li>Informational and human-reviewed</li>
            <li>Not an appraisal, an instant result or a price guarantee</li>
            <li>The result stays private to you</li>
          </ul>
          <a className="button button-ghost" href="/price-check">
            Check a part price <span aria-hidden="true">→</span>
          </a>
        </article>
      )}
    </div>
  );
}
