import { formatDateTime, marketplaceStatusLabels, staffDisplayName, unifiedStatusLabel } from "@/lib/price-check/admin/display";
import { marketplaceExceptionalTargets } from "@/db/price-check/domain/marketplace-status-policy";
import type {
  SellAttachmentMetadata,
  SellSubmissionAdminDetail,
} from "@/db/price-check/repositories/marketplace-admin-repository";
import { MarketplaceDetailActions } from "./MarketplaceDetailActions";
import type { MarketplaceActionContext } from "@/lib/price-check/admin/marketplace-access";
import { summarizeEvidenceCategories } from "@/db/price-check/domain/internal-review";
import { MarketplaceEvidenceReview } from "./MarketplaceEvidenceReview";
import {
  AssignmentPanel,
  AttributionPanel,
  Field,
  MarketplaceAuditTimeline,
  MarketplaceContactPanel,
  MarketplaceNotesPanel,
  value,
} from "./MarketplaceShared";

const conditionLabels: Record<string, string> = {
  NE: "New", NS: "New surplus", OH: "Overhauled", SV: "Serviceable",
  AR: "As removed", ANY: "Any condition", NOT_SURE: "Not sure",
};

const purposeLabels: Record<string, string> = {
  INVENTORY_SPREADSHEET: "Bulk inventory file",
  WAREHOUSE_BUSINESS_EVIDENCE: "Warehouse / business evidence",
  CUSTODY_PART_PHOTO: "Part / custody photo",
  PART_NUMBER_SERIAL_PHOTO: "Part number / serial view",
  RELEASE_SUPPORTING_DOCUMENT: "Supporting documentation",
  OTHER: "Other",
};

const evidenceSummaryLabels: Record<string, string> = {
  missing: "Missing",
  not_reviewed: "Supplied — not reviewed",
  reviewed: "Reviewed",
  concern: "Concern",
};

/**
 * Evidence is described honestly and never claimed to certify anything: these
 * are files a seller supplied, not a Civilon authentication of a part.
 */
const scanStateCopy: Record<string, { label: string; note: string }> = {
  CLEAN: { label: "Clean", note: "Scanned clean." },
  PENDING: { label: "Scan pending", note: "Not yet cleared for review." },
  QUARANTINED: { label: "Quarantined", note: "Held. Do not treat as reviewable evidence." },
  REJECTED: { label: "Rejected", note: "Rejected by scanning. Do not treat as evidence." },
  FAILED: { label: "Scan unavailable", note: "Scan state could not be established." },
};

function money(amount: string | null, currency: string | null, quoteOnRequest: boolean) {
  if (quoteOnRequest || !amount) return "Quote on request";
  return `${amount} ${currency ?? ""}`.trim();
}

function byteSize(input: string) {
  const bytes = Number(input);
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EvidenceRow({ attachment, submissionId, canDownload, canReview }: {
  attachment: SellAttachmentMetadata;
  submissionId: string;
  canDownload: boolean;
  canReview: boolean;
}) {
  const scan = scanStateCopy[attachment.scanState] ?? { label: attachment.scanState, note: "Unrecognised scan state." };
  // Only a stored-clean, undeleted row is offered at all. The route re-reads the
  // live scan tag before signing, so this link is a convenience, not the control.
  const storedClean = attachment.scanState === "CLEAN" && !attachment.deletedAt;
  // A role without `download_marketplace_evidence` is told so plainly. Offering
  // the link anyway would send an AUDITOR to a raw 403 and read as a fault in
  // the file rather than the honest answer, which is about their permissions.
  const usable = storedClean && canDownload;
  return <tr className={usable ? undefined : "is-unavailable"}>
    <td data-label="File">{attachment.displayFilename}</td>
    <td data-label="Purpose">{purposeLabels[attachment.purpose] ?? attachment.purpose}</td>
    <td data-label="Size">{byteSize(attachment.byteSize)}</td>
    <td data-label="Declared type">{value(attachment.declaredMime)}</td>
    <td data-label="Detected type">{value(attachment.detectedMime)}</td>
    <td data-label="Scan state"><span className={`admin-status scan-${attachment.scanState}`}>{scan.label}</span></td>
    <td data-label="Retention">{value(attachment.retentionClass)}</td>
    <td data-label="Uploaded">{formatDateTime(attachment.createdAt)}</td>
    <td data-label="Internal review"><MarketplaceEvidenceReview
      submissionId={submissionId}
      attachmentId={attachment.id}
      filename={attachment.displayFilename}
      currentState={attachment.reviewState}
      reviewedBy={attachment.reviewedByEmail}
      reviewedAt={attachment.reviewedAt ? formatDateTime(attachment.reviewedAt) : null}
      canReview={canReview && storedClean}
    /></td>
    <td data-label="Availability">{usable
      ? <a className="admin-evidence-open" href={`/api/admin/marketplace/sell-submissions/${submissionId}/attachments/${attachment.id}/download`} rel="noreferrer">Open securely</a>
      : <span className="admin-evidence-unavailable">{storedClean
        ? "You do not have permission to open this file."
        : attachment.deletedAt ? "Deleted — unavailable" : `Unavailable — ${scan.note}`}</span>}</td>
  </tr>;
}

export function SellSubmissionDetail({ detail, actions, canDownloadEvidence }: { detail: SellSubmissionAdminDetail; actions: MarketplaceActionContext; canDownloadEvidence: boolean }) {
  const submission = detail.sellSubmission;
  const bulk = submission.submissionKind === "bulk_inventory";
  const evidenceSummary = summarizeEvidenceCategories(detail.attachments);
  return <section className="admin-page">
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate plain anchor for resilient admin navigation */}
    <a className="admin-back" href="/admin/sell-submissions">← Sell Submissions</a>

    <header className="admin-triage-header">
      <div>
        <p className="admin-eyebrow">Sell Submission</p>
        <h1>{submission.publicReference}</h1>
        <p>An offer to sell parts to Civilon. Evidence supplied here does not certify, authenticate or approve anything; documentation varies and all availability is subject to confirmation.</p>
      </div>
      <dl>
        <div><dt>Status</dt><dd>{unifiedStatusLabel("sell_submission", submission.status)}</dd></div>
        <div><dt>Kind</dt><dd>{bulk ? "Bulk inventory" : "Single part"}</dd></div>
        <div><dt>Received</dt><dd>{formatDateTime(submission.submittedAt)}</dd></div>
        <div><dt>Assigned</dt><dd>{staffDisplayName(detail.assignee?.email ?? null)}</dd></div>
      </dl>
    </header>

    <div className="admin-detail-grid">
      <div className="admin-detail-main">
        <section className="admin-panel" aria-label="Offered parts">
          <div className="admin-panel-heading"><h2>Offered</h2><span>Seller intake</span></div>
          <dl className="admin-definition-grid">
            <Field label="Submission kind">{bulk ? "Bulk inventory" : "Single part"}</Field>
            <Field label="Part number">{submission.originalPartNumber ? <code>{submission.originalPartNumber}</code> : "—"}</Field>
            <Field label="Normalized">{submission.normalizedPartNumber ? <code>{submission.normalizedPartNumber}</code> : "—"}</Field>
            <Field label="Quantity">{value(submission.quantity)}</Field>
            <Field label="Condition">{submission.conditionCode ? (conditionLabels[submission.conditionCode] ?? submission.conditionCode) : "—"}</Field>
            <Field label="Asking price">{money(submission.askingUnitPrice, submission.currencyCode, submission.quoteOnRequest)}</Field>
            <Field label="Estimated line items">{value(submission.estimatedLineItemCount)}</Field>
            <Field label="Can ship to New Jersey">{value(submission.canShipToNewJersey)}</Field>
            <Field label="Description" wide>{value(submission.description)}</Field>
            <Field label="Documentation summary" wide>{value(submission.documentsSummary)}</Field>
            <Field label="Seller notes" wide>{value(submission.customerNotes)}</Field>
          </dl>
        </section>

        <section className="admin-panel" aria-label="Seller location">
          <div className="admin-panel-heading"><h2>Location &amp; shipping</h2><span>Seller intake</span></div>
          <dl className="admin-definition-grid">
            <Field label="Country">{value(submission.locationCountry)}</Field>
            <Field label="State / region">{value(submission.locationStateRegion)}</Field>
            <Field label="City">{value(submission.locationCity)}</Field>
            <Field label="Postal code">{value(submission.locationPostalCode)}</Field>
            <Field label="Can ship to New Jersey">{value(submission.canShipToNewJersey)}</Field>
          </dl>
        </section>

        <section className="admin-panel" aria-label="Inventory line items">
          <div className="admin-panel-heading"><h2>Line items ({detail.items.length})</h2><span>Read only</span></div>
          {detail.items.length === 0
            ? <p className="admin-muted">No parsed line items are recorded for this submission.</p>
            : <div className="admin-table-wrap"><table className="admin-queue-table">
                <caption className="sr-only">Sell Submission line items</caption>
                <thead><tr><th>#</th><th>Part number</th><th>Description</th><th>Qty</th><th>Condition</th><th>Asking price</th><th>Location</th><th>Documentation</th><th>Source row</th></tr></thead>
                <tbody>{detail.items.map(item => <tr key={item.id}>
                  <td data-label="#">{item.lineNumber}</td>
                  <td data-label="Part number">{item.originalPartNumber ? <code>{item.originalPartNumber}</code> : "—"}</td>
                  <td data-label="Description">{value(item.description)}</td>
                  <td data-label="Qty">{value(item.quantity)}</td>
                  <td data-label="Condition">{item.conditionCode ? (conditionLabels[item.conditionCode] ?? item.conditionCode) : "—"}</td>
                  <td data-label="Asking price">{money(item.askingUnitPrice, item.currencyCode, item.quoteOnRequest)}</td>
                  <td data-label="Location">{value(item.locationText)}</td>
                  <td data-label="Documentation">{value(item.documentsSummary)}</td>
                  <td data-label="Source row">{value(item.sourceRowReference)}</td>
                </tr>)}</tbody>
              </table></div>}
        </section>

        <section className="admin-panel" aria-label="Seller evidence">
          <div className="admin-panel-heading"><h2>Evidence ({detail.attachments.length})</h2><span>Metadata only</span></div>
          <p className="admin-muted">Evidence is what the seller supplied: warehouse or business evidence, part and custody photos, part number or serial views, supporting documentation, and bulk inventory files. It does not certify, authenticate or approve any part, it is not an airworthiness approval, it does not guarantee authenticity or fitness, and staff review is not regulatory approval. Files are held privately: opening one is authenticated, recorded, and only offered while the malware scan is clean and your role permits it.</p>
          <dl className="admin-definition-grid" aria-label="Evidence category summary">
            {evidenceSummary.map(category => <Field key={category.purpose} label={purposeLabels[category.purpose] ?? category.purpose}>
              <span className={`admin-status evidence-summary-${category.state}`}>{evidenceSummaryLabels[category.state] ?? category.state}</span>
              {category.count > 0 ? ` (${category.count})` : ""}
            </Field>)}
          </dl>
          {detail.attachments.length === 0
            ? <p className="admin-muted">No evidence was attached to this submission.</p>
            : <div className="admin-table-wrap"><table className="admin-queue-table">
                <caption className="sr-only">Seller evidence metadata</caption>
                <thead><tr><th>File</th><th>Purpose</th><th>Size</th><th>Declared type</th><th>Detected type</th><th>Scan state</th><th>Retention</th><th>Uploaded</th><th>Internal review</th><th>Availability</th></tr></thead>
                <tbody>{detail.attachments.map(attachment => <EvidenceRow key={attachment.id} attachment={attachment} submissionId={submission.id} canDownload={canDownloadEvidence} canReview={actions.canReview} />)}</tbody>
              </table></div>}
        </section>

        <MarketplaceContactPanel contact={detail.contact} />
        <MarketplaceNotesPanel notes={detail.notes} />
        <MarketplaceAuditTimeline audit={detail.audit} />
      </div>

        <MarketplaceDetailActions
          basePath="/api/admin/marketplace/sell-submissions"
          recordId={submission.id}
          currentStatus={submission.status}
          businessReviewState={detail.contact.businessReviewState}
          statusOptions={actions.statusOptions}
          statusLabels={marketplaceStatusLabels}
          assigneeId={detail.assignee?.id ?? null}
          staff={actions.staff}
          exceptionalStatuses={marketplaceExceptionalTargets}
          canAssign={actions.canAssign}
          canTransition={actions.canTransition}
          canWriteNote={actions.canWriteNote}
          canReview={actions.canReview}
        />
      <div className="admin-detail-aside">
        <AssignmentPanel
          assignee={detail.assignee}
          verificationState={submission.verificationState}
          status={<span className={`admin-status status-${submission.status}`}>{unifiedStatusLabel("sell_submission", submission.status)}</span>}
        />
        <section className="admin-panel" aria-label="Record timestamps">
          <div className="admin-panel-heading"><h2>Record</h2><span>System of record</span></div>
          <dl className="admin-definition-grid">
            <Field label="Reference"><code>{submission.publicReference}</code></Field>
            <Field label="Received">{value(submission.submittedAt)}</Field>
            <Field label="Verification requested">{value(submission.verificationRequestedAt)}</Field>
            <Field label="Workflow verification gate cleared" wide>{value(submission.verifiedAt)}
              <br /><small className="admin-muted">A technical workflow timestamp. It records that this record passed a verification gate, either by customer e-mail confirmation or by an audited staff override. It is not proof the customer confirmed their address — the contact panel is authoritative for that.</small>
            </Field>
            <Field label="Last updated">{value(submission.updatedAt)}</Field>
            <Field label="Closed">{value(submission.closedAt)}</Field>
          </dl>
        </section>
        <AttributionPanel attribution={submission} />
      </div>
    </div>
  </section>;
}
