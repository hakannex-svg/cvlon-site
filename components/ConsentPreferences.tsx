"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "civilon_analytics_consent_v1";
type Preference = "granted" | "denied";

function isPrivateRoute(path: string) {
  return path === "/admin" || path.startsWith("/admin/")
    || path === "/price-check/result" || path.startsWith("/price-check/result/")
    || path === "/buy-sell-aircraft-parts/verify" || path.startsWith("/buy-sell-aircraft-parts/verify/")
    || path === "/buy-sell-aircraft-parts/sell/verify"
    || path.startsWith("/buy-sell-aircraft-parts/sell/verify/");
}

function publishConsent(preference: Preference) {
  window.dispatchEvent(new CustomEvent("civilon:analytics-consent", { detail: { granted: preference === "granted" } }));
}

export function ConsentPreferences() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isPrivateRoute(window.location.pathname)) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "granted" || stored === "denied") publishConsent(stored);
    else queueMicrotask(() => setOpen(true));
    const reopen = () => setOpen(true);
    window.addEventListener("civilon:privacy-choices", reopen);
    return () => window.removeEventListener("civilon:privacy-choices", reopen);
  }, []);

  if (!open) return null;
  const choose = (preference: Preference) => {
    window.localStorage.setItem(STORAGE_KEY, preference);
    publishConsent(preference);
    setOpen(false);
  };

  return <section className="consent-banner" role="dialog" aria-modal="false" aria-labelledby="privacy-choices-title">
    <div>
      <h2 id="privacy-choices-title">Privacy choices</h2>
      <p>Civilon uses optional analytics to understand website usage and improve our services. Analytics are disabled unless you choose to allow them. See our <a href="/privacy-policy">Privacy Policy</a> for details.</p>
    </div>
    <div className="consent-actions">
      <button type="button" onClick={() => choose("granted")}>Allow analytics</button>
      <button type="button" onClick={() => choose("denied")}>Reject</button>
    </div>
  </section>;
}

export function PrivacyChoicesButton() {
  return <button className="footer-privacy-button" type="button" onClick={() => window.dispatchEvent(new Event("civilon:privacy-choices"))}>Privacy choices</button>;
}
