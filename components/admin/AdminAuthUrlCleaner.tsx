"use client";

import { useEffect } from "react";

export function AdminAuthUrlCleaner() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("code") && params.has("state")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  return null;
}
