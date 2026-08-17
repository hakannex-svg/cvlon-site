"use client";

import { useState } from "react";

export function AdminSignOut({
  className = "admin-signout",
  label = "Sign out",
}: {
  className?: string;
  label?: string;
} = {}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return <>
    <button className={className} type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      setFailed(false);
      try {
        const response = await fetch("/api/admin/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) throw new Error("Sign out failed.");
        window.location.replace("/admin/login");
      } catch {
        setFailed(true);
        setBusy(false);
      }
    }}>{busy ? "Signing out…" : label}</button>
    {failed && <span className="admin-error" role="alert">Sign out could not be completed. Please try again.</span>}
  </>;
}
