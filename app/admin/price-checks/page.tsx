import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { AdminPhase5SeedButton } from "@/components/admin/AdminPhase5SeedButton";
import { getPriceCheckAdminAccess } from "@/lib/price-check/admin/auth";
import { formatAge, formatDateTime, formatMoney, staffDisplayName, statusLabels } from "@/lib/price-check/admin/display";
import { priceCheckStatuses, type PriceCheckStatus } from "@/db/price-check/domain/status-policy";

export default async function PriceCheckQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await getPriceCheckAdminAccess();
  if (access.status === "disabled") notFound();
  if (access.status === "unauthenticated") redirect("/admin/login");
  if (access.status === "forbidden") redirect("/admin/access-denied");
  if (access.status === "unavailable") return <AdminAccessDenied unavailable />;

  const query = await searchParams;
  const one = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
  const rawStatus = one("status");
  const filters = {
    status: priceCheckStatuses.includes(rawStatus as PriceCheckStatus) ? rawStatus as PriceCheckStatus : undefined,
    aog: ["yes", "no"].includes(one("aog")) ? one("aog") as "yes" | "no" : undefined,
    assignee: one("assignee") || undefined,
    condition: one("condition") || undefined,
    transaction: one("transaction") || undefined,
    age: ["day", "week", "older"].includes(one("age")) ? one("age") as "day" | "week" | "older" : undefined,
    search: one("search") || undefined,
  };
  let records, admins;
  try {
    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    [records, admins] = await Promise.all([
      repository.listAdminPriceChecks(priceCheckDb, filters),
      repository.listActiveAdmins(priceCheckDb),
    ]);
  } catch {
    return <AdminAccessDenied unavailable />;
  }

  return <AdminChrome user={access.user}>
    <section className="admin-page admin-queue-page">
      <div className="admin-page-heading">
        <div><p className="admin-eyebrow">Price Check operations</p><h1>Review queue</h1><p>Human-reviewed transaction requests awaiting triage, clarification, or analysis preparation.</p></div>
        <div className="admin-queue-count"><strong>{records.length}</strong><span>visible requests</span></div>
      </div>
      <form className="admin-filters" method="get" aria-label="Filter Price Check queue">
        <label className="admin-search"><span>Search authorized fields</span><input name="search" defaultValue={filters.search} placeholder="Reference, part, company, requester" /></label>
        <label><span>Status</span><select name="status" defaultValue={filters.status ?? ""}><option value="">All statuses</option>{priceCheckStatuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
        <label><span>AOG</span><select name="aog" defaultValue={filters.aog ?? ""}><option value="">All</option><option value="yes">AOG only</option><option value="no">Routine only</option></select></label>
        <label><span>Assignee</span><select name="assignee" defaultValue={filters.assignee ?? ""}><option value="">All assignees</option><option value="unassigned">Unassigned</option>{admins.map(admin => <option key={admin.id} value={admin.id}>{staffDisplayName(admin.displayEmail)}</option>)}</select></label>
        <label><span>Condition</span><select name="condition" defaultValue={filters.condition ?? ""}><option value="">All conditions</option>{["NE","NS","OH","SV","AR","NOT_SURE"].map(item => <option key={item}>{item}</option>)}</select></label>
        <label><span>Transaction</span><select name="transaction" defaultValue={filters.transaction ?? ""}><option value="">All transactions</option>{["outright","exchange","repair","not_sure"].map(item => <option key={item} value={item}>{item.replace("_", " ")}</option>)}</select></label>
        <label><span>Age</span><select name="age" defaultValue={filters.age ?? ""}><option value="">Any age</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="older">Older than 7 days</option></select></label>
        <div className="admin-filter-actions"><button type="submit">Apply filters</button><Link href="/admin/price-checks">Clear</Link></div>
      </form>
      {!records.length && access.user.role === "ADMIN" && (process.env.PRICE_CHECK_PHASE5_PREVIEW_SEED_ENABLED === "true" || process.env.PRICE_CHECK_PHASE6_PREVIEW_SEED_ENABLED === "true") && <AdminPhase5SeedButton />}
      <div className="admin-table-wrap">
        <table className="admin-queue-table">
          <caption className="sr-only">Civilon Price Check review queue</caption>
          <thead><tr><th>Reference</th><th>Submitted</th><th>AOG</th><th>Company</th><th>Requester</th><th>Part number</th><th>Condition</th><th>Transaction</th><th>Unit price</th><th>Status</th><th>Assignee</th><th>Age</th></tr></thead>
          <tbody>{records.map(record => <tr key={record.id} className={record.aog ? "is-aog" : ""}>
            <td data-label="Reference"><a href={`/admin/price-checks/${record.id}`}>{record.publicReference}</a></td>
            <td data-label="Submitted"><time dateTime={new Date(record.submittedAt).toISOString()}>{formatDateTime(record.submittedAt)}</time></td>
            <td data-label="AOG">{record.aog ? <span className="admin-aog-badge">AOG</span> : "—"}</td>
            <td data-label="Company">{record.companyName}</td>
            <td data-label="Requester">{record.requesterFirstName} {record.requesterLastName}</td>
            <td data-label="Part number"><code>{record.originalPartNumber}</code></td>
            <td data-label="Condition">{record.conditionCode}</td>
            <td data-label="Transaction">{record.transactionType.replace("_", " ")}</td>
            <td data-label="Unit price">{formatMoney(record.unitPrice, record.currencyCode)}</td>
            <td data-label="Status"><span className={`admin-status status-${record.status}`}>{statusLabels[record.status]}</span></td>
            <td data-label="Assignee">{staffDisplayName(record.assigneeEmail)}</td>
            <td data-label="Age">{formatAge(record.submittedAt)}</td>
          </tr>)}</tbody>
        </table>
        {!records.length && <div className="admin-empty">No Price Checks match the selected filters.</div>}
      </div>
    </section>
  </AdminChrome>;
}
