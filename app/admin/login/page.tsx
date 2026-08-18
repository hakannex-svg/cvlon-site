import { redirect } from "next/navigation";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { getAdminAccess } from "@/lib/price-check/admin/auth";

/**
 * General Civilon staff sign-in. Deliberately independent of every public
 * product flag: Civilon may close all public intake while staff still need the
 * database records, so the console must remain reachable for a fresh session.
 */
export default async function AdminLoginPage() {
  const access = await getAdminAccess();
  if (access.status === "authorized") redirect("/admin/queue");
  return <AdminLogin />;
}
