"use client";

import { useEffect } from "react";

export function CleanResultUrl() {
  useEffect(() => {
    if (window.location.pathname === "/price-check/result" && window.location.search) {
      window.history.replaceState(null, "", "/price-check/result");
    }
  }, []);

  return null;
}
