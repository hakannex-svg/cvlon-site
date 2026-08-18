import { notFound } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { SellSubmissionDetail } from "@/components/admin/SellSubmissionDetail";
import { roleCan } from "@/lib/price-check/admin/policy";
import { buildMarketplaceActionContext, requireMarketplacePageAccess } from "@/lib/price-check/admin/marketplace-access";
import type { SellSubmissionAdminDetail } from "@/db/price-check/repositories/marketplace-admin-repository";

export const dynamic = "force-dynamic";

const RECORD_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export default async function SellSubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireMarketplacePageAccess();
  if (!user) return <AdminAccessDenied unavailable />;

  const { id } = await params;
  if (!RECORD_ID_PATTERN.test(id)) notFound();

  // A missing record is a 404; a database fault is the generic unavailable
  // card. Neither says anything about why, and neither reveals another record.
  let detail: SellSubmissionAdminDetail | null;
  let staff: { id: string; displayEmail: string }[];
  try {
    const [{ priceCheckDb }, repository, adminRepository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/marketplace-admin-repository"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    [detail, staff] = await Promise.all([
      repository.getSellSubmissionAdminDetail(priceCheckDb, id),
      adminRepository.listActiveAdmins(priceCheckDb),
    ]);
  } catch {
    return <AdminAccessDenied unavailable />;
  }
  if (!detail) notFound();

  // The authorized transitions are computed here, from the policy graph and the
  // signed-in role. The route re-checks the same policy before it writes.
  const actions = buildMarketplaceActionContext({
    aggregate: "sell_submission",
    currentStatus: detail.sellSubmission.status,
    role: user.role,
    staff,
  });

  return <AdminChrome user={user} active="sell-submissions">
    <SellSubmissionDetail
      detail={detail}
      actions={actions}
      canDownloadEvidence={roleCan(user.role, "download_marketplace_evidence")}
    />
  </AdminChrome>;
}
