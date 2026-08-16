import Link from "next/link";
import type { ReactNode } from "react";
import type { PriceCheckAdmin } from "@/lib/price-check/admin/auth";
import { AdminSignOut } from "./AdminSignOut";

export function AdminChrome({ user, children }: { user: PriceCheckAdmin; children: ReactNode }) {
  return <main className="admin-app">
    <header className="admin-topbar">
      <Link href="/admin/price-checks" className="admin-wordmark">CIVILON <span>OPERATIONS</span></Link>
      <nav aria-label="Administration"><Link href="/admin/price-checks">Price Checks</Link></nav>
      <div className="admin-session"><span>{user.email}</span><b>{user.role}</b><AdminSignOut /></div>
    </header>
    {children}
  </main>;
}
