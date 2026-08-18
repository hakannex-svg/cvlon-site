"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BUYER_OFFER_DISCLOSURE,
  buyerOfferConditionCodes,
  buyerOfferCurrencies,
  buyerOfferDeliveryOptions,
  buyerOfferTargets,
} from "@/db/price-check/domain/buyer-offer-policy";

/**
 * Civilon's offer to the buyer.
 *
 * The sale price is typed in by a staff member. There is no markup field, no
 * supplier cost shown anywhere on this form, and no arithmetic between the two:
 * the commercial rule's basis is not yet settled, and a guessed formula would
 * quote a customer a number nobody approved.
 *
 * Marking an offer sent records that a staff member says they sent it by their
 * own means. Nothing here e-mails anyone.
 */

type SupplierOption = { id: string; label: string; status: string };
type OfferRow = { id: string; version: number; status: string };

const deliveryLabels: Record<string, string> = {
  door_delivery: "Delivery to the buyer's door",
  port_of_entry: "Port of entry",
  nj_pickup: "Pickup from Civilon New Jersey",
  not_determined: "Not determined yet",
};

const statusLabels: Record<string, string> = {
  draft: "Draft", sent: "Sent (recorded by staff)", accepted: "Accepted by buyer",
  declined: "Declined by buyer", expired: "Expired", superseded: "Superseded", withdrawn: "Withdrawn",
};

export function BuyerOfferActions({ buyRequestId, supplierOptions, offers }: {
  buyRequestId: string;
  supplierOptions: readonly SupplierOption[];
  offers: readonly OfferRow[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const base = `/api/admin/marketplace/buy-requests/${buyRequestId}/buyer-offers`;
  const openOffer = offers.find((offer) => offer.status === "draft" || offer.status === "sent");

  async function post(action: string, url: string, body: unknown, success: string, reset?: () => void) {
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "That action could not be completed.");
        return;
      }
      setNotice(success);
      reset?.();
      router.refresh();
    } catch {
      setError("That action could not be completed.");
    } finally {
      setPending(null);
    }
  }

  function submitOffer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (key: string) => {
      const raw = String(data.get(key) ?? "").trim();
      return raw || undefined;
    };
    void post("draft", base, {
      civilonSaleUnitPrice: text("civilonSaleUnitPrice"),
      currencyCode: text("currencyCode"),
      quantity: text("quantity"),
      statedCondition: text("statedCondition"),
      documentsSummary: text("documentsSummary"),
      deliveryOption: text("deliveryOption"),
      shippingAndExportScope: text("shippingAndExportScope"),
      leadTimeDays: text("leadTimeDays"),
      expiresAt: text("expiresAt"),
      selectedSupplierResponseId: text("selectedSupplierResponseId"),
    }, "Offer drafted.", () => form.reset());
  }

  const busy = pending !== null;

  return <div className="admin-offer-actions">
    {error ? <p className="admin-error" role="alert">{error}</p> : null}
    {notice ? <p className="admin-success" role="status">{notice}</p> : null}

    <details className="admin-details-action">
      <summary><span>
        <b>Draft a Civilon offer</b>
        <small>Civilon&apos;s own sale price and a buyer-facing delivery option. A new draft replaces an unsent working draft. An offer already sent stays active until this one is explicitly marked sent — only then is the earlier version superseded. Accepted history is never rewritten.</small>
      </span></summary>
      <form className="admin-form-grid" onSubmit={submitOffer}>
        <label>
          <span>Civilon sale price, per unit <em>Required. Entered explicitly, not calculated.</em></span>
          <input name="civilonSaleUnitPrice" inputMode="decimal" disabled={busy} required />
        </label>
        <label>
          <span>Currency <em>Required</em></span>
          <select name="currencyCode" defaultValue="USD" disabled={busy} required>
            {buyerOfferCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label><span>Quantity <em>Required</em></span><input name="quantity" inputMode="decimal" disabled={busy} required /></label>
        <label>
          <span>Stated condition</span>
          <select name="statedCondition" disabled={busy}>
            <option value="">Not stated</option>
            {buyerOfferConditionCodes.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label>
          <span>Buyer delivery option</span>
          <select name="deliveryOption" defaultValue="not_determined" disabled={busy}>
            {buyerOfferDeliveryOptions.map((option) => <option key={option} value={option}>{deliveryLabels[option] ?? option}</option>)}
          </select>
        </label>
        <label><span>Lead time (days)</span><input name="leadTimeDays" inputMode="numeric" disabled={busy} /></label>
        <label><span>Offer expires</span><input name="expiresAt" type="datetime-local" disabled={busy} /></label>
        {supplierOptions.length > 0 ? (
          <label>
            <span>Internal: sourced from <em>Staff traceability only. Never shown to the buyer.</em></span>
            <select name="selectedSupplierResponseId" disabled={busy}>
              <option value="">Not linked</option>
              {supplierOptions.map((option) => <option key={option.id} value={option.id}>{option.label} ({option.status})</option>)}
            </select>
          </label>
        ) : null}
        <label className="full">
          <span>Documentation summary <em>Buyer facing. Documentation varies by part and source.</em></span>
          <textarea name="documentsSummary" maxLength={2000} disabled={busy} />
        </label>
        <label className="full">
          <span>Shipping and export scope <em>Buyer facing. Describe what Civilon delivers, not how Civilon sources it.</em></span>
          <textarea name="shippingAndExportScope" maxLength={2000} disabled={busy} />
        </label>
        <p className="admin-delivery-warning full">{BUYER_OFFER_DISCLOSURE}</p>
        <button type="submit" disabled={busy}>{pending === "draft" ? "Saving…" : "Save draft offer"}</button>
      </form>
    </details>

    {openOffer ? (
      <form className="admin-inline-form" onSubmit={(event) => {
        event.preventDefault();
        const to = String(new FormData(event.currentTarget).get("to") ?? "");
        if (!to) return;
        void post("status", `${base}/${openOffer.id}/status`, { expectedStatus: openOffer.status, to },
          to === "sent" ? "Recorded as sent by staff." : "Offer updated.");
      }}>
        <label>
          <span>Version {openOffer.version} — {statusLabels[openOffer.status] ?? openOffer.status}</span>
          <select name="to" disabled={busy}>
            <option value="">Keep {statusLabels[openOffer.status] ?? openOffer.status}</option>
            {buyerOfferTargets(openOffer.status).map((target) => <option key={target} value={target}>
              {target === "sent" ? "Confirm I sent this offer to the buyer" : statusLabels[target] ?? target}
            </option>)}
          </select>
        </label>
        <button type="submit" disabled={busy}>{pending === "status" ? "Saving…" : "Apply"}</button>
      </form>
    ) : null}
  </div>;
}
