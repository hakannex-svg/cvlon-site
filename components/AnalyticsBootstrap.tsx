"use client";

import { useEffect } from "react";
import { isPrivateAnalyticsRoute } from "@/lib/analytics-private-routes";

declare global {
  interface Window {
    civilonAnalyticsLoaded?: boolean;
    civilonAnalyticsConsentGranted?: boolean;
    civilonPendingAnalyticsEvents?: Array<Record<string, unknown>>;
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

/**
 * Load GTM with Google's advanced consent mode on public routes only.
 *
 * Consent is denied before the container loads. That lets configured Google
 * tags send cookieless measurement pings while preventing analytics or
 * advertising storage until the visitor explicitly allows analytics.
 */
export function AnalyticsBootstrap() {
  useEffect(() => {
    const mode = process.env.NEXT_PUBLIC_ANALYTICS_MODE;
    const gtmId = process.env.NEXT_PUBLIC_GTM_CONTAINER_ID;
    // Private routes are named once, in the shared list, so this loader and the
    // consent UI can never disagree about which pages are private.
    if (mode !== "consent-required" || !gtmId || isPrivateAnalyticsRoute(window.location.pathname)) return;

    window.dataLayer = window.dataLayer ?? [];
    const dataLayer = window.dataLayer;
    function gtag(...args: unknown[]) {
      dataLayer.push(args as unknown as Record<string, unknown>);
    }

    // This command must precede the GTM bootstrap event. Advertising storage,
    // advertising user data and personalization remain denied even when the
    // visitor later allows optional analytics storage.
    gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      wait_for_update: 500,
    });
    window.civilonAnalyticsConsentGranted = false;

    window.civilonAnalyticsLoaded = true;
    dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    dataLayer.push(...(window.civilonPendingAnalyticsEvents ?? []));
    window.civilonPendingAnalyticsEvents = [];
    loadScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`, "civilon-gtm");

    const activate = (event: Event) => {
      const detail = (event as CustomEvent<{ granted?: boolean }>).detail;
      const granted = detail?.granted === true;
      window.civilonAnalyticsConsentGranted = granted;
      gtag("consent", "update", {
        analytics_storage: granted ? "granted" : "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
    };

    window.addEventListener("civilon:analytics-consent", activate);
    return () => window.removeEventListener("civilon:analytics-consent", activate);
  }, []);

  return null;
}
