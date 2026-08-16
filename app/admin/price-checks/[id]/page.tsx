import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { AdminDetailActions } from "@/components/admin/AdminDetailActions";
import { getPriceCheckAdminAccess } from "@/lib/price-check/admin/auth";
import { formatAge, formatDateTime, formatMoney, staffDisplayName, statusLabels } from "@/lib/price-check/admin/display";
import { allowedOperationalStatuses, roleCan } from "@/lib/price-check/admin/policy";
import { canTransitionPriceCheck } from "@/db/price-check/domain/status-policy";
import { AOG_TEL_URL, buildAogWhatsAppUrl } from "@/lib/aog";

function value(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).replaceAll("_", " ");
}

export default async function PriceCheckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getPriceCheckAdminAccess();
  if (access.status === "disabled") notFound();
  if (access.status === "unauthenticated") redirect("/admin/login");
  if (access.status === "forbidden") redirect("/admin/access-denied");
  if (access.status === "unavailable") return <AdminAccessDenied unavailable />;
  const { id } = await params;
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) notFound();

  let detail;
  let validStatuses: string[] = [];
  try {
    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    detail = await repository.getAdminPriceCheckDetail(priceCheckDb, id);
    if (detail) validStatuses = repository.validNextStatuses(detail.priceCheck.status, allowedOperationalStatuses(access.user.role));
  } catch {
    return <AdminAccessDenied unavailable />;
  }
  if (!detail) notFound();

  const { priceCheck, requester, assignee, documentation, revisions, audit, jobs, admins } = detail;
  const latestRevision = revisions[0];
  const reviewedSnapshot = latestRevision?.version > 1 ? latestRevision.normalizedSnapshot as Record<string, unknown> : null;
  const revisionDefaults: Record<string, string | boolean | string[] | null> = {
    originalPartNumber: priceCheck.originalPartNumber,
    description: priceCheck.description,
    quantity: priceCheck.quantity,
    quoteOrPurchased: priceCheck.quoteOrPurchased,
    transactionType: priceCheck.transactionType,
    conditionCode: priceCheck.conditionCode,
    unitPrice: priceCheck.unitPrice,
    currencyCode: priceCheck.currencyCode,
    coreCharge: priceCheck.coreCharge,
    coreDisposition: priceCheck.coreDisposition,
    exchangeFee: priceCheck.exchangeFee,
    freight: priceCheck.freight,
    transactionDate: priceCheck.transactionDate,
    aircraftModel: priceCheck.aircraftModel,
    aog: priceCheck.aog,
    warrantyValue: priceCheck.warrantyValue,
    warrantyUnit: priceCheck.warrantyUnit,
    warrantyText: priceCheck.warrantyText,
    documentationCodes: documentation.map(item => item.requirementCode),
    notes: priceCheck.notes,
    ...reviewedSnapshot,
  };
  const whatsapp = buildAogWhatsAppUrl({
    partNumber: priceCheck.originalPartNumber,
    quantity: priceCheck.quantity,
    aircraftTypeTail: priceCheck.aircraftModel ?? "",
    nameCompany: `${requester.firstName} ${requester.lastName} / ${requester.companyName}`,
  });

  return <AdminChrome user={access.user}>
    <section className="admin-page admin-detail-page">
      <Link className="admin-back" href="/admin/price-checks">← Review queue</Link>
      <header className={`admin-triage-header ${priceCheck.aog ? "is-aog" : ""}`}>
        <div><p className="admin-eyebrow">Price Check reference</p><h1>{priceCheck.publicReference}</h1><p>Submitted <time dateTime={priceCheck.submittedAt.toISOString()}>{formatDateTime(priceCheck.submittedAt)}</time></p></div>
        <dl>
          <div><dt>Status</dt><dd><span className={`admin-status status-${priceCheck.status}`}>{statusLabels[priceCheck.status]}</span></dd></div>
          <div><dt>Urgency</dt><dd>{priceCheck.aog ? <span className="admin-aog-badge">AOG</span> : "Routine"}</dd></div>
          <div><dt>Assignee</dt><dd>{staffDisplayName(assignee?.displayEmail ?? null)}</dd></div>
          <div><dt>Age</dt><dd>{formatAge(priceCheck.submittedAt)}</dd></div>
        </dl>
      </header>

      {priceCheck.aog && <section className="admin-aog-panel" aria-label="AOG contact actions"><div><strong>Active AOG context</strong><p>Price Check administration supports review only; operational dispatch remains with Civilon’s monitored AOG desk.</p><p className="admin-aog-callback">Callback: <a href={requester.phone ? `tel:${requester.normalizedPhone ?? requester.phone}` : AOG_TEL_URL}>{requester.phone ?? "Not provided"}</a></p></div><div><a href={AOG_TEL_URL}>Call AOG desk</a><a href={whatsapp} target="_blank" rel="noreferrer">WhatsApp AOG</a></div></section>}

      <div className="admin-detail-grid">
        <div className="admin-detail-main">
          <section className="admin-panel" aria-labelledby="requester-heading"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Authorized contact data</p><h2 id="requester-heading">Requester</h2></div></div><dl className="admin-definition-grid">
            <div><dt>Name</dt><dd>{requester.firstName} {requester.lastName}</dd></div><div><dt>Company</dt><dd>{requester.companyName}</dd></div><div><dt>Business email</dt><dd><a href={`mailto:${requester.businessEmail}`}>{requester.businessEmail}</a></dd></div><div><dt>Phone</dt><dd>{requester.phone ? <a href={`tel:${requester.normalizedPhone ?? requester.phone}`}>{requester.phone}</a> : "—"}</dd></div><div><dt>Role</dt><dd>{value(requester.role)}</dd></div><div><dt>Country</dt><dd>{value(requester.country)}</dd></div><div className="wide"><dt>Processing acknowledgment</dt><dd>{formatDateTime(requester.serviceProcessingAcknowledgedAt)}</dd></div>
          </dl></section>

          <section className="admin-panel" aria-labelledby="original-heading"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Immutable record</p><h2 id="original-heading">Original submission</h2></div><span>Revision 1</span></div><dl className="admin-definition-grid">
            <div><dt>Part number</dt><dd><code>{priceCheck.originalPartNumber}</code></dd></div><div><dt>Normalized part</dt><dd><code>{priceCheck.normalizedPartNumber}</code></dd></div><div><dt>Description</dt><dd>{value(priceCheck.description)}</dd></div><div><dt>Quantity</dt><dd>{priceCheck.quantity}</dd></div><div><dt>Quote status</dt><dd>{value(priceCheck.quoteOrPurchased)}</dd></div><div><dt>Transaction</dt><dd>{value(priceCheck.transactionType)}</dd></div><div><dt>Condition</dt><dd>{priceCheck.conditionCode}</dd></div><div><dt>Unit price</dt><dd>{formatMoney(priceCheck.unitPrice, priceCheck.currencyCode)}</dd></div><div><dt>Core charge</dt><dd>{priceCheck.coreCharge ? formatMoney(priceCheck.coreCharge, priceCheck.currencyCode) : "—"}</dd></div><div><dt>Core disposition</dt><dd>{value(priceCheck.coreDisposition)}</dd></div><div><dt>Exchange fee</dt><dd>{priceCheck.exchangeFee ? formatMoney(priceCheck.exchangeFee, priceCheck.currencyCode) : "—"}</dd></div><div><dt>Freight</dt><dd>{priceCheck.freight ? formatMoney(priceCheck.freight, priceCheck.currencyCode) : "—"}</dd></div><div><dt>Transaction date</dt><dd>{value(priceCheck.transactionDate)}</dd></div><div><dt>Aircraft / model</dt><dd>{value(priceCheck.aircraftModel)}</dd></div><div><dt>AOG</dt><dd>{value(priceCheck.aog)}</dd></div><div><dt>Warranty</dt><dd>{priceCheck.warrantyValue ? `${priceCheck.warrantyValue} ${value(priceCheck.warrantyUnit)}` : value(priceCheck.warrantyText)}</dd></div><div className="wide"><dt>Notes</dt><dd>{value(priceCheck.notes)}</dd></div>
          </dl></section>

          <section className="admin-panel" aria-labelledby="reviewed-heading"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Versioned review</p><h2 id="reviewed-heading">Reviewed transaction</h2></div>{reviewedSnapshot && <span>Revision {latestRevision.version}</span>}</div>{reviewedSnapshot ? <><dl className="admin-definition-grid">{Object.entries(reviewedSnapshot).filter(([key]) => key !== "documentationCodes").map(([key, item]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{value(item)}</dd></div>)}</dl><p className="admin-revision-reason"><b>Change reason:</b> {latestRevision.changeReason}</p></> : <div className="admin-empty-state"><strong>No staff correction has been created.</strong><p>Analysis will use the original submitted transaction until an authorized revision is saved.</p></div>}</section>

          <section className="admin-panel" aria-labelledby="docs-heading"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Requirements</p><h2 id="docs-heading">Documentation</h2></div></div>{documentation.length ? <ul className="admin-chip-list">{documentation.map(item => <li key={item.requirementCode}>{item.requirementCode.replaceAll("_", " ")}{item.otherText ? ` — ${item.otherText}` : ""}</li>)}</ul> : <p className="admin-muted">No documentation requirements were selected.</p>}<p className="admin-muted">Secure document upload remains unavailable in Phase 4.</p></section>

          <section className="admin-panel admin-placeholder"><p className="admin-eyebrow">Analysis</p><h2>No pricing analysis has been prepared yet.</h2><p>Deterministic comparable selection and pricing calculations are deferred to the next approved phase.</p></section>
          <section className="admin-panel admin-placeholder"><p className="admin-eyebrow">Customer result</p><h2>No customer result has been approved.</h2><p>Phase 4 does not send results or transactional email.</p></section>

          <section className="admin-panel" aria-labelledby="audit-heading"><div className="admin-panel-heading"><div><p className="admin-eyebrow">Append-only record</p><h2 id="audit-heading">Audit timeline</h2></div></div><ol className="admin-timeline">{audit.map(event => <li key={event.id}><time>{formatDateTime(event.createdAt)}</time><strong>{event.action.replaceAll("_", " ").replaceAll(".", " ")}</strong><span>{event.afterVersionReference ?? event.beforeVersionReference ?? "Recorded"}</span></li>)}</ol></section>
        </div>
        <section className="admin-detail-aside" aria-label="Administration actions">
          <AdminDetailActions priceCheckId={priceCheck.id} assigneeId={priceCheck.assignedAdminUserId} currentUserId={access.user.id} canAssignAny={roleCan(access.user.role, "assign_any")} canMutate={roleCan(access.user.role, "transition")} admins={admins.map(admin => ({ id: admin.id, label: `${staffDisplayName(admin.displayEmail)} · ${admin.role}` }))} nextStatuses={validStatuses} canRequestInformation={canTransitionPriceCheck(priceCheck.status, "needs_information")} revision={revisionDefaults} />
          <section className="admin-panel admin-processing"><p className="admin-eyebrow">Processing</p><h2>Job visibility</h2>{jobs.length ? <ul>{jobs.map(job => <li key={job.id}><b>{job.jobType}</b><span>{job.state}</span>{job.sanitizedErrorCode && <small>{job.sanitizedErrorCode}</small>}</li>)}</ul> : <p className="admin-muted">No processing jobs are associated with this request.</p>}</section>
        </section>
      </div>
    </section>
  </AdminChrome>;
}
