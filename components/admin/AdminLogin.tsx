"use client";

import { handleAuthCallback, oauthLogin } from "@netlify/identity";
import { useEffect, useState } from "react";

export function AdminLogin() {
  const [state, setState] = useState<"idle" | "checking" | "error" | "invited">("idle");

  useEffect(() => {
    if (window.location.hash.includes("invite_token=")) {
      history.replaceState(null, "", window.location.pathname);
      queueMicrotask(() => setState("invited"));
      return;
    }
    if (!window.location.hash) return;
    queueMicrotask(() => setState("checking"));
    handleAuthCallback()
      .then((result) => {
        if (result?.type === "oauth") window.location.replace("/admin/price-checks");
        else setState("error");
      })
      .catch(() => setState("error"));
  }, []);

  return (
    <main className="admin-app admin-login-page">
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <div className="admin-brand">CIVILON <span>OPERATIONS</span></div>
        <p className="admin-eyebrow">Restricted staff workspace</p>
        <h1 id="admin-login-title">Price Check Administration</h1>
        <p>Continue with an invited Google identity. Authentication does not grant access unless the verified identity is also bound to an active Civilon administration record.</p>
        {state === "invited" && <div className="admin-notice">Invitation recognized. Continue with the invited Google account.</div>}
        {state === "checking" && <div className="admin-notice" role="status">Verifying your staff session…</div>}
        {state === "error" && <div className="admin-error" role="alert">The secure sign-in could not be completed. Try Google sign-in again.</div>}
        <button className="admin-google-button" type="button" onClick={() => oauthLogin("google")}>
          <span aria-hidden="true">G</span> Continue with Google
        </button>
        <p className="admin-login-footnote">Invite only · Google identity · Server-verified access</p>
      </section>
    </main>
  );
}
