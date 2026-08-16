"use client";

import { useEffect, useState } from "react";

export function AdminLogin() {
  const [state, setState] = useState<"idle" | "error">("idle");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("auth") === "failed") {
      queueMicrotask(() => setState("error"));
    }
  }, []);

  return (
    <main className="admin-app admin-login-page">
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <div className="admin-brand">CIVILON <span>OPERATIONS</span></div>
        <p className="admin-eyebrow">Restricted staff workspace</p>
        <h1 id="admin-login-title">Price Check Administration</h1>
        <p>Continue with an invited Google identity. Authentication does not grant access unless the verified identity is also bound to an active Civilon administration record.</p>
        {state === "error" && <div className="admin-error" role="alert">The secure sign-in could not be completed. Try Google sign-in again.</div>}
        <a className="admin-google-button" href="/api/admin/auth/google/login">
          <span aria-hidden="true">G</span> Continue with Google
        </a>
        <p className="admin-login-footnote">Exact allowlist · Google identity · Server-verified access</p>
      </section>
    </main>
  );
}
