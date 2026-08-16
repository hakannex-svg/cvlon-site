import { notFound } from "next/navigation";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";

export default function AccessDeniedPage() {
  if (!isPriceCheckEnabled()) notFound();
  return <AdminAccessDenied />;
}
