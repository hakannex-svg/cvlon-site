"use client";

import { useEffect } from "react";
import { trackCivilonEvent } from "@/lib/analytics";

export function ResultViewAnalytics() {
  useEffect(() => { trackCivilonEvent("price_check_result_view", { source_page: "/price-check/result" }); }, []);
  return null;
}
