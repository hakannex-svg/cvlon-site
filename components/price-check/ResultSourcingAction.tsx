"use client";

import { useState } from "react";
import { trackCivilonEvent } from "@/lib/analytics";

export function ResultSourcingAction({ alreadyRequested = false }: { alreadyRequested?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(alreadyRequested ? "done" : "idle");
  async function submit() {
    setState("busy");
    trackCivilonEvent("price_check_quote_request", { source_page: "/price-check/result" });
    const response = await fetch("/api/price-check/result/sourcing", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setState(response.ok ? "done" : "error");
  }
  return <section className="result-sourcing" aria-live="polite" data-result-region="sourcing-cta"><div><p>Need sourcing support?</p><h2>Get a Civilon Quote</h2><span>Civilon can follow up using the transaction context already reviewed.</span></div>{state === "done" ? <strong data-result-region="sourcing-confirmation">Your sourcing request has been sent to the Civilon team.</strong> : <button type="button" disabled={state === "busy"} onClick={submit}>{state === "busy" ? "Sending…" : "Get a Civilon Quote"}</button>}{state === "error" && <p>We could not record the request. Contact Civilon for assistance.</p>}</section>;
}
