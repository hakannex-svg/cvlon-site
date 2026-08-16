import type { Metadata } from "next";
import { AdminAuthUrlCleaner } from "@/components/admin/AdminAuthUrlCleaner";

export const metadata: Metadata = {
  title: "Civilon Operations",
  description: "Restricted Civilon staff administration.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <><AdminAuthUrlCleaner />{children}</>;
}
