import { notFound, redirect } from "next/navigation";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { getPriceCheckAdminAccess } from "@/lib/price-check/admin/auth";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";

export default async function AdminLoginPage() {
  if (!isPriceCheckEnabled()) notFound();
  const access = await getPriceCheckAdminAccess();
  if (access.status === "authorized") redirect("/admin/price-checks");
  return <AdminLogin />;
}
