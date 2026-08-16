"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AttachmentItem = {
  id: string;
  displayFilename: string;
  declaredMime: string | null;
  detectedMime: string | null;
  byteSize: string;
  scanState: "PENDING" | "QUARANTINED" | "CLEAN" | "REJECTED" | "FAILED";
  createdAt: string;
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

export function AdminAttachmentWorkspace({
  priceCheckId,
  attachments,
  canDownload,
  canReconcile,
}: {
  priceCheckId: string;
  attachments: AttachmentItem[];
  canDownload: boolean;
  canReconcile: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Scan status could not be refreshed.");
    } finally { setBusy(false); }
  }
  return <section className="admin-panel admin-attachments" aria-labelledby="attachments-heading">
    <div className="admin-panel-heading"><div><p className="admin-eyebrow">Private evidence</p><h2 id="attachments-heading">Uploaded documents</h2></div>{canReconcile && attachments.some((item) => item.scanState !== "CLEAN" && item.scanState !== "REJECTED") && <button type="button" disabled={busy} onClick={reconcile}>{busy ? "Refreshing…" : "Refresh scan status"}</button>}</div>
    {error && <p className="admin-error" role="alert">{error}</p>}{message && <p className="admin-success" role="status">{message}</p>}
    {attachments.length ? <ul>{attachments.map((item) => <li key={item.id}>
      <div><strong>{item.displayFilename}</strong><span>{bytes(item.byteSize)} · {item.detectedMime ?? item.declaredMime ?? "Type pending"}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div>
      <div><span className={`admin-scan-state state-${item.scanState.toLowerCase()}`}>{stateCopy[item.scanState]}</span>{canDownload && item.scanState === "CLEAN" && <a href={`/api/admin/price-checks/${priceCheckId}/attachments/${item.id}/download`} target="_blank" rel="noreferrer">Download</a>}</div>
    </li>)}</ul> : <p className="admin-muted">No supporting document was uploaded. Manual transaction review remains available.</p>}
    <p className="admin-muted">Only documents that passed AWS malware scanning and server-side file validation can be downloaded.</p>
  </section>;
}

