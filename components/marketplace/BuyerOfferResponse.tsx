"use client";

import { useEffect, useRef, useState } from "react";
import {
  BUYER_OFFER_FRAGMENT_KEY,
  BUYER_OFFER_PAGE_PATH,
  BUYER_OFFER_RESPOND_API_PATH,
  BUYER_OFFER_VIEW_API_PATH,
  type BuyerOfferCustomerStatus,
  type BuyerOfferDecision,
  type BuyerOfferRespondResponse,
  type BuyerOfferViewResponse,
} from "@/lib/marketplace/buyer-offer-contract";
import type { BuyerOfferSnapshot } from "@/lib/marketplace/buyer-offer-snapshot";

type Stage = "reading" | "loading" | "ready" | "responding" | "unavailable";

const deliveryLabels: Record<string, string> = {
  door_delivery: "Delivery to your door",
  port_of_entry: "Port of entry",
  nj_pickup: "Pickup from Civilon New Jersey",
  not_determined: "To be confirmed",
};

function display(value: string | number | null, fallback = "To be confirmed") {
  return value === null || value === "" ? fallback : String(value);
}

export function BuyerOfferResponse() {
  const token = useRef("");
  const initialized = useRef(false);
  const [stage, setStage] = useState<Stage>("reading");
  const [offer, setOffer] = useState<BuyerOfferSnapshot | null>(null);
  const [status, setStatus] = useState<BuyerOfferCustomerStatus | null>(null);
  const [retryable, setRetryable] = useState(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const fragment = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const value = new URLSearchParams(fragment).get(BUYER_OFFER_FRAGMENT_KEY) ?? "";
    if (window.location.hash) window.history.replaceState(null, "", BUYER_OFFER_PAGE_PATH);
    token.current = value;
    if (!value) {
      queueMicrotask(() => setStage("unavailable"));
      return;
    }
    void fetch(BUYER_OFFER_VIEW_API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: value }),
    }).then(async (response) => await response.json() as BuyerOfferViewResponse)
      .then((result) => {
        if (!result.ok) {
          token.current = "";
          setStage("unavailable");
          return;
        }
        setOffer(result.offer);
        setStatus(result.status);
        setStage("ready");
      })
      .catch(() => {
        setRetryable(true);
        setStage("unavailable");
      });
  }, []);

  async function respond(decision: BuyerOfferDecision) {
    if (!token.current || !offer || status !== "awaiting_response") return;
    setRetryable(false);
    setStage("responding");
    try {
      const response = await fetch(BUYER_OFFER_RESPOND_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.current, decision }),
      });
      const result = await response.json() as BuyerOfferRespondResponse;
      if (!result.ok) {
        token.current = "";
        setStage("unavailable");
        return;
      }
      token.current = "";
      setStatus(result.status);
      setStage("ready");
    } catch {
      setRetryable(true);
      setStage("ready");
    }
  }

  if (stage === "reading" || stage === "loading") {
    return <div className="marketplace-verify-panel" role="status"><p>Loading Civilon&apos;s offer…</p></div>;
  }

  if (stage === "unavailable" || !offer || !status) {
    return <div className="marketplace-verify-panel is-unavailable" role="status">
      <span className="section-label">OFFER / UNAVAILABLE</span>
      <h2>This offer link cannot be used.</h2>
      <p>The offer may have expired, been replaced or withdrawn, or the link may be incomplete.</p>
      {retryable ? <p className="field-error">The offer could not be loaded. Check your connection and reopen the email link.</p> : null}
      <a className="button button-primary" href="/contact-us">Contact Civilon</a>
    </div>;
  }

  const decided = status === "accepted" || status === "declined";
  return <div className={`marketplace-verify-panel buyer-offer-panel${status === "accepted" ? " is-verified" : ""}`}>
    <span className="section-label">CIVILON OFFER / VERSION {offer.version}</span>
    <h2>{decided ? `You ${status} this offer.` : "Review Civilon's offer."}</h2>
    <p>Reference <strong>{offer.reference}</strong></p>
    <dl className="buyer-offer-terms">
      <div><dt>Civilon unit price</dt><dd>{offer.saleUnitPrice} {offer.currencyCode}</dd></div>
      <div><dt>Quantity</dt><dd>{offer.quantity}</dd></div>
      <div><dt>Stated condition</dt><dd>{display(offer.statedCondition)}</dd></div>
      <div><dt>Delivery</dt><dd>{deliveryLabels[offer.deliveryOption] ?? offer.deliveryOption}</dd></div>
      <div><dt>Lead time</dt><dd>{offer.leadTimeDays === null ? "To be confirmed" : `${offer.leadTimeDays} days`}</dd></div>
      <div><dt>Expires</dt><dd>{offer.expiresAt ? new Date(offer.expiresAt).toLocaleString() : "—"}</dd></div>
      <div className="full"><dt>Documentation summary</dt><dd>{display(offer.documentsSummary)}</dd></div>
      <div className="full"><dt>Shipping and export scope</dt><dd>{display(offer.shippingAndExportScope)}</dd></div>
    </dl>
    <div className="pc-final-note" role="note"><strong>Important limits</strong><p>{offer.disclosure}</p><p>Where repair work is required, Civilon coordinates with appropriately approved repair facilities.</p></div>
    {decided ? <p role="status">Civilon recorded your response and will contact you about the next steps.</p> : <>
      {retryable ? <p className="field-error" role="alert">Your response may not have reached Civilon. Check your connection and try the same response again.</p> : null}
      <div className="buyer-offer-response-actions">
        <button className="pc-next" type="button" disabled={stage === "responding"} onClick={() => void respond("accepted")}>Accept Civilon offer</button>
        <button className="button button-ghost" type="button" disabled={stage === "responding"} onClick={() => void respond("declined")}>Decline</button>
      </div>
      <small className="field-help">Responding does not create an account and no payment is taken on this page. Civilon will contact you to confirm fulfilment, shipping/export and next steps.</small>
    </>}
  </div>;
}
