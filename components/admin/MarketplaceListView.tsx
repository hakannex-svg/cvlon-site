import Link from "next/link";
import {
  formatAge,
  formatDateTime,
  marketplaceStatusLabels,
  sellInventoryFreshnessFilterLabels,
  staffDisplayName,
  unifiedStatusLabel,
} from "@/lib/price-check/admin/display";
import {
  UNASSIGNED_FILTER,
  isAssigneeFilter,
  type MarketplaceReviewCounts,
  type UnifiedQueueRecord,
  type UnifiedQueueType,
} from "@/db/price-check/repositories/marketplace-admin-repository";
import {
  isSellInventoryFreshnessFilter,
  sellInventoryFreshnessFilters,
} from "@/db/price-check/domain/sell-inventory-freshness";
import type { InternalReviewState } from "@/db/price-check/domain/internal-review";
import { InternalReviewChip } from "@/components/admin/MarketplaceShared";

/**
 * A single-workflow view over the same unified queue read the `/admin/queue`
 * landing uses. It is a filtered projection, not a second query surface, so the
 * two views can never disagree about what a staff member is allowed to see.
 */
export function MarketplaceListView({
  type, basePath, title, lede, statuses, records, reviewCounts, admins, filters, rawAssignee, freshness,
}: {
  type: UnifiedQueueType;
  basePath: string;
  title: string;
  lede: string;
  statuses: readonly string[];
  records: UnifiedQueueRecord[];
  reviewCounts: MarketplaceReviewCounts;
  admins: { id: string; displayEmail: string }[];
  filters: { status?: string; verification?: string; review?: InternalReviewState; age?: string; search?: string };
  rawAssignee: string;
  /**
   * The bulk-inventory freshness filter, as the URL supplied it. Present only on
   * Sell Submissions: Buy Requests and Price Check have no bulk-inventory
   * freshness cadence, and offering the control there would name a state those
   * records cannot be in. Omitting it renders no control and preserves no
   * parameter.
   */
  freshness?: { value: string };
}) {
  const reviewHref = (review?: InternalReviewState) => {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.status) params.set("status", filters.status);
    if (filters.verification) params.set("verification", filters.verification);
    if (isAssigneeFilter(rawAssignee)) params.set("assignee", rawAssignee);
    // Only an allowlisted value survives a chip: carrying a malformed one
    // forward would keep a staff member on a list the repository fails closed on
    // without ever showing them why.
    if (freshness && isSellInventoryFreshnessFilter(freshness.value)) params.set("freshness", freshness.value);
    if (filters.age) params.set("age", filters.age);
    if (review) params.set("review", review);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  const reviewOptions: { state?: InternalReviewState; label: string; count: number }[] = [
    { label: "All", count: reviewCounts.all },
    { state: "not_reviewed", label: "Not reviewed", count: reviewCounts.not_reviewed },
    { state: "reviewed", label: "Reviewed", count: reviewCounts.reviewed },
    { state: "concern", label: "Concern", count: reviewCounts.concern },
  ];

  return <section className="admin-page admin-queue-page">
    <div className="admin-page-heading">
      <div>
        <p className="admin-eyebrow">Civilon operations</p>
        <h1>{title}</h1>
        <p>{lede}</p>
      </div>
      <div className="admin-queue-count"><strong>{records.length}</strong><span>visible records</span></div>
    </div>

    <nav className="admin-review-filters" aria-label={`${title} internal review state`}>
      {reviewOptions.map(option => <Link
        key={option.state ?? "all"}
        href={reviewHref(option.state)}
        className={`admin-review-filter ${option.state ? `state-${option.state}` : "state-all"}`}
        aria-current={filters.review === option.state ? "page" : undefined}
      >
        <span>{option.label}</span>
        <strong>{option.count}</strong>
      </Link>)}
    </nav>

    <form className="admin-filters" method="get" aria-label={`Filter ${title}`}>
      {filters.review && <input type="hidden" name="review" value={filters.review} />}
      <label className="admin-search"><span>Search authorized fields</span><input name="search" defaultValue={filters.search} placeholder="Reference, part, company, contact" /></label>
      <label><span>Status</span><select name="status" defaultValue={filters.status ?? ""}><option value="">All statuses</option>{statuses.map(status => <option key={status} value={status}>{marketplaceStatusLabels[status] ?? status.replaceAll("_", " ")}</option>)}</select></label>
      <label><span>Verification</span><select name="verification" defaultValue={filters.verification ?? ""}><option value="">All</option><option value="verified">Verified</option><option value="pending">Awaiting verification</option></select></label>
      <label><span>Assignee</span><select name="assignee" defaultValue={isAssigneeFilter(rawAssignee) ? rawAssignee : ""}><option value="">All assignees</option><option value={UNASSIGNED_FILTER}>Unassigned</option>{admins.map(admin => <option key={admin.id} value={admin.id}>{staffDisplayName(admin.displayEmail)}</option>)}</select></label>
      {freshness && <label><span>Freshness</span><select name="freshness" defaultValue={isSellInventoryFreshnessFilter(freshness.value) ? freshness.value : ""}><option value="">Any freshness</option>{sellInventoryFreshnessFilters.map(value => <option key={value} value={value}>{sellInventoryFreshnessFilterLabels[value]}</option>)}</select></label>}
      <label><span>Age</span><select name="age" defaultValue={filters.age ?? ""}><option value="">Any age</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="older">Older than 7 days</option></select></label>
      <div className="admin-filter-actions"><button type="submit">Apply filters</button><Link href={basePath}>Clear</Link></div>
    </form>

    <div className="admin-table-wrap">
      <table className="admin-queue-table">
        <caption className="sr-only">{title}</caption>
        <thead><tr><th>Reference</th><th>Received</th><th>Priority</th><th>Company</th><th>Contact</th><th>Part number</th><th>Verification</th><th>Review</th><th>Status</th><th>Assignee</th><th>Age</th></tr></thead>
        <tbody>{records.map(record => <tr key={record.id} className={record.urgency === "aog" ? "is-aog" : ""}>
          <td data-label="Reference"><a href={`${basePath}/${record.id}`}>{record.publicReference}</a></td>
          <td data-label="Received"><time dateTime={new Date(record.submittedAt).toISOString()}>{formatDateTime(record.submittedAt)}</time></td>
          <td data-label="Priority">{record.urgency === "aog" ? <span className="admin-aog-badge">AOG</span> : record.urgency === "critical" ? "Critical" : "—"}</td>
          <td data-label="Company">{record.companyName}</td>
          <td data-label="Contact">{record.contactName}</td>
          <td data-label="Part number">{record.partNumber ? <code>{record.partNumber}</code> : "—"}</td>
          <td data-label="Verification">{record.verificationState === "verified" ? "Verified" : "Awaiting"}</td>
          <td data-label="Review">{record.businessReviewState ? <InternalReviewChip state={record.businessReviewState} /> : "—"}</td>
          <td data-label="Status"><span className={`admin-status status-${record.status}`}>{unifiedStatusLabel(type, record.status)}</span></td>
          <td data-label="Assignee">{staffDisplayName(record.assigneeEmail)}</td>
          <td data-label="Age">{formatAge(record.submittedAt)}</td>
        </tr>)}</tbody>
      </table>
      {!records.length && <div className="admin-empty">No records match the selected filters.</div>}
    </div>
  </section>;
}
