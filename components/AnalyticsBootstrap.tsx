"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    civilonAnalyticsLoaded?: boolean;
  }
}

function loadScript(src: string, id: string) {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.append(script);
}

/** Analytics remains inert until a consent manager explicitly grants consent. */
export function AnalyticsBootstrap() {
  useEffect(() => {
    const mode = process.env.NEXT_PUBLIC_ANALYTICS_MODE;
    const gtmId = process.env.NEXT_PUBLIC_GTM_CONTAINER_ID;
    const ga4Id = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    if (mode !== "consent-required" || (!gtmId && !ga4Id)) return;

    const activate = (event: Event) => {
      const detail = (event as CustomEvent<{ granted?: boolean }>).detail;
      if (!detail?.granted || window.civilonAnalyticsLoaded) return;
      window.civilonAnalyticsLoaded = true;
      if (gtmId) loadScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`, "civilon-gtm");
      else if (ga4Id) loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`, "civilon-ga4");
    };

    window.addEventListener("civilon:analytics-consent", activate);
    return () => window.removeEventListener("civilon:analytics-consent", activate);
  }, []);

  return null;
}
