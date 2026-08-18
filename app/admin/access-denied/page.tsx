import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";

/** Reachable for any staff member turned away, whatever the public flags say. */
export default function AccessDeniedPage() {
  return <AdminAccessDenied />;
}
