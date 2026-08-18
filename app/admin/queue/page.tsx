import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { InventoryFreshnessHealth } from "@/components/admin/InventoryFreshnessHealth";
import { getAdminAccess } from "@/lib/price-check/admin/auth";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import {
  formatAge,
  formatDateTime,
  marketplaceStatusLabels,
  staffDisplayName,
  statusLabels,
  unifiedStatusLabel,
  unifiedTypeLabels,
} from "@/lib/price-check/admin/display";
import { priceCheckStatuses } from "@/db/price-check/domain/status-policy";
import {
  buyRequestStatuses,
  isAssigneeFilter,
  sellSubmissionStatuses,
  UNASSIGNED_FILTER,
  UNIFIED_QUEUE_LIMIT,
  unifiedQueueAges,
  unifiedQueueTypes,
  unifiedQueueUrgencies,
  unifiedQueueVerificationStates,
  type MarketplaceReviewCounts,
  type SellInventoryFreshnessHealthCounts,
  type UnifiedQueueAge,
  type UnifiedQueueRecord,
  type UnifiedQueueType,
  type UnifiedQueueUrgency,
  type UnifiedQueueVerificationState,
} from "@/db/price-check/repositories/marketplace-admin-repository";

export const dynamic = "force-dynamic";

/** Deduplicated union of the three workflow status vocabularies. */
const filterableStatuses = [...new Set<string>([
  ...priceCheckStatuses,
  ...buyRequestStatuses,
  ...sellSubmissionStatuses,
])];

function filterStatusLabel(status: string) {
  return statusLabels[status] ?? marketplaceStatusLabels[status] ?? status.replaceAll("_", " ");
}

/** Each workflow's own record-bound detail route. */
const detailBasePath: Record<UnifiedQueueType, string> = {
  price_check: "/admin/price-checks",
  buy_request: "/admin/buy-requests",
  sell_submission: "/admin/sell-submissions",
};

function referenceCell(record: UnifiedQueueRecord) {
  return <a href={`${detailBasePath[record.type]}/${record.id}`}>{record.publicReference}</a>;
}

export default async function UnifiedQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Staff console access is deliberately independent of every product feature
  // flag: this is the general staff guard, not the Price Check variant.
  const access = await getAdminAccess();
  if (access.status === "unauthenticated") redirect("/admin/login");
  if (access.status === "forbidden") redirect("/admin/access-denied");
  if (access.status !== "authorized") return <AdminAccessDenied unavailable />;

  const query = await searchParams;
  const one = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
  const pick = <T extends string>(key: string, allowed: readonly T[]) => {
    const value = one(key);
    return (allowed as readonly string[]).includes(value) ? value as T : undefined;
  };
  const rawAssignee = one("assignee");
  const rawStatus = one("status");
  const search = one("search").trim().slice(0, 120);

  const filters = {
    type: pick<UnifiedQueueType>("type", unifiedQueueTypes),
    status: filterableStatuses.includes(rawStatus) ? rawStatus : undefined,
    // Passed through as supplied. The repository fails closed on a malformed
    // value; dropping it here would silently widen the view to every assignee.
    assignee: rawAssignee || undefined,
    urgency: pick<UnifiedQueueUrgency>("urgency", unifiedQueueUrgencies),
    verification: pick<UnifiedQueueVerificationState>("verification", unifiedQueueVerificationStates),
    age: pick<UnifiedQueueAge>("age", unifiedQueueAges),
    search: search || undefined,
    // Price Check detail stays behind its own flag, so its rows are listed only
    // when that flag is on. Buy and Sell rows are always listed for staff.
    includePriceChecks: isPriceCheckEnabled(),
  };

  let records: UnifiedQueueRecord[];
  let admins: { id: string; displayEmail: string; role: string }[];
  let buyReviewCounts: MarketplaceReviewCounts;
  let sellReviewCounts: MarketplaceReviewCounts;
  let freshnessHealth: SellInventoryFreshnessHealthCounts;
  try {
    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/marketplace-admin-repository"),
    ]);
    const adminRepository = await import("@/db/price-check/repositories/admin-repository");
    [records, admins, buyReviewCounts, sellReviewCounts, freshnessHealth] = await Promise.all([
      repository.listUnifiedAdminQueue(priceCheckDb, filters),
      adminRepository.listActiveAdmins(priceCheckDb),
      repository.countMarketplaceReviewStates(priceCheckDb, { type: "buy_request" }),
      repository.countMarketplaceReviewStates(priceCheckDb, { type: "sell_submission" }),
      // Deliberately unfiltered, exactly as the concern counters are: the
      // freshness cadence is a property of the workflow rather than of whatever
      // the reader happens to be narrowing the table to, and a number that moved
      // with the filters would be read as a total that it is not.
      repository.countSellInventoryFreshnessHealth(priceCheckDb),
    ]);
  } catch {
    return <AdminAccessDenied unavailable />;
  }

  const concernTotal = buyReviewCounts.concern + sellReviewCounts.concern;

  return <AdminChrome user={access.user} active="queue">
    <section className="admin-page admin-queue-page">
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Civilon operations</p>
          <h1>All work</h1>
          <p>Price Check, Buy Request and Sell Submission records in one queue. Unverified submissions are shown by default; the record here is the system of record, not the notification email.</p>
          <p className="admin-muted">This queue shows up to the first {UNIFIED_QUEUE_LIMIT} records, highest priority and most recent first. It is not a total — narrow the view with the filters below to be sure you are seeing everything that matters.</p>
        </div>
        <div className="admin-queue-count"><strong>{records.length}</strong><span>records shown</span></div>
      </div>

      <aside className={`admin-concerns-alert${concernTotal > 0 ? " has-concerns" : ""}`} aria-labelledby="marketplace-concerns-heading">
        <div>
          <span>Internal review</span>
          <h2 id="marketplace-concerns-heading">Concerns <strong>{concernTotal}</strong></h2>
          <p>Business-review flags needing staff follow-up. This is not certification or an airworthiness decision.</p>
        </div>
        <nav aria-label="Open concerned marketplace records">
          <Link href="/admin/buy-requests?review=concern"><span>Buy requests</span><strong>{buyReviewCounts.concern}</strong></Link>
          <Link href="/admin/sell-submissions?review=concern"><span>Sell submissions</span><strong>{sellReviewCounts.concern}</strong></Link>
        </nav>
      </aside>

      <InventoryFreshnessHealth counts={freshnessHealth} />

      <form className="admin-filters" method="get" aria-label="Filter unified operations queue">
        <label className="admin-search"><span>Search authorized fields</span><input name="search" defaultValue={filters.search} placeholder="Reference, part, company, contact" /></label>
        <label><span>Workflow</span><select name="type" defaultValue={filters.type ?? ""}><option value="">All workflows</option>{unifiedQueueTypes.map(type => <option key={type} value={type}>{unifiedTypeLabels[type]}</option>)}</select></label>
        <label><span>Status</span><select name="status" defaultValue={filters.status ?? ""}><option value="">All statuses</option>{filterableStatuses.map(status => <option key={status} value={status}>{filterStatusLabel(status)}</option>)}</select></label>
        <label><span>Verification</span><select name="verification" defaultValue={filters.verification ?? ""}><option value="">All</option><option value="verified">Verified</option><option value="pending">Awaiting verification</option></select></label>
        <label><span>Priority</span><select name="urgency" defaultValue={filters.urgency ?? ""}><option value="">Any priority</option><option value="aog">AOG only</option><option value="critical">AOG or critical</option></select></label>
        <label><span>Assignee</span><select name="assignee" defaultValue={isAssigneeFilter(rawAssignee) ? rawAssignee : ""}><option value="">All assignees</option><option value={UNASSIGNED_FILTER}>Unassigned</option>{admins.map(admin => <option key={admin.id} value={admin.id}>{staffDisplayName(admin.displayEmail)}</option>)}</select></label>
        <label><span>Age</span><select name="age" defaultValue={filters.age ?? ""}><option value="">Any age</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="older">Older than 7 days</option></select></label>
        <div className="admin-filter-actions"><button type="submit">Apply filters</button><Link href="/admin/queue">Clear</Link></div>
      </form>

      <div className="admin-table-wrap">
        <table className="admin-queue-table">
          <caption className="sr-only">Civilon unified operations queue</caption>
          <thead><tr><th>Workflow</th><th>Reference</th><th>Received</th><th>Priority</th><th>Company</th><th>Contact</th><th>Part number</th><th>Verification</th><th>Status</th><th>Assignee</th><th>Age</th></tr></thead>
          <tbody>{records.map(record => <tr key={`${record.type}:${record.id}`} className={record.urgency === "aog" ? "is-aog" : ""}>
            <td data-label="Workflow"><span className={`admin-type-badge type-${record.type}`}>{unifiedTypeLabels[record.type]}</span></td>
            <td data-label="Reference">{referenceCell(record)}</td>
            <td data-label="Received"><time dateTime={new Date(record.submittedAt).toISOString()}>{formatDateTime(record.submittedAt)}</time></td>
            <td data-label="Priority">{record.urgency === "aog" ? <span className="admin-aog-badge">AOG</span> : record.urgency === "critical" ? "Critical" : "—"}</td>
            <td data-label="Company">{record.companyName}</td>
            <td data-label="Contact">{record.contactName}</td>
            <td data-label="Part number">{record.partNumber ? <code>{record.partNumber}</code> : "—"}</td>
            <td data-label="Verification">{record.verificationState === "verified" ? "Verified" : record.verificationState === "pending" ? "Awaiting" : "—"}</td>
            <td data-label="Status"><span className={`admin-status status-${record.status}`}>{unifiedStatusLabel(record.type, record.status)}</span></td>
            <td data-label="Assignee">{staffDisplayName(record.assigneeEmail)}</td>
            <td data-label="Age">{formatAge(record.submittedAt)}</td>
          </tr>)}</tbody>
        </table>
        {!records.length && <div className="admin-empty">No records match the selected filters.</div>}
      </div>
    </section>
  </AdminChrome>;
}
