"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  sellEvidenceCategoryLabels,
  sellEvidenceRequestCategories,
  type SellEvidenceDeliveryState,
  type SellEvidenceRequestCategory,
  type SellEvidenceRequestState,
} from "@/db/price-check/domain/sell-evidence-request";

/**
 * The follow-up evidence request control.
 *
 * Small on purpose. It asks a seller for files Civilon does not have; it does
 * not change the record's status, its internal review, or anything about the
 * parts. The categories that are currently missing are pre-checked because that
 * is almost always the request staff mean to make, and every one of them can be
 * unchecked — nothing is sent that was not explicitly submitted.
 *
 * The response carries the categories and the expiry. It never carries the
 * secure credential or its URL, and neither does this component: staff have no
 * use for the link, and a link on this page would end up in a screenshot.
 *
 * Two facts are kept apart everywhere in this file, because conflating them
 * would tell staff something Civilon does not know. Issuing a request records a
 * row and queues a message in one transaction, so the *request* is certain the
 * moment the button returns. The *e-mail* is only queued at that point, and the
 * outbox is the only thing that knows whether it was ever accepted by the
 * provider — which is itself not proof the seller read it.
 */

type LatestRequest = {
  /** Derived on the server from the stored timestamps, never from a browser clock. */
  state: SellEvidenceRequestState;
  /** Derived on the server from the shared outbox row, never assumed. */
  delivery: SellEvidenceDeliveryState;
  deliveredAt: string | null;
  categories: SellEvidenceRequestCategory[];
  requestedByEmail: string | null;
  issuedAt: string;
  expiresAt: string;
  submittedAttachmentCount: number;
};

const stateLabels: Record<SellEvidenceRequestState, string> = {
  awaiting_seller: "Awaiting seller",
  submitted: "Files received",
  expired: "Expired",
  revoked: "Superseded",
};

const deliveryLabels: Record<SellEvidenceDeliveryState, string> = {
  queued: "Email queued",
  sending: "Email sending",
  delivered: "Email accepted",
  retrying: "Email retrying",
  undeliverable: "Email not delivered",
  unrecorded: "No email recorded",
};

const deliveryDetails: Record<SellEvidenceDeliveryState, string> = {
  queued: "The request is recorded and the email is waiting to be sent. Civilon has not delivered it yet.",
  sending: "The request is recorded and Civilon is sending the email now.",
  delivered: "Civilon's email provider accepted the message. That is not a read receipt and not proof the seller opened it.",
  retrying: "A send attempt failed and Civilon will try again. The request itself is recorded.",
  undeliverable: "Civilon stopped trying to send this email. The request is still recorded — reach the seller another way, or issue a new request.",
  unrecorded: "No email is recorded for this request.",
};

function stateDetail(request: LatestRequest) {
  switch (request.state) {
    case "submitted":
      return `${request.submittedAttachmentCount} file${request.submittedAttachmentCount === 1 ? "" : "s"} bound to this submission. They are in the evidence table above, unreviewed until a staff member reviews them.`;
    case "revoked":
      return "Replaced by a newer request. The link Civilon sent for it no longer works.";
    case "expired":
      return "The link was not used before it expired.";
    default:
      return "The request is recorded and the link is live. See the email row for whether Civilon has managed to send it.";
  }
}

export function SellEvidenceRequestPanel({
  submissionId,
  missingCategories,
  latest,
  canRequest,
  blockedReason,
}: {
  submissionId: string;
  /** Requestable categories with no live attachment. Pre-checked. */
  missingCategories: readonly SellEvidenceRequestCategory[];
  latest: LatestRequest | null;
  canRequest: boolean;
  /** Why the control is unavailable, when it is. Never names another record. */
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<SellEvidenceRequestCategory[]>([...missingCategories]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggle(category: SellEvidenceRequestCategory) {
    setChosen((current) => (
      current.includes(category)
        ? current.filter((entry) => entry !== category)
        : [...current, category]
    ));
  }

  async function send() {
    if (pending || chosen.length === 0) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/marketplace/sell-submissions/${submissionId}/evidence-request`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories: chosen }),
        },
      );
      const payload = await response.json().catch(() => null) as
        { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "The evidence request could not be recorded.");
        return;
      }
      // Recorded, not delivered. The transaction guarantees the request row,
      // the audit event and the queued message; it guarantees nothing about
      // what the provider does next, which is what the email row reports once
      // the page reloads.
      setNotice("Request recorded and the email queued. Any earlier link for this submission is revoked.");
      router.refresh();
    } catch {
      setError("The evidence request could not be recorded.");
    } finally {
      setPending(false);
    }
  }

  return <section className="admin-panel" aria-label="Follow-up evidence request">
    <div className="admin-panel-heading"><h2>Ask the seller for evidence</h2><span>Queues one secure link</span></div>
    <p className="admin-muted">
      Records a request and queues one account-free email to the seller for the
      categories you choose. The link expires in 14 days and replaces any
      earlier one. Asking for evidence, receiving it, and marking it reviewed
      are internal working steps: none of them is email verification, company
      verification, supplier approval, certification, authenticity proof,
      airworthiness or regulatory approval, or a guarantee of quality or
      fitness.
    </p>

    {latest && <dl className="admin-definition-grid" aria-label="Latest evidence request">
      <div><dt>Latest request</dt><dd>
        <span className={`admin-status evidence-request-${latest.state}`}>{stateLabels[latest.state]}</span>
      </dd></div>
      <div><dt>Email</dt><dd>
        <span className={`admin-status evidence-delivery-${latest.delivery}`}>{deliveryLabels[latest.delivery]}</span>
        {latest.deliveredAt ? <span className="admin-muted"> · {latest.deliveredAt}</span> : null}
      </dd></div>
      <div><dt>Requested</dt><dd>{latest.issuedAt}{latest.requestedByEmail ? ` · ${latest.requestedByEmail}` : ""}</dd></div>
      <div><dt>Expires</dt><dd>{latest.expiresAt}</dd></div>
      <div className="wide"><dt>Categories</dt><dd>{latest.categories.length > 0
        ? latest.categories.map((category) => sellEvidenceCategoryLabels[category]).join(", ")
        : "None this build recognises."}</dd></div>
      <div className="wide"><dt>Detail</dt><dd>
        {stateDetail(latest)} {deliveryDetails[latest.delivery]}
      </dd></div>
    </dl>}

    {canRequest ? <div className="admin-evidence-request-form">
      <fieldset>
        <legend>What should the seller send?</legend>
        {sellEvidenceRequestCategories.map((category) => <label key={category} htmlFor={`evidence-request-${category}`}>
          <input
            id={`evidence-request-${category}`}
            type="checkbox"
            checked={chosen.includes(category)}
            onChange={() => toggle(category)}
            disabled={pending}
          />
          <span>{sellEvidenceCategoryLabels[category]}</span>
        </label>)}
      </fieldset>
      <button type="button" onClick={() => void send()} disabled={pending || chosen.length === 0}>
        {pending ? "Recording…" : "Record request and queue email"}
      </button>
    </div> : <p className="admin-muted">{blockedReason ?? "You do not have permission to ask a seller for evidence."}</p>}

    {error ? <small className="admin-error" role="alert">{error}</small> : null}
    {notice ? <small className="admin-success" role="status">{notice}</small> : null}
  </section>;
}
