"use client";

import { handleAuthCallback } from "@netlify/identity";
import { useEffect } from "react";

export function AdminAuthCallback() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash.slice(1));
    const inviteToken = params.get("invite_token");
    if (inviteToken) {
      window.location.replace(`/.netlify/identity/authorize?provider=google&invite_token=${encodeURIComponent(inviteToken)}`);
      return;
    }
    if (!params.get("access_token")) return;
    const providerToken = params.get("provider_token");
    const provider = params.get("provider");
    handleAuthCallback()
      .then(async (result) => {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        if (result?.type !== "oauth") {
          window.location.replace("/admin/login?auth=callback");
          return;
        }
        if (provider !== "google" || !providerToken) {
          window.location.replace("/admin/login?auth=provider");
          return;
        }
        const response = await fetch("/api/admin/auth/google-session", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerToken }),
        });
        if (response.status === 403) {
          window.location.replace("/admin/access-denied");
          return;
        }
        if (!response.ok) {
          window.location.replace(`/admin/login?auth=session-${response.status}`);
          return;
        }
        window.location.replace("/admin/price-checks");
      })
      .catch(() => window.location.replace("/admin/login?auth=failed"));
  }, []);
  return null;
}
