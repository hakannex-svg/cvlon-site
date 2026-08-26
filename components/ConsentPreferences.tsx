"use client";

import { useEffect, useState } from "react";
import { isPrivateAnalyticsRoute } from "@/lib/analytics-private-routes";

const STORAGE_KEY = "civilon_analytics_consent_v1";
type Preference = "granted" | "denied";

function publishConsent(preference: Preference) {
  window.dispatchEvent(new CustomEvent("civilon:analytics-consent", { detail: { granted: preference === "granted" } }));
}

export function ConsentPreferences() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Nothing runs on a private route — not the dialog, and not the republish
    // of a stored preference, which is what would otherwise re-arm the loader
    // on a page reached only from a link Civilon sent to one recipient.
    if (isPrivateAnalyticsRoute(window.location.pathname)) return;
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
      <p>Civilon uses limited cookieless measurement by default. Optional analytics storage remains off unless you choose to allow it. See our <a href="/privacy-policy">Privacy Policy</a> for details.</p>
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
