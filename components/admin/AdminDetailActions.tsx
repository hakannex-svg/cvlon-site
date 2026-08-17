"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AdminTarget = { id: string; label: string };
type RevisionDefaults = Record<string, string | boolean | string[] | null>;

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({ ok: false, error: "The server response could not be read." }));
  if (!response.ok) throw new Error(payload.error ?? "The operation could not be completed.");
  return payload;
}

export function AdminDetailActions({
  priceCheckId,
  assigneeId,
  currentUserId,
  canAssignAny,
  canMutate,
  admins,
  nextStatuses,
  canRequestInformation,
  revision,
}: {
  priceCheckId: string;
  assigneeId: string | null;
  currentUserId: string;
  canAssignAny: boolean;
  canMutate: boolean;
  admins: AdminTarget[];
  nextStatuses: string[];
  canRequestInformation: boolean;
  revision: RevisionDefaults;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); setMessage(success); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The operation could not be completed."); }
    finally { setBusy(false); }
  }

  return <div className="admin-actions-stack">
    {(message || error) && <div className={error ? "admin-error" : "admin-success"} role={error ? "alert" : "status"}>{error ?? message}</div>}
    <section className="admin-panel admin-action-panel" aria-labelledby="assignment-title">
      <div className="admin-panel-heading"><div><p className="admin-eyebrow">Ownership</p><h2 id="assignment-title">Assignment</h2></div></div>
      {canMutate ? <form onSubmit={(event) => {
        event.preventDefault();
        const assigneeId = String(new FormData(event.currentTarget).get("assigneeId") ?? "");
        run(() => post(`/api/admin/price-checks/${priceCheckId}/assignment`, { assigneeId }), "Assignment saved.");
      }} className="admin-inline-form">
        <label><span>Active staff member</span><select name="assigneeId" defaultValue={assigneeId ?? currentUserId} disabled={busy}>{admins.filter(admin => canAssignAny || admin.id === currentUserId).map(admin => <option key={admin.id} value={admin.id}>{admin.label}</option>)}</select></label>
        <button disabled={busy} type="submit">Assign</button>
      </form> : <p className="admin-muted">Read-only role. Assignment changes are unavailable.</p>}
    </section>

    {canMutate && nextStatuses.length > 0 && <section className="admin-panel admin-action-panel" aria-labelledby="status-actions-title">
      <div className="admin-panel-heading"><div><p className="admin-eyebrow">Workflow actions</p><h2 id="status-actions-title">Valid next actions</h2><p>Only transitions allowed from the persisted status are shown.</p></div></div>
      <div className="admin-status-actions">{nextStatuses.map(status => <button key={status} type="button" disabled={busy} onClick={() => run(() => post(`/api/admin/price-checks/${priceCheckId}/status`, { to: status }), `Status changed to ${status.replaceAll("_", " ")}.`)}>{status.replaceAll("_", " ")}</button>)}</div>
    </section>}

    {canMutate && nextStatuses.length === 0 && <section className="admin-panel admin-action-panel"><p className="admin-eyebrow">Workflow actions</p><h2>No generic status action</h2><p className="admin-muted">This state has no generic transition available for your role. Use the dedicated analysis, result, delivery, or sourcing controls when the page presents them.</p></section>}

    {canMutate && canRequestInformation && <details className="admin-panel admin-details-action">
      <summary><span><b>Request more information</b><small>Workflow state only—no customer email is sent.</small></span></summary>
      <form onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        run(() => post(`/api/admin/price-checks/${priceCheckId}/information-request`, Object.fromEntries(data)), "Marked as needing information. Communication delivery is not enabled in this preview.");
      }} className="admin-form-grid">
        <label><span>Reason category</span><select name="category" required><option value="">Choose a reason</option><option>Transaction terms</option><option>Documentation</option><option>Part identification</option><option>Price or currency</option><option>Aircraft application</option><option>Other clarification</option></select></label>
        <label className="full"><span>Customer-facing note</span><textarea name="customerNote" required maxLength={1000} placeholder="State the clarification needed without implying an email was sent." /></label>
        <label className="full"><span>Internal note <em>optional</em></span><textarea name="internalNote" maxLength={1000} placeholder="Operational context for authorized staff." /></label>
        <p className="admin-delivery-warning full">Communication delivery is not enabled in this preview. This action only changes workflow state and records an audit event.</p>
        <button disabled={busy} type="submit">Mark as needing information</button>
      </form>
    </details>}

    {canMutate && <details className="admin-panel admin-details-action">
      <summary><span><b>Create correction / revision</b><small>The original submission remains immutable.</small></span></summary>
      <form onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const payload = Object.fromEntries(data);
        payload.aog = data.get("aog") === "true";
        payload.documentationCodes = data.getAll("documentationCodes");
        run(() => post(`/api/admin/price-checks/${priceCheckId}/revision`, payload), "A new reviewed transaction revision was created.");
      }} className="admin-form-grid admin-revision-form">
        <label><span>Part number</span><input name="originalPartNumber" required maxLength={160} defaultValue={String(revision.originalPartNumber ?? "")} /></label>
        <label><span>Description</span><input name="description" maxLength={1200} defaultValue={String(revision.description ?? "")} /></label>
        <label><span>Quantity</span><input name="quantity" required inputMode="decimal" defaultValue={String(revision.quantity ?? "1")} /></label>
        <label><span>Quote status</span><select name="quoteOrPurchased" defaultValue={String(revision.quoteOrPurchased ?? "quote")}><option value="quote">Quote</option><option value="purchased">Already purchased</option></select></label>
        <label><span>Transaction</span><select name="transactionType" defaultValue={String(revision.transactionType ?? "outright")}>{["outright","exchange","repair","not_sure"].map(item => <option key={item} value={item}>{item.replace("_", " ")}</option>)}</select></label>
        <label><span>Condition</span><select name="conditionCode" defaultValue={String(revision.conditionCode ?? "SV")}>{["NE","NS","OH","SV","AR","NOT_SURE"].map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Unit price</span><input name="unitPrice" required inputMode="decimal" defaultValue={String(revision.unitPrice ?? "")} /></label>
        <label><span>Currency</span><select name="currencyCode" defaultValue={String(revision.currencyCode ?? "USD")}>{["AUD","CAD","CHF","EUR","GBP","JPY","USD"].map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Core charge</span><input name="coreCharge" inputMode="decimal" defaultValue={String(revision.coreCharge ?? "")} /></label>
        <label><span>Core disposition</span><select name="coreDisposition" defaultValue={String(revision.coreDisposition ?? "")}><option value="">Not specified</option><option value="REFUNDABLE">Refundable</option><option value="FORFEITED">Non-refundable / forfeited</option><option value="UNCLEAR">Terms unclear</option><option value="NOT_APPLICABLE">No core</option></select></label>
        <label><span>Exchange fee</span><input name="exchangeFee" inputMode="decimal" defaultValue={String(revision.exchangeFee ?? "")} /></label>
        <label><span>Freight</span><input name="freight" inputMode="decimal" defaultValue={String(revision.freight ?? "")} /></label>
        <label><span>Transaction date</span><input name="transactionDate" type="date" defaultValue={String(revision.transactionDate ?? "")} /></label>
        <label><span>Aircraft / model</span><input name="aircraftModel" maxLength={160} defaultValue={String(revision.aircraftModel ?? "")} /></label>
        <label><span>AOG</span><select name="aog" defaultValue={String(Boolean(revision.aog))}><option value="false">No</option><option value="true">Yes</option></select></label>
        <label><span>Warranty value</span><input name="warrantyValue" inputMode="decimal" defaultValue={String(revision.warrantyValue ?? "")} /></label>
        <label><span>Warranty unit</span><select name="warrantyUnit" defaultValue={String(revision.warrantyUnit ?? "")}><option value="">Not specified</option>{["DAYS","MONTHS","YEARS","HOURS","CYCLES","OTHER"].map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Warranty text</span><input name="warrantyText" maxLength={500} defaultValue={String(revision.warrantyText ?? "")} /></label>
        <fieldset className="full admin-document-options"><legend>Documentation requirements</legend>{["FAA_8130_3","EASA_FORM_1","DUAL_RELEASE","OEM_MANUFACTURER_COC","MATERIAL_CERTIFICATION","REMOVAL_RECORDS","TEARDOWN_EVALUATION_REPORT","TEST_REPORT","OTHER","NOT_SURE"].map(code => <label key={code}><input type="checkbox" name="documentationCodes" value={code} defaultChecked={Array.isArray(revision.documentationCodes) && revision.documentationCodes.includes(code)} /> {code.replaceAll("_", " ")}</label>)}</fieldset>
        <label className="full"><span>Operational notes</span><textarea name="notes" maxLength={2000} defaultValue={String(revision.notes ?? "")} /></label>
        <label className="full"><span>Change reason</span><select name="changeReason" required defaultValue=""><option value="">Choose a reason</option><option>Customer clarification</option><option>Typographical correction</option><option>Analyst normalization</option><option>Transaction term clarification</option></select></label>
        <button disabled={busy} type="submit">Save new revision</button>
      </form>
    </details>}
  </div>;
}
