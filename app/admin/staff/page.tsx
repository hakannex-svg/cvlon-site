import { notFound, redirect } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { StaffManagement } from "@/components/admin/StaffManagement";
import { getPriceCheckAdminAccess } from "@/lib/price-check/admin/auth";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const access = await getPriceCheckAdminAccess();
  if (access.status === "disabled") notFound();
  if (access.status === "unauthenticated") redirect("/admin/login");
  if (access.status === "forbidden") redirect("/admin/access-denied");
  if (access.status === "unavailable") return <AdminAccessDenied unavailable />;
  if (access.user.role !== "ADMIN") redirect("/admin/access-denied");
  let staff;
  try {
    const [{ priceCheckDb }, repository] = await Promise.all([import("@/db/price-check"), import("@/db/price-check/repositories/admin-repository")]);
    staff = await repository.listStaff(priceCheckDb);
  } catch {
    return <AdminAccessDenied unavailable />;
  }
  return <AdminChrome user={access.user}><StaffManagement initialStaff={staff} /></AdminChrome>;
}
