"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- vinext navigation uses standard anchors. */

import { useEffect, useRef, useState } from "react";
import { trackCivilonEvent } from "@/lib/analytics";
import {
  BUY_REQUEST_VERIFY_API_PATH,
  BUY_REQUEST_VERIFY_FRAGMENT_KEY,
  BUY_REQUEST_VERIFY_PATH,
  type BuyRequestVerifyResponse,
} from "@/lib/marketplace/contract";

type Stage = "reading" | "ready" | "confirming" | "verified" | "unavailable";

/**
 * Reads the verification credential from the URL fragment, erases it from the
 * address bar and history immediately, and holds it only in memory until the
 * customer presses Confirm.
 *
 * Two deliberate properties:
 *
 *  - Nothing is submitted on load. Corporate mail scanners, link previewers and
 *    browser prefetchers all follow emailed links; if arriving on this page
 *    redeemed the credential, those systems would spend a single-use token
 *    before the customer ever read the message. Redemption therefore requires a
 *    real click.
 *  - The credential never becomes part of a URL the server sees. It arrives in a
 *    fragment, which is not transmitted, and `history.replaceState` removes it
 *    before it can leak through a shared screen, a bookmark, or a later Referer.
 */
export function BuyRequestVerification() {
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
    // credential with an empty string, stranding a customer holding a valid link
    // on "unavailable". The guard is set before the read so no later execution
    // can touch the token or the stage.
    if (initialized.current) return;
    initialized.current = true;

    const fragment = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const value = new URLSearchParams(fragment).get(BUY_REQUEST_VERIFY_FRAGMENT_KEY) ?? "";

    // Erase first, decide second: even a malformed fragment should not linger in
    // the address bar or in session history.
    if (window.location.hash) {
      window.history.replaceState(null, "", BUY_REQUEST_VERIFY_PATH);
    }

    token.current = value;
    // The URL fragment is browser-only state that does not exist during server
    // render, so it can only be read after mount: the documented "subscribe to
    // an external system" case, reached at most once thanks to the guard above.
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
      const response = await fetch(BUY_REQUEST_VERIFY_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.current }),
      });
      const result = await response.json() as BuyRequestVerifyResponse;
      // The server answered, so the credential's work is done whichever way it
      // went. Dropping it keeps it out of a later memory snapshot or error
      // report, and guarantees a second press cannot replay it.
      token.current = "";
      if (result.ok) {
        setStage("verified");
        trackCivilonEvent("buy_request_verification_confirmed", {
          source_page: BUY_REQUEST_VERIFY_PATH,
        });
      } else {
        setStage("unavailable");
      }
    } catch {
      // No answer came back, so nothing was necessarily consumed. Telling a
      // customer their link is dead because their train went into a tunnel would
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
          Civilon will review your request and source the part. A member of the
          Civilon team will contact you at the address you confirmed.
        </p>
        <div className="pc-final-note" role="note">
          <strong>What is still to be confirmed</strong>
          <p>
            Availability, stated condition, documentation, delivery and price all
            remain subject to confirmation. Documentation varies by part and
            source. Repair work, where required, is coordinated with
            appropriately approved repair facilities.
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
          The link may have expired or already been used. If you still need the
          part, send a new request and Civilon will pick it up from there.
        </p>
        <div className="marketplace-verify-actions">
          <a className="button button-primary" href="/buy-sell-aircraft-parts/buy">Send a new request</a>
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
        Press confirm to finish your request. Civilon reviews and sources each
        request internally; nothing is confirmed as available until Civilon
        checks it.
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
        Confirming does not create an account and does not place an order.
      </small>
    </div>
  );
}
