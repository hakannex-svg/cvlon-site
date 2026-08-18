"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- vinext navigation uses standard anchors. */

import { useEffect, useRef, useState } from "react";
import { trackCivilonEvent } from "@/lib/analytics";
import {
  SELL_SUBMISSION_VERIFY_API_PATH,
  SELL_SUBMISSION_VERIFY_FRAGMENT_KEY,
  SELL_SUBMISSION_VERIFY_PATH,
  type SellSubmissionVerifyResponse,
} from "@/lib/marketplace/sell-contract";

type Stage = "reading" | "ready" | "confirming" | "verified" | "unavailable";

/**
 * Reads the Sell verification credential from the URL fragment, erases it from
 * the address bar and history immediately, and holds it only in memory until
 * the seller presses Confirm.
 *
 * Same scanner-safe pattern as the Buy surface, and deliberately its own
 * component pointed at its own endpoint: the two aggregates issue credentials
 * under different HMAC labels, and a shared component would be one refactor away
 * from posting a Sell credential to the Buy endpoint.
 *
 *  - Nothing is submitted on load. Corporate mail scanners, link previewers and
 *    browser prefetchers all follow emailed links; if arriving here redeemed the
 *    credential, those systems would spend a single-use token before the seller
 *    ever read the message.
 *  - The credential never becomes part of a URL the server sees. It arrives in a
 *    fragment, which is not transmitted, and `history.replaceState` removes it
 *    before it can leak through a shared screen, a bookmark, or a later Referer.
 */
export function SellSubmissionVerification() {
  const [stage, setStage] = useState<Stage>("reading");
  const [retryable, setRetryable] = useState(false);
  const token = useRef("");
  const initialized = useRef(false);

  useEffect(() => {
    // Reading the fragment is destructive: the first run consumes it and erases
    // it from the URL. React may run an effect's setup more than once against a
    // component whose refs survive in between — StrictMode double-invokes every
    // mount effect in development. Without this guard the second run would find
    // an already-cleared fragment and overwrite a perfectly good captured
    // credential with an empty string, stranding a seller holding a valid link
    // on "unavailable". The guard is set before the read so no later execution
    // can touch the token or the stage.
    if (initialized.current) return;
    initialized.current = true;

    const fragment = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const value = new URLSearchParams(fragment).get(SELL_SUBMISSION_VERIFY_FRAGMENT_KEY) ?? "";

    // Erase first, decide second: even a malformed fragment should not linger in
    // the address bar or in session history.
    if (window.location.hash) {
      window.history.replaceState(null, "", SELL_SUBMISSION_VERIFY_PATH);
    }

    token.current = value;
    setStage(value ? "ready" : "unavailable");
  }, []);

  async function confirm() {
    if (!token.current) {
      setStage("unavailable");
      return;
    }
    setRetryable(false);
    setStage("confirming");
    try {
      const response = await fetch(SELL_SUBMISSION_VERIFY_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token: token.current }),
      });
      const result = await response.json() as SellSubmissionVerifyResponse;
      // The server answered, so the credential's work is done whichever way it
      // went. Dropping it keeps it out of a later memory snapshot or error
      // report, and guarantees a second press cannot replay it.
      token.current = "";
      if (result.ok) {
        setStage("verified");
        trackCivilonEvent("sell_submission_verification_confirmed", {
          source_page: SELL_SUBMISSION_VERIFY_PATH,
        });
      } else {
        setStage("unavailable");
      }
    } catch {
      // No answer came back, so nothing was necessarily consumed. Telling a
      // seller their link is dead because their train went into a tunnel would
      // be wrong, so the credential stays in memory for another press — never
      // written back to the URL, and never rendered.
      setRetryable(true);
      setStage("ready");
    }
  }

  if (stage === "reading") {
    return <div className="marketplace-verify-panel" role="status"><p>Preparing your confirmation…</p></div>;
  }

  if (stage === "verified") {
    return (
      <div className="marketplace-verify-panel is-verified" role="status" aria-live="polite">
        <span className="section-label">CONFIRMED / EMAIL ADDRESS</span>
        <h2>Your email address is confirmed.</h2>
        <p>
          Civilon will review what you have offered and a member of the team will
          contact you at the address you confirmed.
        </p>
        <div className="pc-final-note" role="note">
          <strong>What is still to be confirmed</strong>
          <p>
            Civilon is not obliged to buy. Interest, availability, stated
            condition, documentation and price all remain subject to
            confirmation, and documentation varies by part and source. Confirming
            your email address, and any evidence you uploaded, are not
            certification, regulatory approval, airworthiness approval, or a
            guarantee of authenticity or fitness. Nothing you submitted is
            published or listed.
          </p>
        </div>
        <a className="button button-primary" href="/">Return to Civilon</a>
      </div>
    );
  }

  if (stage === "unavailable") {
    return (
      <div className="marketplace-verify-panel is-unavailable" role="status" aria-live="polite">
        <span className="section-label">CONFIRMATION / UNAVAILABLE</span>
        <h2>This confirmation link cannot be used.</h2>
        <p>
          The link may have expired or already been used. If you still want to
          offer the parts, send a new submission and Civilon will pick it up from
          there.
        </p>
        <div className="marketplace-verify-actions">
          <a className="button button-primary" href="/buy-sell-aircraft-parts/sell">Send a new submission</a>
          <a className="button button-ghost" href="/contact-us">Contact Civilon</a>
        </div>
      </div>
    );
  }

  return (
    <div className="marketplace-verify-panel">
      <span className="section-label">CONFIRM / EMAIL ADDRESS</span>
      <h2>Confirm your email address.</h2>
      <p>
        Press confirm to finish your submission. Civilon reviews each submission
        internally and is not obliged to buy; nothing you submitted is published
        or listed.
      </p>
      {retryable && (
        <p className="field-error" role="alert">
          Your confirmation could not be sent. Check your connection and press
          confirm again—your link is still valid.
        </p>
      )}
      <button
        type="button"
        className="pc-next"
        onClick={confirm}
        disabled={stage === "confirming"}
      >
        {stage === "confirming" ? "Confirming…" : "Confirm email"}
        <span aria-hidden="true">→</span>
      </button>
      <small className="field-help">
        Confirming does not create an account and does not sell anything.
      </small>
    </div>
  );
}
