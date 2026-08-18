"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  SELL_INVENTORY_FRESHNESS_CADENCE_DAYS,
  SELL_INVENTORY_FRESHNESS_TTL_DAYS,
  sellInventoryFreshnessResponseLabels,
  type SellInventoryFreshnessDeliveryState,
  type SellInventoryFreshnessRequestState,
  type SellInventoryFreshnessResponse,
  type SellInventoryFreshnessSubmissionState,
} from "@/db/price-check/domain/sell-inventory-freshness";

/**
 * The bulk-inventory freshness control.
 *
 * Rendered only for `bulk_inventory` records. Small on purpose: it asks a seller
 * one question and records their answer. It does not change the record's status,
 * its business review, its evidence review, or anything about the parts, and the
 * copy in this file says so rather than leaving a reader to infer it.
 *
 * Three pairs of facts are kept apart everywhere in this file, because
 * conflating any of them would tell staff something Civilon does not know:
 *
 *  1. A check Civilon *recorded* versus an e-mail Civilon *delivered*. Issuing
 *     writes a row and queues a message in one transaction, so the check is
 *     certain the moment the button returns; the outbox is the only thing that
 *     knows whether the provider ever accepted it.
 *  2. A provider that accepted a message versus a seller who opened or answered
 *     it. Acceptance is not a read receipt.
 *  3. A seller's answer versus Civilon's confirmation. `all_available` is a
 *     supplier's statement about their own stock, not a Civilon guarantee that
 *     the parts exist, are airworthy, or will be bought.
 *
 * The response carries the expiry and nothing else. It never carries the secure
 * credential or its URL, and neither does this component: staff have no use for
 * the link, and a link on this page would end up in a screenshot.
 */

type LatestCheck = {
  /** Derived on the server from the stored timestamps, never from a browser clock. */
  state: SellInventoryFreshnessRequestState;
  /** Derived on the server from the shared outbox row, never assumed. */
  delivery: SellInventoryFreshnessDeliveryState;
  deliveredAt: string | null;
  response: SellInventoryFreshnessResponse | null;
  requestedByEmail: string | null;
  issuedAt: string;
  expiresAt: string;
  respondedAt: string | null;
  /** When the next check would ordinarily fall due, on the 45-day cadence. */
  dueAt: string | null;
};

const stateLabels: Record<SellInventoryFreshnessRequestState, string> = {
  awaiting_seller: "Awaiting seller",
  answered: "Seller answered",
  expired: "Expired",
  revoked: "Superseded",
};

const submissionStateLabels: Record<SellInventoryFreshnessSubmissionState, string> = {
  never_checked: "Never checked",
  awaiting_seller: "Awaiting seller",
  current: "Current",
  due: "Due",
  some_changed: "Some items changed",
  none_available: "No longer available",
};

const deliveryLabels: Record<SellInventoryFreshnessDeliveryState, string> = {
  queued: "Email queued",
  sending: "Email sending",
  delivered: "Email accepted",
  retrying: "Email retrying",
  undeliverable: "Email not delivered",
  unrecorded: "No email recorded",
};

const deliveryDetails: Record<SellInventoryFreshnessDeliveryState, string> = {
  queued: "The check is recorded and the email is waiting to be sent. Civilon has not delivered it yet.",
  sending: "The check is recorded and Civilon is sending the email now.",
  delivered: "Civilon's email provider accepted the message. That is not a read receipt and not proof the seller opened or answered it.",
  retrying: "A send attempt failed and Civilon will try again. The check itself is recorded.",
  undeliverable: "Civilon stopped trying to send this email. The check is still recorded — reach the seller another way, or issue a new check.",
  unrecorded: "No email is recorded for this check.",
};

/**
 * What each answer means for staff. Every line is about what the *seller* said,
 * and every line stops short of any Civilon conclusion.
 */
const responseDetails: Record<SellInventoryFreshnessResponse, string> = {
  all_available: "The seller stated that everything they offered was still available at that moment. It is their statement, not a Civilon confirmation, and availability remains subject to confirmation.",
  some_changed: "The seller stated that part of the inventory has changed. Follow up before relying on the original list — Civilon does not know which items, and nothing here says.",
  none_available: "The seller stated that none of it is available any more. Do not work the original list. Civilon will not ask again on the ordinary cadence until someone issues a new check.",
};

function stateDetail(check: LatestCheck) {
  switch (check.state) {
    case "answered":
      return "The seller answered and the link is spent. A new check needs a new link.";
    case "revoked":
      return "Replaced by a newer check. The link Civilon sent for it no longer works.";
    case "expired":
      return "The link was not used before it expired. The seller made no statement either way.";
    default:
      return "The check is recorded and the link is live. See the email row for whether Civilon has managed to send it.";
  }
}

export function InventoryFreshnessPanel({
  submissionId,
  submissionState,
  latest,
  canRequest,
  blockedReason,
}: {
  submissionId: string;
  /** Derived on the server from the latest check, or `never_checked`. */
  submissionState: SellInventoryFreshnessSubmissionState;
  latest: LatestCheck | null;
  canRequest: boolean;
  /** Why the control is unavailable, when it is. Never names another record. */
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A stop answer is what makes the reissue meaningful rather than a repeat:
  // the seller has already said the inventory moved, so asking again is a
  // deliberate act rather than a routine one.
  const actionable = submissionState === "some_changed" || submissionState === "none_available";

  async function send() {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/marketplace/sell-submissions/${submissionId}/inventory-freshness`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const payload = await response.json().catch(() => null) as
        { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "The availability check could not be recorded.");
        return;
      }
      // Recorded, not delivered. The transaction guarantees the check row, the
      // audit event and the queued message; it guarantees nothing about what the
      // provider does next, which is what the email row reports once the page
      // reloads.
      setNotice("Check recorded and the email queued. Any earlier link for this submission is revoked.");
      router.refresh();
    } catch {
      setError("The availability check could not be recorded.");
    } finally {
      setPending(false);
    }
  }

  return <section className="admin-panel" aria-label="Bulk inventory freshness">
    <div className="admin-panel-heading"><h2>Is this inventory still available?</h2><span>Queues one secure link</span></div>
    <p className="admin-muted">
      Records a check and queues one account-free email asking the seller whether
      what they offered is still available. The link expires in{" "}
      {SELL_INVENTORY_FRESHNESS_TTL_DAYS} days and replaces any earlier one.
      Civilon would ordinarily ask again about every{" "}
      {SELL_INVENTORY_FRESHNESS_CADENCE_DAYS} days; nothing is scheduled today,
      so every check is issued by hand. A seller&rsquo;s answer is their own
      statement about their stock at that moment: it changes no status, no
      business review and no evidence review, and it is not email verification,
      company verification, supplier approval, certification, authenticity proof,
      airworthiness or regulatory approval, a confirmation of availability, or
      any obligation for Civilon to buy.
    </p>

    <dl className="admin-definition-grid" aria-label="Inventory freshness state">
      <div><dt>Freshness</dt><dd>
        <span className={`admin-status freshness-state-${submissionState}`}>{submissionStateLabels[submissionState]}</span>
      </dd></div>
      {latest ? <>
        <div><dt>Latest check</dt><dd>
          <span className={`admin-status freshness-request-${latest.state}`}>{stateLabels[latest.state]}</span>
        </dd></div>
        <div><dt>Email</dt><dd>
          <span className={`admin-status freshness-delivery-${latest.delivery}`}>{deliveryLabels[latest.delivery]}</span>
          {latest.deliveredAt ? <span className="admin-muted"> · {latest.deliveredAt}</span> : null}
        </dd></div>
        <div><dt>Asked</dt><dd>{latest.issuedAt}{latest.requestedByEmail ? ` · ${latest.requestedByEmail}` : ""}</dd></div>
        <div><dt>Link expires</dt><dd>{latest.expiresAt}</dd></div>
        <div><dt>Seller answered</dt><dd>{latest.respondedAt ?? "—"}</dd></div>
        <div><dt>Next check due</dt><dd>{latest.dueAt ?? "—"}</dd></div>
        <div className="wide"><dt>Seller&rsquo;s answer</dt><dd>{latest.response
          ? <>
              <span className={`admin-status freshness-response-${latest.response}`}>{sellInventoryFreshnessResponseLabels[latest.response]}</span>
              <br /><small className="admin-muted">{responseDetails[latest.response]}</small>
            </>
          : "The seller has not answered this check."}</dd></div>
        <div className="wide"><dt>Detail</dt><dd>
          {stateDetail(latest)} {deliveryDetails[latest.delivery]}
        </dd></div>
      </> : <div className="wide"><dt>Detail</dt><dd>
        Civilon has never asked this seller whether the inventory is still available.
      </dd></div>}
    </dl>

    {actionable && <p className="admin-callout" role="note">
      The seller has told Civilon this inventory changed. Work from that, not
      from the original list. Civilon will not ask again on the ordinary cadence
      until a staff member issues a new check.
    </p>}

    {canRequest
      ? <div className="admin-freshness-request-form">
          <button type="button" onClick={() => void send()} disabled={pending}>
            {pending ? "Recording…" : latest ? "Ask again and queue email" : "Ask the seller and queue email"}
          </button>
        </div>
      : <p className="admin-muted">{blockedReason ?? "You do not have permission to ask a seller about availability."}</p>}

    {error ? <small className="admin-error" role="alert">{error}</small> : null}
    {notice ? <small className="admin-success" role="status">{notice}</small> : null}
  </section>;
}
