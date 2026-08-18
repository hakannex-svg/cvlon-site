import type { ReactNode } from "react";
import type { PriceCheckAdmin } from "@/lib/price-check/admin/auth";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { AdminSignOut } from "./AdminSignOut";

type AdminArea = "queue" | "price-checks" | "buy-requests" | "sell-submissions" | "staff" | "help";

export function AdminChrome({ user, active, children }: { user: PriceCheckAdmin; active: AdminArea; children: ReactNode }) {
  const links = [
    { key: "queue" as const, href: "/admin/queue", label: "All Work" },
    // The Price Check queue 404s behind its own feature flag, so the link is
    // offered only when that surface is actually reachable.
    ...(isPriceCheckEnabled() ? [{ key: "price-checks" as const, href: "/admin/price-checks", label: "Review Queue" }] : []),
    { key: "buy-requests" as const, href: "/admin/buy-requests", label: "Buy Requests" },
    { key: "sell-submissions" as const, href: "/admin/sell-submissions", label: "Sell Submissions" },
    ...(user.role === "ADMIN" ? [{ key: "staff" as const, href: "/admin/staff", label: "Staff" }] : []),
    { key: "help" as const, href: "/admin/help", label: "Operations Guide" },
  ];
  return <main className="admin-app">
    <header className="admin-topbar">
      {/* Deliberate plain anchor: admin navigation stays resilient to client-router failures. */}
      <a href="/admin/queue" className="admin-wordmark">CIVILON <span>OPERATIONS</span></a>
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
