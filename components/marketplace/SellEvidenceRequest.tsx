"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- vinext navigation uses standard anchors. */

import { useEffect, useRef, useState } from "react";
import { trackCivilonEvent } from "@/lib/analytics";
import {
  SELL_EVIDENCE_FRAGMENT_KEY,
  SELL_EVIDENCE_PAGE_PATH,
  SELL_EVIDENCE_SUBMIT_API_PATH,
  SELL_EVIDENCE_VIEW_API_PATH,
  type SellEvidenceRequestView,
  type SellEvidenceSubmitResponse,
  type SellEvidenceViewResponse,
} from "@/lib/marketplace/sell-evidence-contract";
import { sellUploadOptions } from "@/lib/marketplace/sell-upload-options";
import { SellSubmissionUploads, type UploadItem } from "./SellSubmissionUploads";

/**
 * The account-free follow-up evidence surface.
 *
 * Everything the verification page does about credential handling, it does too,
 * and for the same reasons:
 *
 *  - The credential arrives in the URL fragment, which browsers never transmit,
 *    and `history.replaceState` erases it before it can leak through a shared
 *    screen, a bookmark, or a later Referer.
 *  - Nothing is submitted on load. Opening the page only *reads* the request;
 *    the credential is spent on an explicit press, so a corporate mail scanner
 *    or a link previewer following the link cannot consume it.
 *  - The credential is never rendered, never written back to the URL, never put
 *    in a form field, and never given to analytics.
 *
 * The two analytics events this component emits carry `source_page` only. No
 * token, filename, purpose, size, handle, reference, category, or file content
 * reaches analytics from this page — which is why the reference and the labels
 * live in React state and are never passed to `trackCivilonEvent`.
 */
type Stage = "reading" | "loading" | "ready" | "sending" | "sent" | "unavailable";

function formatExpiry(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function SellEvidenceRequest() {
  const [stage, setStage] = useState<Stage>("reading");
  const [request, setRequest] = useState<SellEvidenceRequestView | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [error, setError] = useState("");
  const token = useRef("");
  const initialized = useRef(false);

  useEffect(() => {
    // Reading the fragment is destructive: the first run consumes it and erases
    // it from the URL. React may run a mount effect's setup twice against a
    // component whose refs survive in between — StrictMode does exactly that in
    // development — and without this guard the second run would find an
    // already-cleared fragment and overwrite a perfectly good captured
    // credential. The guard is set before the read, so no later execution can
    // touch the token or the stage.
    if (initialized.current) return;
    initialized.current = true;

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const value = new URLSearchParams(hash).get(SELL_EVIDENCE_FRAGMENT_KEY) ?? "";

    // Erase first, decide second: even a malformed fragment should not linger
    // in the address bar or in session history.
    if (window.location.hash) {
      window.history.replaceState(null, "", SELL_EVIDENCE_PAGE_PATH);
    }
    token.current = value;
    // One synchronous transition, then everything else happens in the fetch's
    // own callbacks. A second synchronous setState here would be a cascading
    // render for no benefit.
    setStage(value ? "loading" : "unavailable");
    if (!value) return;

    void (async () => {
      try {
        const response = await fetch(SELL_EVIDENCE_VIEW_API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ token: value }),
        });
        const result = await response.json() as SellEvidenceViewResponse;
        if (!result.ok) {
          token.current = "";
          setStage("unavailable");
          return;
        }
        setRequest(result.request);
        setStage("ready");
        trackCivilonEvent("sell_evidence_request_opened", {
          source_page: SELL_EVIDENCE_PAGE_PATH,
        });
      } catch {
        // No answer came back, so nothing was necessarily wrong with the link.
        // The credential stays in memory and the seller can reload.
        setStage("unavailable");
      }
    })();
  }, []);

  const finished = items.filter((item) => item.status === "ready" && item.handle);
  const pendingUploads = items.some(
    (item) => item.status === "authorizing" || item.status === "uploading",
  );

  async function send() {
    if (!token.current || finished.length === 0) return;
    setError("");
    setStage("sending");
    try {
      const response = await fetch(SELL_EVIDENCE_SUBMIT_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          token: token.current,
          attachmentHandles: finished.map((item) => item.handle),
        }),
      });
      const result = await response.json() as SellEvidenceSubmitResponse;
      if (result.ok) {
        // The credential's work is done. Dropping it keeps it out of a later
        // memory snapshot or error report and guarantees no second press can
        // replay it.
        token.current = "";
        setStage("sent");
        trackCivilonEvent("sell_evidence_request_submitted", {
          source_page: SELL_EVIDENCE_PAGE_PATH,
        });
        return;
      }
      if (result.status === "unavailable") {
        token.current = "";
        setStage("unavailable");
        return;
      }
      // A retry or a rejected file. The credential was not spent, so the seller
      // can fix the file and press again.
      setError(result.error);
      setStage("ready");
    } catch {
      setError("Your files could not be sent. Check your connection and try again.");
      setStage("ready");
    }
  }

  if (stage === "reading" || stage === "loading") {
    return (
      <div className="marketplace-verify-panel" role="status">
        <p>Preparing your secure upload…</p>
      </div>
    );
  }

  if (stage === "unavailable") {
    return (
      <div className="marketplace-verify-panel is-unavailable" role="status" aria-live="polite">
        <span className="section-label">SECURE LINK / UNAVAILABLE</span>
        <h2>This link cannot be used.</h2>
        <p>
          The link may have expired, already been used, or been replaced by a
          newer one. Civilon still has your original submission—nothing has been
          lost. Contact Civilon and the team will send a fresh link.
        </p>
        <div className="marketplace-verify-actions">
          <a className="button button-primary" href="/contact-us">Contact Civilon</a>
          <a className="button button-ghost" href="/">Return to Civilon</a>
        </div>
      </div>
    );
  }

  if (stage === "sent") {
    return (
      <div className="marketplace-verify-panel is-verified" role="status" aria-live="polite">
        <span className="section-label">RECEIVED / FILES</span>
        <h2>Civilon has your files.</h2>
        <p>
          They are held privately for Civilon&rsquo;s internal review and are not
          published, listed, or shown to a buyer. No account was created.
        </p>
        <div className="pc-final-note" role="note">
          <strong>What is still to be confirmed</strong>
          <p>
            Civilon reviews each submission internally and is not obliged to buy.
            Interest, availability, stated condition, documentation and price all
            remain subject to confirmation, and documentation varies by part and
            source. Sending files, and Civilon&rsquo;s review of them, are not
            certification, authentication, regulatory approval, airworthiness
            approval, or a guarantee of authenticity or fitness.
          </p>
        </div>
        <a className="button button-primary" href="/">Return to Civilon</a>
      </div>
    );
  }

  const options = sellUploadOptions.filter(
    (option) => request?.categories.includes(option.value as never),
  );
  const expiry = request ? formatExpiry(request.expiresAt) : null;

  return (
    <div className="marketplace-verify-panel">
      <span className="section-label">SECURE UPLOAD / NO ACCOUNT</span>
      <h2>Send Civilon what was asked for.</h2>
      <p>
        Reference <code>{request?.reference}</code>. Civilon already has your
        submission—this only adds files. Nothing you send is published, listed,
        or shown to a buyer, and no account is created.
      </p>
      <p>Civilon asked for:</p>
      <ul className="marketplace-evidence-request-list">
        {options.map((option) => <li key={option.value}>{option.label}</li>)}
      </ul>
      {expiry && <p className="field-help">This secure link works until {expiry}.</p>}

      {options.length > 0 && (
        <SellSubmissionUploads
          items={items}
          onChange={(update) => setItems((current) => update(current))}
          options={options}
          sourcePage={SELL_EVIDENCE_PAGE_PATH}
          required
        />
      )}

      {error && <p className="field-error" role="alert">{error}</p>}

      <button
        type="button"
        className="pc-next"
        onClick={() => void send()}
        disabled={stage === "sending" || finished.length === 0}
      >
        {stage === "sending" ? "Sending…" : "Send files to Civilon"}
        <span aria-hidden="true">→</span>
      </button>
      <small className="field-help">
        {finished.length === 0
          ? pendingUploads
            ? "Waiting for your files to finish uploading."
            : "Add at least one file, then send."
          : `${finished.length} file${finished.length === 1 ? "" : "s"} ready to send.`}{" "}
        Sending does not create an account and does not sell anything. Civilon is
        not obliged to buy, and uploading is not certification, authentication,
        regulatory or airworthiness approval, or a guarantee of authenticity or
        fitness. Documentation varies by part and source.
      </small>
    </div>
  );
}
