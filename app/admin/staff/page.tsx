import { redirect } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { StaffManagement } from "@/components/admin/StaffManagement";
import { getAdminAccess } from "@/lib/price-check/admin/auth";

export const dynamic = "force-dynamic";

/**
 * The staff allowlist is shared by every Civilon workflow, so a marketplace
 * administrator must be able to manage it while Price Check intake is off.
 * ADMIN-only enforcement below is unchanged.
 */
export default async function StaffPage() {
  const access = await getAdminAccess();
  if (access.status === "unauthenticated") redirect("/admin/login");
  if (access.status === "forbidden") redirect("/admin/access-denied");
  if (access.status !== "authorized") return <AdminAccessDenied unavailable />;
  if (access.user.role !== "ADMIN") redirect("/admin/access-denied");
  let staff;
  try {
    const [{ priceCheckDb }, repository] = await Promise.all([import("@/db/price-check"), import("@/db/price-check/repositories/admin-repository")]);
    staff = await repository.listStaff(priceCheckDb);
  } catch {
    return <AdminAccessDenied unavailable />;
  }
  return <AdminChrome user={access.user} active="staff"><StaffManagement initialStaff={staff} /></AdminChrome>;
}
