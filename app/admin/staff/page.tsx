import { notFound, redirect } from "next/navigation";

import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { AdminStaffWorkspace } from "@/components/admin/AdminStaffWorkspace";
import { getPriceCheckAdminAccess } from "@/lib/price-check/admin/auth";
import { roleCan } from "@/lib/price-check/admin/policy";

export default async function AdminStaffPage() {
  const access = await getPriceCheckAdminAccess();
  if (access.status === "disabled") notFound();
  if (access.status === "unauthenticated") redirect("/admin/login");
  if (access.status === "forbidden" || (access.status === "authorized" && !roleCan(access.user.role, "manage_staff"))) redirect("/admin/access-denied");
  if (access.status === "unavailable") return <AdminAccessDenied unavailable />;

  let staff;
  try {
    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/staff-repository"),
    ]);
    staff = await repository.listStaff(priceCheckDb);
  } catch {
    return <AdminAccessDenied unavailable />;
  }
  return <AdminChrome user={access.user}><AdminStaffWorkspace {...staff} /></AdminChrome>;
}
