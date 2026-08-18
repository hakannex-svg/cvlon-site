"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  supplierAvailabilityStates,
  supplierConditionCodes,
  supplierResponseCurrencies,
  supplierResponseTargets,
} from "@/db/price-check/domain/supplier-response-policy";

/**
 * Internal sourcing controls. Never shown to a buyer, and nothing here contacts
 * a supplier: staff spoke to them off-site and are writing down what was said.
 *
 * The default path is the nonregistered supplier, because that is how Civilon
 * actually sources — by calling companies that have never used the website.
 * There is deliberately no file input: the attachment schema cannot bind a file
 * to a supplier response, so documentation is a text summary.
 */

type Contact = { id: string; companyName: string; firstName: string; lastName: string; country: string | null };
type ResponseRow = { id: string; status: string; supplierNameSnapshot: string | null };

const availabilityLabels: Record<string, string> = {
  subject_to_confirmation: "Subject to confirmation (no claim recorded)",
  claimed_available: "Supplier claims available",
  claimed_lead_time: "Supplier claims a lead time",
  unavailable: "Supplier says unavailable",
  unknown: "Unknown",
};

const statusLabels: Record<string, string> = {
  received: "Received", under_review: "Under review", shortlisted: "Shortlisted",
  selected: "Selected", declined: "Declined", withdrawn: "Withdrawn", expired: "Expired",
};

export function SupplierResponseActions({ buyRequestId, contacts, responses }: {
  buyRequestId: string;
  contacts: readonly Contact[];
  responses: readonly ResponseRow[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"nonregistered_supplier" | "registered_contact">("nonregistered_supplier");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const base = `/api/admin/marketplace/buy-requests/${buyRequestId}/supplier-responses`;

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

  function submitResponse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (key: string) => {
      const raw = String(data.get(key) ?? "").trim();
      return raw || undefined;
    };
    void post("create", base, {
      supplierKind: kind,
      supplierContactId: kind === "registered_contact" ? text("supplierContactId") : undefined,
      supplierNameSnapshot: text("supplierNameSnapshot"),
      supplierContactSnapshot: text("supplierContactSnapshot"),
      supplierCountry: text("supplierCountry"),
      offeredPartNumber: text("offeredPartNumber"),
      statedCondition: text("statedCondition"),
      quantityAvailable: text("quantityAvailable"),
      supplierUnitCost: text("supplierUnitCost"),
      currencyCode: text("currencyCode"),
      availabilityState: text("availabilityState"),
      locationText: text("locationText"),
      leadTimeDays: text("leadTimeDays"),
      documentsSummary: text("documentsSummary"),
      shippingNotes: text("shippingNotes"),
    }, "Supplier response recorded.", () => form.reset());
  }

  const busy = pending !== null;

  return <div className="admin-supplier-actions">
    {error ? <p className="admin-error" role="alert">{error}</p> : null}
    {notice ? <p className="admin-success" role="status">{notice}</p> : null}

    <details className="admin-details-action">
      <summary><span><b>Record a supplier response</b><small>Internal sourcing. Nothing here is sent to the supplier or the buyer.</small></span></summary>
      <form className="admin-form-grid" onSubmit={submitResponse}>
        <label>
          <span>Supplier source</span>
          <select
            name="supplierKind"
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
            disabled={busy}
          >
            <option value="nonregistered_supplier">Nonregistered supplier (contacted directly)</option>
            <option value="registered_contact">Registered marketplace contact</option>
          </select>
        </label>

        {kind === "registered_contact" ? (
          <label>
            <span>Registered supplier</span>
            <select name="supplierContactId" disabled={busy} required>
              <option value="">Choose a seller-capable contact</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>
                {contact.companyName} — {contact.firstName} {contact.lastName}
              </option>)}
            </select>
          </label>
        ) : (
          <label>
            <span>Supplier company or name <em>Required</em></span>
            <input name="supplierNameSnapshot" maxLength={200} disabled={busy} required />
          </label>
        )}

        <label><span>Supplier contact <em>Optional</em></span><input name="supplierContactSnapshot" maxLength={320} disabled={busy} /></label>
        <label><span>Country <em>Optional, two letters</em></span><input name="supplierCountry" maxLength={2} disabled={busy} /></label>
        <label><span>Offered part number</span><input name="offeredPartNumber" maxLength={160} disabled={busy} /></label>
        <label>
          <span>Stated condition</span>
          <select name="statedCondition" disabled={busy}>
            <option value="">Not stated</option>
            {supplierConditionCodes.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label><span>Quantity available</span><input name="quantityAvailable" inputMode="decimal" disabled={busy} /></label>
        <label><span>Supplier unit cost <em>Optional; leave blank for quote on request</em></span><input name="supplierUnitCost" inputMode="decimal" disabled={busy} /></label>
        <label>
          <span>Currency <em>Required only with a cost</em></span>
          <select name="currencyCode" disabled={busy}>
            <option value="">None</option>
            {supplierResponseCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label>
          <span>Availability <em>The supplier&apos;s claim, not a Civilon confirmation</em></span>
          <select name="availabilityState" defaultValue="subject_to_confirmation" disabled={busy}>
            {supplierAvailabilityStates.map((state) => <option key={state} value={state}>{availabilityLabels[state] ?? state}</option>)}
          </select>
        </label>
        <label><span>Supplier location</span><input name="locationText" maxLength={240} disabled={busy} /></label>
        <label><span>Lead time (days)</span><input name="leadTimeDays" inputMode="numeric" disabled={busy} /></label>
        <label className="full">
          <span>Documentation summary <em>Text only. Do not attach files here.</em></span>
          <textarea name="documentsSummary" maxLength={2000} disabled={busy} placeholder="What paperwork the supplier says exists. Recording it is not a Civilon check of it." />
        </label>
        <label className="full">
          <span>Shipping notes <em>Internal routing. Never shown to the buyer.</em></span>
          <textarea name="shippingNotes" maxLength={2000} disabled={busy} />
        </label>
        <button type="submit" disabled={busy}>{pending === "create" ? "Saving…" : "Record response"}</button>
      </form>
    </details>

    {responses.length > 0 ? (
      <div className="admin-supplier-status-list">
        {responses.map((response) => {
          const targets = supplierResponseTargets(response.status);
          if (!targets.length) {
            return <p key={response.id} className="admin-muted">
              {response.supplierNameSnapshot ?? "Supplier"} — {statusLabels[response.status] ?? response.status} (final)
            </p>;
          }
          return <form key={response.id} className="admin-inline-form" onSubmit={(event) => {
            event.preventDefault();
            const to = String(new FormData(event.currentTarget).get("to") ?? "");
            if (!to) return;
            void post(`status:${response.id}`, `${base}/${response.id}/status`, {
              expectedStatus: response.status,
              to,
            }, "Supplier response updated.");
          }}>
            <label>
              <span>{response.supplierNameSnapshot ?? "Supplier"} — {statusLabels[response.status] ?? response.status}</span>
              <select name="to" disabled={busy}>
                <option value="">Keep {statusLabels[response.status] ?? response.status}</option>
                {targets.map((target) => <option key={target} value={target}>{statusLabels[target] ?? target}</option>)}
              </select>
            </label>
            <button type="submit" disabled={busy}>{pending === `status:${response.id}` ? "Saving…" : "Apply"}</button>
          </form>;
        })}
      </div>
    ) : null}
  </div>;
}
