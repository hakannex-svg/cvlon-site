"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    civilonAnalyticsLoaded?: boolean;
    civilonAnalyticsConsentGranted?: boolean;
    dataLayer?: Array<Record<string, unknown>>;
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
    const path = window.location.pathname;
    const isPrivateRoute = path === "/price-check/result" || path.startsWith("/price-check/result/") || path === "/admin" || path.startsWith("/admin/");
    if (mode !== "consent-required" || !gtmId || isPrivateRoute) return;

    const activate = (event: Event) => {
      const detail = (event as CustomEvent<{ granted?: boolean }>).detail;
      window.civilonAnalyticsConsentGranted = detail?.granted === true;
      if (!detail?.granted || window.civilonAnalyticsLoaded) return;
      window.civilonAnalyticsLoaded = true;
      window.dataLayer = window.dataLayer ?? [];
      window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
      loadScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`, "civilon-gtm");
    };

    window.addEventListener("civilon:analytics-consent", activate);
    return () => window.removeEventListener("civilon:analytics-consent", activate);
  }, []);

  return null;
}
