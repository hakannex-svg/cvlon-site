"use client";

import { useEffect, useRef, useState } from "react";
import { CustomerResultView, type CustomerResultViewModel } from "@/components/price-check/CustomerResultView";

type ResultState = { id: string; version: number; state: "DRAFT" | "APPROVED" | "SENT" | "SUPERSEDED"; explanation: string; factorCodes: string[]; displayRange: boolean; displayEvidenceCount: boolean; limitation: string | null; sourceAiArtifactId: string | null };
type AiDraft = {
  id: string; model: string | null; createdAt: string; state: "READY" | "FAILED" | "REJECTED" | "DISCARDED" | "STALE";
  analysisVersion: number | null; errorCode: string | null;
  draft: null | { classification: string; summary: string; explanation: string; factor_explanations: Array<{ factor_code: string; text: string }>; limitations: Array<{ limitation_code: string; text: string }>; review_required: true };
};

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
  canDraftAi: boolean;
  canApprove: boolean;
  canSend: boolean;
  previewWorkerEnabled: boolean;
  aiWorkspace: { status: "NOT_REQUESTED" | "QUEUED" | "GENERATING" | "READY" | "FAILED" | "STALE"; current: AiDraft | null; history: AiDraft[] };
  delivery: Array<{ state: string; attemptCount: number; failureCode: string | null; sentAt: string | null }>;
}) {
  const current = props.currentResult;
  const [explanation, setExplanation] = useState(current?.explanation ?? "");
  const [sourceAiArtifactId, setSourceAiArtifactId] = useState<string | null>(current?.sourceAiArtifactId ?? null);
  const [factors, setFactors] = useState<string[]>(current?.factorCodes ?? props.availableFactors.map((item) => item.code));
  const rangeAllowed = props.rangeAvailable && props.evidenceCount >= 2 && props.confidence !== "INSUFFICIENT_DATA";
  const [displayRange, setDisplayRange] = useState(current?.displayRange ?? rangeAllowed);
  const [displayCount, setDisplayCount] = useState(current?.displayEvidenceCount ?? true);
  const [limitation, setLimitation] = useState(current?.limitation ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [aiStatus, setAiStatus] = useState(props.aiWorkspace.status);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const feedbackRef = useRef<HTMLParagraphElement | null>(null);
  const aiHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const focusKey = `civilon:ai-explanation-focus:${props.priceCheckId}`;

  useEffect(() => {
    if (window.sessionStorage.getItem(focusKey) !== "pending") return;
    window.sessionStorage.removeItem(focusKey);
    window.requestAnimationFrame(() => aiHeadingRef.current?.focus());
  }, [focusKey]);
  useEffect(() => {
    if (!message) return;
    window.requestAnimationFrame(() => feedbackRef.current?.focus());
  }, [message]);

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

  async function generate(regenerate: boolean) {
    setBusy(true); setMessage(""); setAiStatus("QUEUED");
    const timer = window.setTimeout(() => setAiStatus("GENERATING"), 500);
    try {
      const response = await fetch(`/api/admin/price-checks/${props.priceCheckId}/explanation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisId: props.analysisId, regenerate }) });
      const payload = await response.json() as { error?: string; state?: string };
      if (!response.ok) throw new Error(payload.error || "AI drafting is unavailable. Continue with the human editor.");
      window.sessionStorage.setItem(focusKey, "pending");
      window.location.reload();
    } catch (error) {
      setAiStatus("FAILED");
      setMessage(error instanceof Error ? error.message : "AI drafting is unavailable. Continue with the human editor.");
    } finally { window.clearTimeout(timer); setBusy(false); }
  }

  async function applyDraft(artifact: AiDraft) {
    setBusy(true); setMessage(""); setConfirmReplace(false);
    try {
      const response = await fetch(`/api/admin/price-checks/${props.priceCheckId}/explanation/${artifact.id}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisId: props.analysisId }) });
      const payload = await response.json() as { error?: string; explanation?: string; artifactId?: string };
      if (!response.ok || !payload.explanation || !payload.artifactId) throw new Error(payload.error || "The AI draft could not be applied.");
      setExplanation(payload.explanation);
      setSourceAiArtifactId(payload.artifactId);
      setMessage("AI-assisted text was placed in the human editor. Review and edit it before saving.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The AI draft could not be applied."); }
    finally { setBusy(false); }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(aiText);
      setMessage("AI draft copied. Human text was not changed.");
    } catch {
      setMessage("The draft could not be copied. Select the text and copy it manually.");
    }
  }

  const ai = props.aiWorkspace.current;
  const aiText = ai?.draft ? `${ai.draft.summary} ${ai.draft.explanation}` : "";
  return <section className="admin-analysis-workspace admin-result-workspace" aria-labelledby="result-workspace-title">
    <header className="admin-analysis-heading"><div><p className="admin-eyebrow">Customer result</p><h2 id="result-workspace-title">Prepare the reviewed result</h2><p>Calculated facts remain bound to analysis version {props.analysisId.slice(-6)}. Only the explanation, approved factor visibility and permitted display policy are editable.</p></div><span className="admin-engine-label">Human approved</span></header>
    <div className="admin-result-layout">
      <section className="admin-panel admin-result-editor" aria-labelledby="result-editor-title"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Result draft</p><h3 id="result-editor-title">Customer-facing content</h3></div>{current && <span>Version {current.version} - {current.state}</span>}</div>
        <label>Human explanation<textarea value={explanation} maxLength={2000} onChange={(event) => { setExplanation(event.target.value); if (sourceAiArtifactId && event.target.value !== current?.explanation) setMessage("Human edits retained; AI provenance remains recorded if this draft is saved."); }} placeholder="Explain the reviewed position using only the persisted analysis and approved transaction context." /></label>
        <fieldset><legend>Visible deterministic factors</legend><div className="admin-result-factor-grid">{props.availableFactors.map((factor) => <label key={factor.code}><input type="checkbox" checked={factors.includes(factor.code)} onChange={(event) => setFactors(event.target.checked ? [...factors, factor.code] : factors.filter((code) => code !== factor.code))} />{factor.label}</label>)}</div></fieldset>
        <div className="admin-result-policy"><label><input type="checkbox" checked={displayRange} disabled={!rangeAllowed} onChange={(event) => setDisplayRange(event.target.checked)} />Display persisted low / median / high</label><label><input type="checkbox" checked={displayCount} onChange={(event) => setDisplayCount(event.target.checked)} />Display evidence count</label></div>
        {displayRange && props.evidenceCount === 2 && <label>Required limited-evidence statement<textarea value={limitation} maxLength={600} onChange={(event) => setLimitation(event.target.value)} /></label>}
        <p className="admin-legal-note"><b>PENDING FINAL LEGAL REVIEW</b> - Result disclaimer version is locked by the server.</p>
        <div className="admin-result-actions"><button type="button" disabled={busy || !props.canDraft} onClick={() => action(`/api/admin/price-checks/${props.priceCheckId}/result`, { analysisId: props.analysisId, explanation, factorCodes: factors, displayRange, displayEvidenceCount: displayCount, limitedEvidenceStatement: limitation || null, sourceAiArtifactId }, "Result draft saved.")}>Save draft</button><button type="button" disabled={busy || !props.canApprove || current?.state !== "DRAFT"} onClick={() => action(`/api/admin/price-checks/${props.priceCheckId}/result/approve`, { resultId: current?.id }, "Result approved.")}>Approve result</button><button type="button" disabled={busy || !props.canSend || current?.state !== "APPROVED"} onClick={() => action(`/api/admin/price-checks/${props.priceCheckId}/result/delivery`, { resultId: current?.id }, "Secure result delivery queued.")}>Send result</button>{props.previewWorkerEnabled && <button className="secondary" type="button" disabled={busy || !props.canSend} onClick={() => action("/api/admin/price-checks/notifications/process", {}, "Sandbox delivery processed.")}>Process sandbox delivery</button>}</div>
        {message && <p ref={feedbackRef} tabIndex={-1} className="admin-result-message" role="status">{message}</p>}
      </section>

      <section className="admin-panel admin-delivery-status" aria-labelledby="delivery-title"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Delivery</p><h3 id="delivery-title">Secure access status</h3></div></div>{props.delivery.length ? <ul>{props.delivery.map((item, index) => <li key={index}><strong>{item.state === "succeeded" ? "Delivery successful" : item.state === "failed" ? "Delivery failed - retry available" : item.state === "pending" ? "Approved - delivery pending" : item.state.replaceAll("_", " ")}</strong><span>Attempts: {item.attemptCount}</span>{item.failureCode && <small>{item.failureCode}</small>}</li>)}</ul> : <p className="admin-muted">No delivery has been queued.</p>}</section>
    </div>

    <section className="admin-panel admin-ai-explanation" aria-labelledby="ai-explanation-title">
      <div className="admin-panel-heading"><div><p className="admin-eyebrow">Optional drafting assistance</p><h3 id="ai-explanation-title" ref={aiHeadingRef} tabIndex={-1}>Draft explanation with AI</h3><p>AI-assisted draft - requires staff review. Phase 5 analysis remains authoritative.</p></div><span className={`admin-ai-state state-${aiStatus.toLowerCase()}`}>{aiStatus.replaceAll("_", " ")}</span></div>
      {aiStatus === "QUEUED" && <p className="admin-ai-progress" role="status">Draft request queued.</p>}
      {aiStatus === "GENERATING" && <p className="admin-ai-progress" role="status">Generating a bounded explanation from reviewed structured analysis...</p>}
      {aiStatus === "FAILED" && <div className="admin-empty-state"><strong>AI drafting is unavailable.</strong><p>The human explanation editor remains fully usable.</p></div>}
      {ai?.draft ? <div className="admin-ai-draft">
        <p className="admin-ai-summary"><strong>{ai.draft.summary}</strong> {ai.draft.explanation}</p>
        {ai.draft.factor_explanations.length > 0 && <dl>{ai.draft.factor_explanations.map((item) => <div key={item.factor_code}><dt>{item.factor_code.replaceAll("_", " ")}</dt><dd>{item.text}</dd></div>)}</dl>}
        {ai.draft.limitations.length > 0 && <ul>{ai.draft.limitations.map((item) => <li key={item.limitation_code}><b>{item.limitation_code.replaceAll("_", " ")}:</b> {item.text}</li>)}</ul>}
        <div className="admin-ai-actions">
          {!confirmReplace ? <button type="button" disabled={busy || !props.canDraftAi} onClick={() => explanation.trim() ? setConfirmReplace(true) : void applyDraft(ai)}>{explanation.trim() ? "Replace explanation with draft" : "Apply to explanation"}</button> : <><button type="button" disabled={busy} onClick={() => void applyDraft(ai)}>Confirm replacement</button><button type="button" className="secondary" disabled={busy} onClick={() => setConfirmReplace(false)}>Keep human text</button></>}
          <button type="button" className="secondary" disabled={busy} onClick={() => void copyDraft()}>Copy draft</button>
          <button type="button" className="secondary" disabled={busy || !props.canDraftAi} onClick={() => void generate(true)}>Regenerate</button>
          <button type="button" className="secondary" disabled={busy || !props.canDraftAi} onClick={() => action(`/api/admin/price-checks/${props.priceCheckId}/explanation/${ai.id}/discard`, { analysisId: props.analysisId }, "AI draft discarded.")}>Discard</button>
        </div>
      </div> : <div className="admin-ai-empty"><p>No usable AI draft is attached to the current analysis.</p><button type="button" disabled={busy || !props.canDraftAi || aiStatus === "QUEUED" || aiStatus === "GENERATING"} onClick={() => void generate(false)}>Draft explanation with AI</button></div>}
      {props.aiWorkspace.history.length > 0 && <details className="admin-ai-history"><summary>Generation history ({props.aiWorkspace.history.length})</summary><ol>{props.aiWorkspace.history.map((item) => <li key={item.id}><span>Analysis {item.analysisVersion ?? "Not available"}</span><b>{item.state}</b><span>{item.model ?? "Model unavailable"}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></li>)}</ol></details>}
    </section>
    {props.previewModel && <section className="admin-result-preview" aria-label="Customer result preview"><CustomerResultView model={props.previewModel} preview /></section>}
  </section>;
}
