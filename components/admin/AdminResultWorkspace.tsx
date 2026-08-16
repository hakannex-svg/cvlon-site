"use client";

import { useState } from "react";
import { CustomerResultView, type CustomerResultViewModel } from "@/components/price-check/CustomerResultView";

type ResultState = { id: string; version: number; state: "DRAFT" | "APPROVED" | "SENT" | "SUPERSEDED"; explanation: string; factorCodes: string[]; displayRange: boolean; displayEvidenceCount: boolean; limitation: string | null };

export function AdminResultWorkspace(props: {
  priceCheckId: string;
  analysisId: string;
  evidenceCount: number;
  confidence: string;
  rangeAvailable: boolean;
  availableFactors: Array<{ code: string; label: string }>;
  currentResult: ResultState | null;
  previewModel: CustomerResultViewModel | null;
  canDraft: boolean;
  canApprove: boolean;
  canSend: boolean;
  previewWorkerEnabled: boolean;
  delivery: Array<{ state: string; attemptCount: number; failureCode: string | null; sentAt: string | null }>;
}) {
  const current = props.currentResult;
  const [explanation, setExplanation] = useState(current?.explanation ?? "");
  const [factors, setFactors] = useState<string[]>(current?.factorCodes ?? props.availableFactors.map((item) => item.code));
  const rangeAllowed = props.rangeAvailable && props.evidenceCount >= 2 && props.confidence !== "INSUFFICIENT_DATA";
  const [displayRange, setDisplayRange] = useState(current?.displayRange ?? rangeAllowed);
  const [displayCount, setDisplayCount] = useState(current?.displayEvidenceCount ?? true);
  const [limitation, setLimitation] = useState(current?.limitation ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function action(path: string, body: unknown, success: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Action failed.");
      setMessage(success);
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed."); }
    finally { setBusy(false); }
  }

  return <section className="admin-analysis-workspace admin-result-workspace" aria-labelledby="result-workspace-title">
    <header className="admin-analysis-heading"><div><p className="admin-eyebrow">Customer result</p><h2 id="result-workspace-title">Prepare the reviewed result</h2><p>Calculated facts remain bound to analysis version {props.analysisId.slice(-6)}. Only the explanation, approved factor visibility and permitted display policy are editable.</p></div><span className="admin-engine-label">Human written · no AI</span></header>
    <div className="admin-result-layout">
      <section className="admin-panel admin-result-editor" aria-labelledby="result-editor-title"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Result draft</p><h3 id="result-editor-title">Customer-facing content</h3></div>{current && <span>Version {current.version} · {current.state}</span>}</div>
        <label>Human-written explanation<textarea value={explanation} maxLength={2000} onChange={(event) => setExplanation(event.target.value)} placeholder="Explain the reviewed position using only the persisted analysis and approved transaction context." /></label>
        <fieldset><legend>Visible deterministic factors</legend><div className="admin-result-factor-grid">{props.availableFactors.map((factor) => <label key={factor.code}><input type="checkbox" checked={factors.includes(factor.code)} onChange={(event) => setFactors(event.target.checked ? [...factors, factor.code] : factors.filter((code) => code !== factor.code))} />{factor.label}</label>)}</div></fieldset>
        <div className="admin-result-policy"><label><input type="checkbox" checked={displayRange} disabled={!rangeAllowed} onChange={(event) => setDisplayRange(event.target.checked)} />Display persisted low / median / high</label><label><input type="checkbox" checked={displayCount} onChange={(event) => setDisplayCount(event.target.checked)} />Display evidence count</label></div>
        {displayRange && props.evidenceCount === 2 && <label>Required limited-evidence statement<textarea value={limitation} maxLength={600} onChange={(event) => setLimitation(event.target.value)} /></label>}
        <p className="admin-legal-note"><b>PENDING FINAL LEGAL REVIEW</b> · Result disclaimer version is locked by the server.</p>
        <div className="admin-result-actions"><button type="button" disabled={busy || !props.canDraft} onClick={() => action(`/api/admin/price-checks/${props.priceCheckId}/result`, { analysisId: props.analysisId, explanation, factorCodes: factors, displayRange, displayEvidenceCount: displayCount, limitedEvidenceStatement: limitation || null }, "Result draft saved.")}>Save draft</button><button type="button" disabled={busy || !props.canApprove || current?.state !== "DRAFT"} onClick={() => action(`/api/admin/price-checks/${props.priceCheckId}/result/approve`, { resultId: current?.id }, "Result approved.")}>Approve result</button><button type="button" disabled={busy || !props.canSend || current?.state !== "APPROVED"} onClick={() => action(`/api/admin/price-checks/${props.priceCheckId}/result/delivery`, { resultId: current?.id }, "Secure result delivery queued.")}>Send result</button>{props.previewWorkerEnabled && <button className="secondary" type="button" disabled={busy || !props.canSend} onClick={() => action("/api/admin/price-checks/notifications/process", {}, "Sandbox delivery processed.")}>Process sandbox delivery</button>}</div>
        {message && <p className="admin-result-message" role="status">{message}</p>}
      </section>
      <aside className="admin-panel admin-delivery-status" aria-labelledby="delivery-title"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Delivery</p><h3 id="delivery-title">Secure access status</h3></div></div>{props.delivery.length ? <ul>{props.delivery.map((item, index) => <li key={index}><strong>{item.state === "succeeded" ? "Delivery successful — sandbox" : item.state === "failed" ? "Delivery failed — retry available" : item.state === "pending" ? "Approved — delivery pending" : item.state.replaceAll("_", " ")}</strong><span>Attempts: {item.attemptCount}</span>{item.failureCode && <small>{item.failureCode}</small>}</li>)}</ul> : <p className="admin-muted">No delivery has been queued.</p>}</aside>
    </div>
    {props.previewModel && <section className="admin-result-preview" aria-label="Customer result preview"><CustomerResultView model={props.previewModel} preview /></section>}
  </section>;
}
