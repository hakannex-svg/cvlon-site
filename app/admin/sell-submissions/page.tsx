import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { MarketplaceListView } from "@/components/admin/MarketplaceListView";
import { requireMarketplacePageAccess } from "@/lib/price-check/admin/marketplace-access";
import { internalReviewStates, type InternalReviewState } from "@/db/price-check/domain/internal-review";
import {
  sellSubmissionStatuses,
  unifiedQueueAges,
  unifiedQueueVerificationStates,
  type UnifiedQueueAge,
  type MarketplaceReviewCounts,
  type UnifiedQueueRecord,
  type UnifiedQueueVerificationState,
} from "@/db/price-check/repositories/marketplace-admin-repository";

export const dynamic = "force-dynamic";

export default async function SellSubmissionListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
    type: "sell_submission" as const,
    status: (sellSubmissionStatuses as readonly string[]).includes(rawStatus) ? rawStatus : undefined,
    // Passed through as supplied; the repository fails closed on a malformed value.
    assignee: rawAssignee || undefined,
    verification: pick<UnifiedQueueVerificationState>("verification", unifiedQueueVerificationStates),
    review: pick<InternalReviewState>("review", internalReviewStates),
    age: pick<UnifiedQueueAge>("age", unifiedQueueAges),
    search: search || undefined,
  };

  let records: UnifiedQueueRecord[];
  let admins: { id: string; displayEmail: string }[];
  let reviewCounts: MarketplaceReviewCounts;
  try {
    const [{ priceCheckDb }, repository, adminRepository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/marketplace-admin-repository"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    [records, admins, reviewCounts] = await Promise.all([
      repository.listUnifiedAdminQueue(priceCheckDb, filters),
      adminRepository.listActiveAdmins(priceCheckDb),
      repository.countMarketplaceReviewStates(priceCheckDb, filters),
    ]);
  } catch {
    return <AdminAccessDenied unavailable />;
  }

  return <AdminChrome user={user} active="sell-submissions">
    <MarketplaceListView
      type="sell_submission"
      basePath="/admin/sell-submissions"
      title="Sell Submissions"
      lede="Offers to sell parts to Civilon. Unverified submissions are shown by default; the record here is the system of record, not the notification email."
      statuses={sellSubmissionStatuses}
      records={records}
      reviewCounts={reviewCounts}
      admins={admins}
      filters={filters}
      rawAssignee={rawAssignee}
    />
  </AdminChrome>;
}
