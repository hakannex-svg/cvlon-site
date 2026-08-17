"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type AttachmentItem = {
  id: string;
  displayFilename: string;
  declaredMime: string | null;
  detectedMime: string | null;
  byteSize: string;
  scanState: "PENDING" | "QUARANTINED" | "CLEAN" | "REJECTED" | "FAILED";
  createdAt: string;
};

type ExtractionState = {
  attachmentId: string;
  jobState: "pending" | "running" | "succeeded" | "failed" | "dead_letter" | null;
  extractionStatus: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | null;
};

const stateCopy = {
  PENDING: "Scanning",
  QUARANTINED: "Scanning",
  CLEAN: "Clean",
  REJECTED: "Rejected",
  FAILED: "Scan failed / requires attention",
} as const;

function bytes(value: string) {
  const size = Number(value);
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function AdminAttachmentWorkspace({ priceCheckId, attachments, canDownload, canReconcile, canExtract, canRetry, extractionStates }: {
  priceCheckId: string;
  attachments: AttachmentItem[];
  canDownload: boolean;
  canReconcile: boolean;
  canExtract: boolean;
  canRetry: boolean;
  extractionStates: ExtractionState[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeExtraction, setActiveExtraction] = useState<{ attachmentId: string; state: "pending" | "running" } | null>(null);
  const extractionStatusRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const feedbackRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (!activeExtraction) return;
    window.requestAnimationFrame(() => extractionStatusRefs.current[activeExtraction.attachmentId]?.focus());
  }, [activeExtraction]);
  useEffect(() => {
    if (!message && !error) return;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => feedbackRef.current?.focus());
    });
    return () => window.cancelAnimationFrame(frame);
  }, [message, error, extractionStates]);
  async function reconcile() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/price-checks/${priceCheckId}/attachments/reconcile`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const result = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Scan status could not be refreshed.");
      setMessage("Document scan status refreshed.");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Scan status could not be refreshed."); }
    finally { setBusy(false); }
  }
  async function extract(attachmentId: string, retry = false) {
    setBusy(true); setError(""); setMessage(""); setActiveExtraction({ attachmentId, state: "pending" });
    const processingTimer = window.setTimeout(() => {
      setActiveExtraction((current) => current?.attachmentId === attachmentId ? { attachmentId, state: "running" } : current);
    }, 500);
    try {
      const response = await fetch(`/api/admin/price-checks/${priceCheckId}/attachments/${attachmentId}/extract`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retry }),
      });
      const result = await response.json() as { ok: boolean; error?: string; state?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Extraction could not be started.");
      setMessage(result.state === "succeeded" ? "Extraction proposal is ready for staff review." : result.state === "failed" ? "Extraction unavailable — review the document manually." : "Extraction request recorded.");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Extraction could not be started."); }
    finally { window.clearTimeout(processingTimer); setActiveExtraction(null); setBusy(false); }
  }
  const stateFor = (attachmentId: string) => extractionStates.find((item) => item.attachmentId === attachmentId);
  const extractionLabel = (state: ExtractionState | undefined) => {
    if (state?.extractionStatus === "SUCCEEDED" || state?.jobState === "succeeded") return "Extraction ready";
    if (state?.jobState === "running") return "Processing";
    if (state?.jobState === "pending") return "Queued";
    if (state?.extractionStatus === "FAILED" || state?.jobState === "failed" || state?.jobState === "dead_letter") return "Extraction failed";
    return null;
  };
  return <section className="admin-panel admin-attachments" aria-labelledby="attachments-heading">
    <div className="admin-panel-heading"><div><p className="admin-eyebrow">Source documents</p><h2 id="attachments-heading">Uploaded documents</h2><p>Uploaded supporting documents. Only files marked Clean may be opened or sent for extraction.</p></div><a className="admin-guide-link" href="/admin/help#extraction">Guide →</a>{canReconcile && attachments.some((item) => item.scanState !== "CLEAN" && item.scanState !== "REJECTED") && <button type="button" disabled={busy} onClick={reconcile}>{busy ? "Refreshing…" : "Refresh scan status"}</button>}</div>
    {error && <p ref={feedbackRef} tabIndex={-1} className="admin-error" role="alert">{error}</p>}{message && <p ref={feedbackRef} tabIndex={-1} className="admin-success" role="status">{message}</p>}
    {attachments.length ? <ul>{attachments.map((item) => { const persisted = stateFor(item.id); const extraction = activeExtraction?.attachmentId === item.id ? { ...persisted, jobState: activeExtraction.state } : persisted; const label = extractionLabel(extraction); const failed = label === "Extraction failed"; return <li key={item.id}>
      <div><strong>{item.displayFilename}</strong><span>{bytes(item.byteSize)} · {item.detectedMime ?? item.declaredMime ?? "Type pending"}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div>
      <div><span className={`admin-scan-state state-${item.scanState.toLowerCase()}`}>{stateCopy[item.scanState]}</span>{label && <span ref={(node) => { extractionStatusRefs.current[item.id] = node; }} tabIndex={-1} aria-live="polite" className={`admin-extraction-state ${failed ? "is-failed" : ""}`}>{label}</span>}<div className="admin-attachment-actions">{canDownload && item.scanState === "CLEAN" && <a href={`/api/admin/price-checks/${priceCheckId}/attachments/${item.id}/download`} target="_blank" rel="noreferrer">Download</a>}{canExtract && item.scanState === "CLEAN" && !label && <button type="button" disabled={busy} onClick={() => extract(item.id)}>Extract document details</button>}{canRetry && failed && <button type="button" disabled={busy} onClick={() => extract(item.id, true)}>Retry extraction</button>}</div></div>
    </li>; })}</ul> : <p className="admin-muted">No supporting document was uploaded. Manual transaction review remains available.</p>}
    <p className="admin-muted">Extraction is optional and staff-triggered. Only files confirmed clean by AWS malware scanning, server validation and an integrity recheck can be sent for structured extraction.</p>
  </section>;
}
