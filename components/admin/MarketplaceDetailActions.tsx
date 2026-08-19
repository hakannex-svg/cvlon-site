"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NOTE_MAX_LENGTH, UNASSIGNED_VALUE } from "@/lib/marketplace/admin/validation";

/**
 * The record-level write surface on a marketplace detail page. Seller evidence
 * rows use their own narrowly scoped review control beside the relevant file.
 *
 * Kept in its own client component so the detail views stay server-rendered and
 * free of any mutation path. Nothing here notifies a buyer or a supplier, sends
 * mail, or emits analytics: a staff action changes the record and the audit
 * trail, and the record is the system of record.
 */

type Staff = { id: string; displayEmail: string };

export function MarketplaceDetailActions({
  basePath, recordId, currentStatus, statusOptions, statusLabels,
  businessReviewState, assigneeId, staff, exceptionalStatuses,
  canAssign, canTransition, canWriteNote, canReview,
  noteTemplate, noteTemplateLabel,
}: {
  /** `/api/admin/marketplace/buy-requests` or the Sell equivalent. */
  basePath: string;
  recordId: string;
  currentStatus: string;
  /** Only the transitions this staff member is actually authorized to make. */
  statusOptions: readonly string[];
  statusLabels: Record<string, string>;
  businessReviewState: string;
  assigneeId: string | null;
  staff: readonly Staff[];
  /** Rendered with a warning; they end or override a customer's record. */
  exceptionalStatuses: readonly string[];
  canAssign: boolean;
  canTransition: boolean;
  canWriteNote: boolean;
  canReview: boolean;
  /**
   * Optional starting text for the internal note box, offered by a detail view
   * that has a workflow worth prompting for. Absent on every surface that has
   * none, and its absence is the whole feature being off: no control renders,
   * and the note form behaves exactly as it did before.
   *
   * It fills the box and stops there. It never submits, and it is refused while
   * the box holds text, so a template can never replace something a staff
   * member wrote. Saving remains the one existing audited note route.
   */
  noteTemplate?: string;
  /** What the control is called. Only read when `noteTemplate` is present. */
  noteTemplateLabel?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState("");
  const [nextBusinessReview, setNextBusinessReview] = useState("");
  const [note, setNote] = useState("");

  async function post(action: string, path: string, body: unknown, successMessage: string, onDone?: () => void) {
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${basePath}/${recordId}/${path}`, {
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
      setNotice(successMessage);
      onDone?.();
      router.refresh();
    } catch {
      setError("That action could not be completed.");
    } finally {
      setPending(null);
    }
  }

  const label = (status: string) => statusLabels[status] ?? status.replaceAll("_", " ");
  const busy = pending !== null;
  const businessReviewLabels: Record<string, string> = {
    not_reviewed: "Not reviewed",
    reviewed: "Reviewed",
    concern: "Concern",
  };

  // Refused on any text at all, not merely on text that survives trimming: the
  // cheapest rule to state is the one a reader can be sure of, and a staff
  // member who wants the template can empty the box.
  const templateBlocked = note.length > 0;

  return <section className="admin-panel admin-actions-panel" id="record-actions" aria-label="Record actions">
    <div className="admin-panel-heading"><h2>Actions</h2><span>Recorded in the audit trail</span></div>

    {error ? <p className="admin-error" role="alert">{error}</p> : null}
    {notice ? <p className="admin-success" role="status">{notice}</p> : null}

    {canTransition && statusOptions.length > 0 ? (
      <form className="admin-inline-form" onSubmit={(event) => {
        event.preventDefault();
        if (!nextStatus) return;
        void post("status", "status", { expectedStatus: currentStatus, to: nextStatus }, `Status changed to ${label(nextStatus)}.`, () => setNextStatus(""));
      }}>
        <label>
          <span>Change status</span>
          <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} disabled={busy}>
            <option value="">Keep {label(currentStatus)}</option>
            {statusOptions.map((status) => <option key={status} value={status}>
              {label(status)}{exceptionalStatuses.includes(status) ? " (ends the record)" : ""}
            </option>)}
          </select>
        </label>
        <button type="submit" disabled={busy || !nextStatus}>{pending === "status" ? "Saving…" : "Apply"}</button>
      </form>
    ) : <p className="admin-muted">You do not have permission to change this record&apos;s status, or it has reached a final state.</p>}

    {canReview ? (
      <form className="admin-inline-form" onSubmit={(event) => {
        event.preventDefault();
        if (!nextBusinessReview) return;
        void post(
          "business-review",
          "business-review",
          { state: nextBusinessReview },
          `Internal business review changed to ${businessReviewLabels[nextBusinessReview] ?? nextBusinessReview}.`,
          () => setNextBusinessReview(""),
        );
      }}>
        <label>
          <span>Internal business review</span>
          <select value={nextBusinessReview} onChange={(event) => setNextBusinessReview(event.target.value)} disabled={busy}>
            <option value="">Keep {businessReviewLabels[businessReviewState] ?? businessReviewState}</option>
            {Object.entries(businessReviewLabels)
              .filter(([state]) => state !== businessReviewState)
              .map(([state, reviewLabel]) => <option key={state} value={state}>{reviewLabel}</option>)}
          </select>
          <small>Internal only. This is not certification or regulatory approval.</small>
        </label>
        <button type="submit" disabled={busy || !nextBusinessReview}>{pending === "business-review" ? "Saving…" : "Save review"}</button>
      </form>
    ) : null}

    {canAssign ? (
      <form className="admin-inline-form" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const value = String(form.get("assigneeId") ?? "");
        void post("assignment", "assignment", { assigneeId: value || UNASSIGNED_VALUE }, "Assignment saved.");
      }}>
        <label>
          <span>Assign to</span>
          <select name="assigneeId" defaultValue={assigneeId ?? ""} disabled={busy}>
            <option value="">Unassigned</option>
            {staff.map((member) => <option key={member.id} value={member.id}>{member.displayEmail}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy}>{pending === "assignment" ? "Saving…" : "Save"}</button>
      </form>
    ) : null}

    {canWriteNote ? (
      <form className="admin-form-grid" onSubmit={(event) => {
        event.preventDefault();
        if (!note.trim()) return;
        void post("note", "notes", { body: note }, "Note added.", () => setNote(""));
      }}>
        <label className="full">
          <span>Internal note <em>Staff only. Never sent to a buyer or a supplier.</em></span>
          <textarea
            name="body"
            value={note}
            maxLength={NOTE_MAX_LENGTH}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What happened, and what the next person needs to know."
            disabled={busy}
          />
        </label>
        {noteTemplate ? <div className="admin-note-template">
          <button
            type="button"
            disabled={busy || templateBlocked}
            onClick={() => { if (templateBlocked || !noteTemplate) return; setNote(noteTemplate); }}
          >{noteTemplateLabel ?? "Insert template"}</button>
          <small>{templateBlocked
            ? "Clear the note box first. The template will not replace text you have written."
            : "Fills the box only. It saves nothing, and it never replaces text you have written."}</small>
        </div> : null}
        <button type="submit" disabled={busy || !note.trim()}>{pending === "note" ? "Saving…" : "Add note"}</button>
      </form>
    ) : null}
  </section>;
}
