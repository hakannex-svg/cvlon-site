import { notFound } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { BuyRequestDetail } from "@/components/admin/BuyRequestDetail";
import { roleCan } from "@/lib/price-check/admin/policy";
import { buildMarketplaceActionContext, requireMarketplacePageAccess } from "@/lib/price-check/admin/marketplace-access";
import type { BuyRequestAdminDetail } from "@/db/price-check/repositories/marketplace-admin-repository";

export const dynamic = "force-dynamic";

const RECORD_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export default async function BuyRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireMarketplacePageAccess();
  if (!user) return <AdminAccessDenied unavailable />;

  const { id } = await params;
  if (!RECORD_ID_PATTERN.test(id)) notFound();

  // A missing record is a 404; a database fault is the generic unavailable
  // card. Neither says anything about why, and neither reveals another record.
  let detail: BuyRequestAdminDetail | null;
  let staff: { id: string; displayEmail: string }[];
  let supplierContacts: { id: string; companyName: string; firstName: string; lastName: string; country: string | null }[];
  let supplierOptions: { id: string; label: string; status: string }[];
  try {
    const [{ priceCheckDb }, repository, adminRepository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/marketplace-admin-repository"),
      import("@/db/price-check/repositories/admin-repository"),
    ]);
    const [supplierRepository, offerRepository] = await Promise.all([
      import("@/db/price-check/repositories/supplier-response-repository"),
      import("@/db/price-check/repositories/buyer-offer-repository"),
    ]);
    [detail, staff, supplierContacts, supplierOptions] = await Promise.all([
      repository.getBuyRequestAdminDetail(priceCheckDb, id),
      adminRepository.listActiveAdmins(priceCheckDb),
      supplierRepository.listSellerCapableContacts(priceCheckDb),
      offerRepository.listSelectableSupplierResponses(priceCheckDb, id),
    ]);
  } catch {
    return <AdminAccessDenied unavailable />;
  }
  if (!detail) notFound();

  // The authorized transitions are computed here, from the policy graph and the
  // signed-in role. The route re-checks the same policy before it writes.
  const actions = buildMarketplaceActionContext({
    aggregate: "buy_request",
    currentStatus: detail.buyRequest.status,
    role: user.role,
    staff,
  });

  return <AdminChrome user={user} active="buy-requests">
    <BuyRequestDetail
      detail={detail}
      actions={actions}
      supplierContacts={supplierContacts}
      canRecordSupplierResponse={roleCan(user.role, "record_supplier_response")}
      supplierOptions={supplierOptions}
      canManageBuyerOffer={roleCan(user.role, "manage_buyer_offer")}
    />
  </AdminChrome>;
}
