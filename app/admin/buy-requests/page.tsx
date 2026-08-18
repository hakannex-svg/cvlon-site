import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { MarketplaceListView } from "@/components/admin/MarketplaceListView";
import { requireMarketplacePageAccess } from "@/lib/price-check/admin/marketplace-access";
import {
  buyRequestStatuses,
  unifiedQueueAges,
  unifiedQueueVerificationStates,
  type UnifiedQueueAge,
  type UnifiedQueueRecord,
  type UnifiedQueueVerificationState,
} from "@/db/price-check/repositories/marketplace-admin-repository";

export const dynamic = "force-dynamic";

export default async function BuyRequestListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireMarketplacePageAccess();
  if (!user) return <AdminAccessDenied unavailable />;

  const query = await searchParams;
  const one = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
  const pick = <T extends string>(key: string, allowed: readonly T[]) => {
    const raw = one(key);
    return (allowed as readonly string[]).includes(raw) ? raw as T : undefined;
  };
  const rawAssignee = one("assignee");
  const rawStatus = one("status");
  const search = one("search").trim().slice(0, 120);

  const filters = {
    type: "buy_request" as const,
    status: (buyRequestStatuses as readonly string[]).includes(rawStatus) ? rawStatus : undefined,
    // Passed through as supplied; the repository fails closed on a malformed value.
    assignee: rawAssignee || undefined,
    verification: pick<UnifiedQueueVerificationState>("verification", unifiedQueueVerificationStates),
    age: pick<UnifiedQueueAge>("age", unifiedQueueAges),
    search: search || undefined,
  };

  let records: UnifiedQueueRecord[];
  let admins: { id: string; displayEmail: string }[];
  try {
    const [{ priceCheckDb }, repository, adminRepository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/marketplace-admin-repository"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    [records, admins] = await Promise.all([
      repository.listUnifiedAdminQueue(priceCheckDb, filters),
      adminRepository.listActiveAdmins(priceCheckDb),
    ]);
  } catch {
    return <AdminAccessDenied unavailable />;
  }

  return <AdminChrome user={user} active="buy-requests">
    <MarketplaceListView
      type="buy_request"
      basePath="/admin/buy-requests"
      title="Buy Requests"
      lede="Requests to buy a part from Civilon. Unverified submissions are shown by default; the record here is the system of record, not the notification email."
      statuses={buyRequestStatuses}
      records={records}
      admins={admins}
      filters={filters}
      rawAssignee={rawAssignee}
    />
  </AdminChrome>;
}
