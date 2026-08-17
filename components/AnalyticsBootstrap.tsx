"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    civilonAnalyticsLoaded?: boolean;
    civilonAnalyticsConsentGranted?: boolean;
    dataLayer?: Array<Record<string, unknown>>;
    [key: `ga-disable-${string}`]: boolean | undefined;
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

    const setGoogleConsent = (granted: boolean) => {
      window.dataLayer = window.dataLayer ?? [];
      const dataLayer = window.dataLayer;
      function gtag(...args: unknown[]) {
        dataLayer.push(args as unknown as Record<string, unknown>);
      }
      gtag("consent", window.civilonAnalyticsLoaded ? "update" : "default", {
        analytics_storage: granted ? "granted" : "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
    };

    const activate = (event: Event) => {
      const detail = (event as CustomEvent<{ granted?: boolean }>).detail;
      window.civilonAnalyticsConsentGranted = detail?.granted === true;
      window["ga-disable-G-73R0FEVSN2"] = detail?.granted !== true;
      if (!detail?.granted) {
        if (window.civilonAnalyticsLoaded) setGoogleConsent(false);
        return;
      }
      setGoogleConsent(true);
      if (window.civilonAnalyticsLoaded) return;
      window.civilonAnalyticsLoaded = true;
      window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
      loadScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`, "civilon-gtm");
    };

    window.addEventListener("civilon:analytics-consent", activate);
    return () => window.removeEventListener("civilon:analytics-consent", activate);
  }, []);

  return null;
}
