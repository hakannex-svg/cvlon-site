"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentExtraction, ExtractionLineItem, MaterialField } from "@/lib/price-check/extraction/schema";

type ExtractionRecord = {
  id: string; attachmentId: string; filename: string; version: number;
  processingStatus: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
  acceptanceState: "PENDING" | "ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED";
  configuredModelId: string | null; schemaVersion: string; promptVersion: string | null;
  structuredProposal: Record<string, unknown>; createdAt: string;
};

const fieldDefinitions = [
  ["originalPartNumber", "Part number", "originalPartNumber", "part_number"],
  ["description", "Description", "description", "description"],
  ["quantity", "Quantity", "quantity", "quantity"],
  ["conditionCode", "Condition", "conditionCode", "condition"],
  ["transactionType", "Transaction type", "transactionType", "transaction_type"],
  ["unitPrice", "Unit price", "unitPrice", "unit_price"],
  ["currencyCode", "Currency", "currencyCode", "currency"],
  ["coreCharge", "Core charge", "coreCharge", "core_charge"],
  ["coreDisposition", "Core disposition", "coreDisposition", "core_disposition"],
  ["exchangeFee", "Exchange fee", "exchangeFee", "exchange_fee"],
  ["freight", "Freight", "freight", "freight"],
  ["aircraftModel", "Aircraft / application", "aircraftModel", "aircraft_application"],
  ["warrantyText", "Warranty", "warrantyText", "warranty"],
  ["documentationCodes", "Documentation / release", "documentationCodes", "documentation_release"],
] as const;

function normalizePart(value: unknown) { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item && "code" in item ? String(item.code).replaceAll("_", " ") : String(item)).join(", ");
  return String(value).replaceAll("_", " ");
}

export function AdminExtractionReview({ priceCheckId, extractions, transaction, canApply }: {
  priceCheckId: string; extractions: ExtractionRecord[]; transaction: Record<string, unknown>; canApply: boolean;
}) {
  const ready = extractions.filter((item) => item.processingStatus === "SUCCEEDED");
  const [selectedExtractionId, setSelectedExtractionId] = useState(ready[0]?.id ?? "");
  const selected = ready.find((item) => item.id === selectedExtractionId) ?? ready[0];
  const proposal = selected?.structuredProposal as unknown as DocumentExtraction | undefined;
  const defaultLine = useMemo(() => {
    if (!proposal?.line_items?.length) return 0;
    const current = normalizePart(transaction.originalPartNumber);
    const exact = proposal.line_items.findIndex((item) => item.part_number.state === "PRESENT" && normalizePart(item.part_number.value) === current);
    return exact >= 0 ? exact : 0;
  }, [proposal, transaction.originalPartNumber]);
  const [lineIndex, setLineIndex] = useState(defaultLine);
  const [decisions, setDecisions] = useState<Record<string, "accept" | "keep">>({});
  const [reason, setReason] = useState("Document extraction confirmed by analyst");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const feedbackRef = useRef<HTMLParagraphElement | null>(null);
  const router = useRouter();
  const line = proposal?.line_items?.[lineIndex];
  const revisionFocusKey = `civilon:extraction-review-focus:${priceCheckId}`;
  useEffect(() => {
    if (!message && !error) return;
    window.requestAnimationFrame(() => feedbackRef.current?.focus());
  }, [message, error]);
  useEffect(() => {
    if (window.sessionStorage.getItem(revisionFocusKey) !== "pending") return;
    window.sessionStorage.removeItem(revisionFocusKey);
    window.requestAnimationFrame(() => document.getElementById("reviewed-heading")?.focus());
  }, [revisionFocusKey, transaction, extractions]);

  async function apply() {
    if (!selected || !line) return;
    const acceptedFields = Object.entries(decisions).filter(([, decision]) => decision === "accept").map(([field]) => field);
    if (!acceptedFields.length) { setError("Choose at least one supported document field to accept."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/price-checks/${priceCheckId}/extractions/${selected.id}/apply`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItemIndex: lineIndex, acceptedFields, changeReason: reason }),
      });
      const result = await response.json() as { ok: boolean; error?: string; version?: number };
      if (!response.ok || !result.ok) throw new Error(result.error || "Confirmed details could not be applied.");
      setMessage(`Revision ${result.version} created. Deterministic pricing will use the human-confirmed revision only.`);
      window.sessionStorage.setItem(revisionFocusKey, "pending");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Confirmed details could not be applied."); }
    finally { setBusy(false); }
  }

  return <section className="admin-panel admin-extraction-review" aria-labelledby="extraction-review-heading">
    <div className="admin-panel-heading"><div><p className="admin-eyebrow">AI extraction review</p><h2 id="extraction-review-heading">Document extraction review</h2><p>AI proposes fields from the document; it does not decide which values are correct. Review every proposed field before applying it.</p></div><a className="admin-guide-link" href="/admin/help#extraction">What is this?</a>{selected && <span>Version {selected.version}</span>}</div>
    <p className="admin-muted">Document content is untrusted evidence. Confirmed fields create a reviewed revision; they never create market observations or decide pricing.</p>
    {extractions.length > 0 && <details className="admin-extraction-history"><summary>Extraction history ({extractions.length})</summary><ol>{extractions.map((item) => <li key={item.id}><button type="button" disabled={item.processingStatus !== "SUCCEEDED"} onClick={() => { setSelectedExtractionId(item.id); setLineIndex(0); setDecisions({}); }}><span>{item.filename} · v{item.version}</span><b>{item.processingStatus.replaceAll("_", " ")}</b><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></button></li>)}</ol></details>}
    {!selected && <div className="admin-empty-state"><strong>No extraction proposal is ready.</strong><p>Manual review remains fully available.</p></div>}
    {selected && proposal && <>
      <div className="admin-extraction-meta"><span>{selected.filename}</span><span>{proposal.document_type.replaceAll("_", " ")}</span><span>{proposal.review_required ? "Review required" : "Structured proposal"}</span></div>
      {proposal.warnings.length > 0 && <ul className="admin-extraction-warnings" aria-label="Extraction warnings">{proposal.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      {proposal.line_items.length === 0 ? <div className="admin-empty-state"><strong>No line item was confidently identified.</strong><p>Review the source document manually.</p></div> : <>
        <fieldset className="admin-line-item-picker"><legend>Choose the corresponding line item</legend>{proposal.line_items.map((item, index) => { const exact = normalizePart(item.part_number.value) === normalizePart(transaction.originalPartNumber); return <label key={index}><input type="radio" name={`line-${selected.id}`} checked={lineIndex === index} onChange={() => { setLineIndex(index); setDecisions({}); }} /><span>Line {index + 1}: {display(item.part_number.value)} {exact ? <b>Exact normalized PN match — confirm manually</b> : <em>Part-number mismatch or unavailable</em>}</span></label>; })}</fieldset>
        {line && <div className="admin-diff-table" role="group" aria-label="Current Price Check compared with document proposal">
          <div className="admin-diff-heading"><span>Field</span><span>Current Price Check</span><span>Document proposal</span><span>Decision</span></div>
          {fieldDefinitions.map(([field, label, currentKey, proposalKey]) => { const proposed = line[proposalKey as keyof ExtractionLineItem] as MaterialField<unknown>; const supported = proposed && proposed.state === "PRESENT" && proposed.value !== null; return <div className={`admin-diff-row ${!supported ? "is-unknown" : display(transaction[currentKey]) !== display(proposed.value) ? "has-difference" : ""}`} key={field}>
            <strong>{label}</strong><span>{display(transaction[currentKey])}</span><span><b>{display(proposed?.value)}</b><small>{proposed?.state?.replaceAll("_", " ")}{proposed?.evidence?.span ? ` · “${proposed.evidence.span}”` : ""}</small></span>
            <fieldset disabled={!canApply || !supported || busy}><legend>{label} decision</legend><label><input type="radio" name={`${selected.id}-${lineIndex}-${field}`} checked={decisions[field] === "keep" || !decisions[field]} onChange={() => setDecisions((current) => ({ ...current, [field]: "keep" }))} /> Keep current</label><label><input type="radio" name={`${selected.id}-${lineIndex}-${field}`} checked={decisions[field] === "accept"} onChange={() => setDecisions((current) => ({ ...current, [field]: "accept" }))} /> Accept proposed</label></fieldset>
          </div>; })}
        </div>}
        {canApply && <div className="admin-extraction-apply"><label htmlFor="extraction-change-reason">Change reason<input id="extraction-change-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={240} /></label><button type="button" disabled={busy} onClick={apply}>{busy ? "Applying…" : "Apply confirmed document details"}</button></div>}
      </>}
    </>}
    {error && <p ref={feedbackRef} tabIndex={-1} className="admin-error" role="alert">{error}</p>}{message && <p ref={feedbackRef} tabIndex={-1} className="admin-success" role="status">{message}</p>}
  </section>;
}
