import type { ReactNode } from "react";
import { formatDateTime, staffDisplayName } from "@/lib/price-check/admin/display";
import type {
  MarketplaceAssignee,
  MarketplaceAuditRecord,
  MarketplaceContactSummary,
  MarketplaceNoteRecord,
} from "@/db/price-check/repositories/marketplace-admin-repository";

/** The banner every internal-only section carries. */
export const INTERNAL_ONLY_LABEL = "Internal — never shown to buyer";

export function InternalOnlyBadge() {
  return <span className="admin-internal-badge">{INTERNAL_ONLY_LABEL}</span>;
}

export function value(input: string | number | boolean | Date | null | undefined) {
  if (input === null || input === undefined || input === "") return "—";
  if (input instanceof Date) return formatDateTime(input);
  if (typeof input === "boolean") return input ? "Yes" : "No";
  return String(input);
}

export function Field({ label, children, wide = false }: { label: string; children?: ReactNode; wide?: boolean }) {
  return <div className={wide ? "wide" : undefined}>
    <dt>{label}</dt>
    <dd>{children ?? "—"}</dd>
  </div>;
}

/**
 * Reports the customer's own confirmation, taken from the contact record. A
 * staff override of the workflow status never reaches this chip.
 */
export function VerificationChip({ state }: { state: "verified" | "pending" }) {
  return state === "verified"
    ? <span className="admin-status status-verified">Verified</span>
    : <span className="admin-status status-pending_verification">Awaiting verification</span>;
}

export function AssignmentPanel({ assignee, status, verificationState }: {
  assignee: MarketplaceAssignee;
  status: ReactNode;
  verificationState: "verified" | "pending";
}) {
  return <section className="admin-panel" aria-label="Status and assignment">
    <div className="admin-panel-heading"><h2>Status</h2><span>Read only</span></div>
    <dl className="admin-definition-grid">
      <Field label="Workflow status">{status}</Field>
      <Field label="Contact verification"><VerificationChip state={verificationState} /></Field>
      <Field label="Assigned to">{staffDisplayName(assignee?.email ?? null)}</Field>
      <Field label="Assignment controls">Available to authorized staff in the Actions panel</Field>
    </dl>
  </section>;
}

export function MarketplaceContactPanel({ contact }: { contact: MarketplaceContactSummary }) {
  return <section className="admin-panel" aria-label="Company and contact">
    <div className="admin-panel-heading"><h2>Company &amp; contact</h2><span>Submitted by the customer</span></div>
    <dl className="admin-definition-grid">
      <Field label="Company">{value(contact.companyName)}</Field>
      <Field label="Contact">{value(`${contact.firstName} ${contact.lastName}`.trim())}</Field>
      <Field label="Business email"><a href={`mailto:${contact.businessEmail}`}>{contact.businessEmail}</a></Field>
      <Field label="Telephone">{value(contact.phone)}</Field>
      <Field label="Role">{value(contact.role)}</Field>
      <Field label="Website">{value(contact.websiteUrl)}</Field>
      <Field label="Country">{value(contact.country)}</Field>
      <Field label="State / region">{value(contact.stateRegion)}</Field>
      <Field label="City">{value(contact.city)}</Field>
      <Field label="Postal code">{value(contact.postalCode)}</Field>
      <Field label="Acts as buyer">{value(contact.actsAsBuyer)}</Field>
      <Field label="Acts as seller">{value(contact.actsAsSeller)}</Field>
      <Field label="Contact verification state">{value(contact.verificationState)}</Field>
      <Field label="Contact verified at">{value(contact.verifiedAt)}</Field>
      <Field label="Deletion requested">{value(contact.deletionRequestedAt)}</Field>
      <Field label="Deleted">{value(contact.deletedAt)}</Field>
    </dl>
  </section>;
}

export function AttributionPanel({ attribution }: {
  attribution: {
    sourcePage: string;
    landingPage: string | null;
    referrerOrigin: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
  };
}) {
  return <details className="admin-panel admin-history-disclosure">
    <summary><b>Source &amp; attribution</b></summary>
    <dl className="admin-definition-grid">
      <Field label="Source page">{value(attribution.sourcePage)}</Field>
      <Field label="Landing page">{value(attribution.landingPage)}</Field>
      <Field label="Referrer origin">{value(attribution.referrerOrigin)}</Field>
      <Field label="utm_source">{value(attribution.utmSource)}</Field>
      <Field label="utm_medium">{value(attribution.utmMedium)}</Field>
      <Field label="utm_campaign">{value(attribution.utmCampaign)}</Field>
      <Field label="utm_content">{value(attribution.utmContent)}</Field>
      <Field label="utm_term">{value(attribution.utmTerm)}</Field>
    </dl>
  </details>;
}

export function MarketplaceNotesPanel({ notes }: { notes: MarketplaceNoteRecord[] }) {
  return <section className="admin-panel" aria-label="Internal notes">
    <div className="admin-panel-heading"><h2>Internal notes</h2><InternalOnlyBadge /></div>
    {notes.length === 0
      ? <p className="admin-muted">No internal notes recorded yet.</p>
      : <ul className="admin-note-list">{notes.map(note => <li key={note.id}>
          <p className="admin-note-meta">
            <b>{staffDisplayName(note.authorEmail)}</b>
            <time dateTime={new Date(note.createdAt).toISOString()}>{formatDateTime(note.createdAt)}</time>
            {note.redactedAt ? <em>Redacted {formatDateTime(note.redactedAt)}</em> : null}
          </p>
          <p className="admin-note-body">{note.redactedAt ? "This note was redacted." : note.body}</p>
        </li>)}</ul>}
  </section>;
}

export function MarketplaceAuditTimeline({ audit }: { audit: MarketplaceAuditRecord[] }) {
  return <details className="admin-panel admin-history-disclosure">
    <summary><b>Activity ({audit.length})</b></summary>
    {audit.length === 0
      ? <p className="admin-muted">No recorded activity.</p>
      : <ul className="admin-timeline">{audit.map(event => <li key={event.id}>
          <span><time dateTime={new Date(event.createdAt).toISOString()}>{formatDateTime(event.createdAt)}</time></span>
          <strong>{event.action}</strong>
          <span>{event.afterVersionReference ?? event.beforeVersionReference ?? event.actorType}</span>
        </li>)}</ul>}
  </details>;
}
