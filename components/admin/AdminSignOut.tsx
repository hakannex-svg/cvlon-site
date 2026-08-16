"use client";

import { logout } from "@netlify/identity";
import { useState } from "react";

export function AdminSignOut() {
  const [busy, setBusy] = useState(false);
  return <button className="admin-signout" type="button" disabled={busy} onClick={async () => {
    setBusy(true);
    try {
      await fetch("/api/admin/auth/session", { method: "DELETE", credentials: "same-origin" });
      await logout();
    } finally { window.location.replace("/admin/login"); }
  }}>{busy ? "Signing out…" : "Sign out"}</button>;
}
