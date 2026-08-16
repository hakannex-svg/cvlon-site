"use client";

import { logout } from "@netlify/identity";
import { useState } from "react";

export function AdminSignOut({
  className = "admin-signout",
  label = "Sign out",
}: {
  className?: string;
  label?: string;
} = {}) {
  const [busy, setBusy] = useState(false);
  return <button className={className} type="button" disabled={busy} onClick={async () => {
    setBusy(true);
    try { await logout(); } finally { window.location.replace("/admin/login"); }
  }}>{busy ? "Signing out…" : label}</button>;
}
