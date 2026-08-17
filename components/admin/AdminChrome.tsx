import type { ReactNode } from "react";
import type { PriceCheckAdmin } from "@/lib/price-check/admin/auth";
import { AdminSignOut } from "./AdminSignOut";

type AdminArea = "queue" | "staff" | "help";

export function AdminChrome({ user, active, children }: { user: PriceCheckAdmin; active: AdminArea; children: ReactNode }) {
  const links = [
    { key: "queue" as const, href: "/admin/price-checks", label: "Review Queue" },
    ...(user.role === "ADMIN" ? [{ key: "staff" as const, href: "/admin/staff", label: "Staff" }] : []),
    { key: "help" as const, href: "/admin/help", label: "Operations Guide" },
  ];
  return <main className="admin-app">
    <header className="admin-topbar">
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate plain anchor for resilient admin navigation */}
      <a href="/admin/price-checks" className="admin-wordmark">CIVILON <span>OPERATIONS</span></a>
      <nav className="admin-desktop-nav" aria-label="Administration">{links.map(link => <a key={link.key} href={link.href} aria-current={active === link.key ? "page" : undefined}>{link.label}</a>)}<a href="https://cvlon.com" target="_blank" rel="noreferrer">Open Civilon ↗</a></nav>
      <div className="admin-session"><span>{user.email}</span><b>{user.role}</b><AdminSignOut /></div>
      <details className="admin-mobile-menu">
        <summary>Admin menu</summary>
        <nav className="admin-mobile-nav" aria-label="Mobile administration">{links.map(link => <a key={link.key} href={link.href} aria-current={active === link.key ? "page" : undefined}>{link.label}</a>)}<a href="https://cvlon.com">Civilon Website</a><AdminSignOut className="admin-mobile-signout" label="Sign Out" /></nav>
      </details>
    </header>
    {children}
  </main>;
}
