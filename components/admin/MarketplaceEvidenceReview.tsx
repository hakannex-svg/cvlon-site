"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const labels: Record<string, string> = {
  not_reviewed: "Not reviewed",
  reviewed: "Reviewed",
  concern: "Concern",
};

export function MarketplaceEvidenceReview({
  submissionId,
  attachmentId,
  filename,
  currentState,
  reviewedBy,
  reviewedAt,
  canReview,
}: {
  submissionId: string;
  attachmentId: string;
  filename: string;
  currentState: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  canReview: boolean;
}) {
  const router = useRouter();
  const [nextState, setNextState] = useState(currentState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    if (pending || nextState === currentState) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/marketplace/sell-submissions/${submissionId}/attachments/${attachmentId}/review`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: nextState }),
        },
      );
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "The evidence review could not be saved.");
        return;
      }
      setNotice("Review saved.");
      router.refresh();
    } catch {
      setError("The evidence review could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return <div className="admin-evidence-review">
    <span className={`admin-status internal-review-${currentState}`}>{labels[currentState] ?? currentState}</span>
    {reviewedBy || reviewedAt ? <small>{reviewedBy ?? "Staff"}{reviewedAt ? ` · ${reviewedAt}` : ""}</small> : null}
    {canReview ? <div className="admin-evidence-review-form">
      <label className="sr-only" htmlFor={`evidence-review-${attachmentId}`}>Review {filename}</label>
      <select
        id={`evidence-review-${attachmentId}`}
        value={nextState}
        onChange={(event) => setNextState(event.target.value)}
        disabled={pending}
      >
        {Object.entries(labels).map(([state, label]) => <option key={state} value={state}>{label}</option>)}
      </select>
      <button type="button" onClick={() => void save()} disabled={pending || nextState === currentState}>
        {pending ? "Saving…" : "Save"}
      </button>
    </div> : null}
    {error ? <small className="admin-error" role="alert">{error}</small> : null}
    {notice ? <small className="admin-success" role="status">{notice}</small> : null}
  </div>;
}
