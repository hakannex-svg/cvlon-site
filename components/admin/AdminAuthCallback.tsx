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
    handleAuthCallback()
      .then(async (result) => {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        if (result?.type !== "oauth") {
          window.location.replace("/admin/login?auth=callback");
          return;
        }
        window.location.replace("/admin/price-checks");
      })
      .catch(() => window.location.replace("/admin/login?auth=failed"));
  }, []);
  return null;
}
