import Link from "next/link";
import {
  formatAge,
  formatDateTime,
  marketplaceStatusLabels,
  staffDisplayName,
  unifiedStatusLabel,
} from "@/lib/price-check/admin/display";
import {
  UNASSIGNED_FILTER,
  isAssigneeFilter,
  type UnifiedQueueRecord,
  type UnifiedQueueType,
} from "@/db/price-check/repositories/marketplace-admin-repository";

/**
 * A single-workflow view over the same unified queue read the `/admin/queue`
 * landing uses. It is a filtered projection, not a second query surface, so the
 * two views can never disagree about what a staff member is allowed to see.
 */
export function MarketplaceListView({
  type, basePath, title, lede, statuses, records, admins, filters, rawAssignee,
}: {
  type: UnifiedQueueType;
  basePath: string;
  title: string;
  lede: string;
  statuses: readonly string[];
  records: UnifiedQueueRecord[];
  admins: { id: string; displayEmail: string }[];
  filters: { status?: string; verification?: string; age?: string; search?: string };
  rawAssignee: string;
}) {
  return <section className="admin-page admin-queue-page">
    <div className="admin-page-heading">
      <div>
        <p className="admin-eyebrow">Civilon operations</p>
        <h1>{title}</h1>
        <p>{lede}</p>
      </div>
      <div className="admin-queue-count"><strong>{records.length}</strong><span>visible records</span></div>
    </div>

    <form className="admin-filters" method="get" aria-label={`Filter ${title}`}>
      <label className="admin-search"><span>Search authorized fields</span><input name="search" defaultValue={filters.search} placeholder="Reference, part, company, contact" /></label>
      <label><span>Status</span><select name="status" defaultValue={filters.status ?? ""}><option value="">All statuses</option>{statuses.map(status => <option key={status} value={status}>{marketplaceStatusLabels[status] ?? status.replaceAll("_", " ")}</option>)}</select></label>
      <label><span>Verification</span><select name="verification" defaultValue={filters.verification ?? ""}><option value="">All</option><option value="verified">Verified</option><option value="pending">Awaiting verification</option></select></label>
      <label><span>Assignee</span><select name="assignee" defaultValue={isAssigneeFilter(rawAssignee) ? rawAssignee : ""}><option value="">All assignees</option><option value={UNASSIGNED_FILTER}>Unassigned</option>{admins.map(admin => <option key={admin.id} value={admin.id}>{staffDisplayName(admin.displayEmail)}</option>)}</select></label>
      <label><span>Age</span><select name="age" defaultValue={filters.age ?? ""}><option value="">Any age</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="older">Older than 7 days</option></select></label>
      <div className="admin-filter-actions"><button type="submit">Apply filters</button><Link href={basePath}>Clear</Link></div>
    </form>

    <div className="admin-table-wrap">
      <table className="admin-queue-table">
        <caption className="sr-only">{title}</caption>
        <thead><tr><th>Reference</th><th>Received</th><th>Priority</th><th>Company</th><th>Contact</th><th>Part number</th><th>Verification</th><th>Status</th><th>Assignee</th><th>Age</th></tr></thead>
        <tbody>{records.map(record => <tr key={record.id} className={record.urgency === "aog" ? "is-aog" : ""}>
          <td data-label="Reference"><a href={`${basePath}/${record.id}`}>{record.publicReference}</a></td>
          <td data-label="Received"><time dateTime={new Date(record.submittedAt).toISOString()}>{formatDateTime(record.submittedAt)}</time></td>
          <td data-label="Priority">{record.urgency === "aog" ? <span className="admin-aog-badge">AOG</span> : record.urgency === "critical" ? "Critical" : "—"}</td>
          <td data-label="Company">{record.companyName}</td>
          <td data-label="Contact">{record.contactName}</td>
          <td data-label="Part number">{record.partNumber ? <code>{record.partNumber}</code> : "—"}</td>
          <td data-label="Verification">{record.verificationState === "verified" ? "Verified" : "Awaiting"}</td>
          <td data-label="Status"><span className={`admin-status status-${record.status}`}>{unifiedStatusLabel(type, record.status)}</span></td>
          <td data-label="Assignee">{staffDisplayName(record.assigneeEmail)}</td>
          <td data-label="Age">{formatAge(record.submittedAt)}</td>
        </tr>)}</tbody>
      </table>
      {!records.length && <div className="admin-empty">No records match the selected filters.</div>}
    </div>
  </section>;
}
