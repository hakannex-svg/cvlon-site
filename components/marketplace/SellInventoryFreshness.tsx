"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- vinext navigation uses standard anchors. */

import { useEffect, useRef, useState } from "react";
import { trackCivilonEvent } from "@/lib/analytics";
import {
  sellInventoryFreshnessResponseLabels,
  sellInventoryFreshnessResponses,
  type SellInventoryFreshnessResponse,
} from "@/db/price-check/domain/sell-inventory-freshness";
import {
  SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY,
  SELL_INVENTORY_FRESHNESS_PAGE_PATH,
  SELL_INVENTORY_FRESHNESS_RESPOND_API_PATH,
  SELL_INVENTORY_FRESHNESS_VIEW_API_PATH,
  type SellInventoryFreshnessRespondResponse,
  type SellInventoryFreshnessView,
  type SellInventoryFreshnessViewResponse,
} from "@/lib/marketplace/sell-inventory-freshness-contract";

/**
 * The account-free bulk-inventory freshness surface.
 *
 * Everything the evidence page does about credential handling, it does too, and
 * for the same reasons:
 *
 *  - The credential arrives in the URL fragment, which browsers never transmit,
 *    and `history.replaceState` erases it before it can leak through a shared
 *    screen, a bookmark, or a later Referer.
 *  - Nothing is submitted on load. Opening the page only *reads* the check; the
 *    answer is sent on an explicit press, so a corporate mail scanner or a link
 *    previewer following the link cannot answer on the seller's behalf. That is
 *    the difference between a record of what a seller said and a record of what
 *    their mail server did.
 *  - The credential is never rendered, never written back to the URL, never put
 *    in a form field, and never given to analytics.
 *
 * The two analytics events this component emits carry `source_page` only. The
 * chosen answer is deliberately not among them, and there is no per-answer event
 * name either: which of the three a seller picked is a fact about their stock.
 */
type Stage = "reading" | "loading" | "ready" | "sending" | "sent" | "unavailable";

/**
 * The one refusal the seller ever sees, used for every reason a link cannot be
 * used. Identical copy in each case: which check refused is Civilon's business,
 * and telling a stranger holding a guessed credential why it failed would be
 * telling them something about a submission that is not theirs.
 */
function UnavailablePanel() {
  return (
    <div className="marketplace-verify-panel is-unavailable" role="status" aria-live="polite">
      <span className="section-label">SECURE LINK / UNAVAILABLE</span>
      <h2>This link cannot be used.</h2>
      <p>
        The link may have expired, already been used, or been replaced by a
        newer one. Civilon still has your original submission&mdash;nothing has
        been lost. Contact Civilon and the team will send a fresh link.
      </p>
      <div className="marketplace-verify-actions">
        <a className="button button-primary" href="/contact-us">Contact Civilon</a>
        <a className="button button-ghost" href="/">Return to Civilon</a>
      </div>
    </div>
  );
}

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

/**
 * What each answer means, in the seller's own terms. None of them claims
 * anything about what Civilon does next, because Civilon does nothing
 * automatically with any of them.
 */
const responseHints: Record<SellInventoryFreshnessResponse, string> = {
  all_available: "Everything you offered is still with you as far as you know.",
  some_changed: "Part of it has moved, sold, or changed. Civilon will follow up.",
  none_available: "None of it is available any more. Civilon will stop asking.",
};

export function SellInventoryFreshness() {
  const [stage, setStage] = useState<Stage>("reading");
  const [check, setCheck] = useState<SellInventoryFreshnessView | null>(null);
  const [chosen, setChosen] = useState<SellInventoryFreshnessResponse | null>(null);
  const [answered, setAnswered] = useState<SellInventoryFreshnessResponse | null>(null);
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
    const value = new URLSearchParams(hash).get(SELL_INVENTORY_FRESHNESS_FRAGMENT_KEY) ?? "";

    // Erase first, decide second: even a malformed fragment should not linger in
    // the address bar or in session history.
    if (window.location.hash) {
      window.history.replaceState(null, "", SELL_INVENTORY_FRESHNESS_PAGE_PATH);
    }
    token.current = value;
    setStage(value ? "loading" : "unavailable");
    if (!value) return;

    void (async () => {
      try {
        const response = await fetch(SELL_INVENTORY_FRESHNESS_VIEW_API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ token: value }),
        });
        const result = await response.json() as SellInventoryFreshnessViewResponse;
        if (!result.ok) {
          token.current = "";
          setStage("unavailable");
          return;
        }
        setCheck(result.check);
        setStage("ready");
        trackCivilonEvent("sell_inventory_freshness_opened", {
          source_page: SELL_INVENTORY_FRESHNESS_PAGE_PATH,
        });
      } catch {
        // No answer came back, so nothing was necessarily wrong with the link.
        // The credential stays in memory and the seller can reload.
        setStage("unavailable");
      }
    })();
  }, []);

  async function send() {
    if (!token.current || !chosen || stage === "sending") return;
    setError("");
    setStage("sending");
    try {
      const response = await fetch(SELL_INVENTORY_FRESHNESS_RESPOND_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token: token.current, response: chosen }),
      });
      const result = await response.json() as SellInventoryFreshnessRespondResponse;
      if (result.ok) {
        // The credential's work is done. Dropping it keeps it out of a later
        // memory snapshot or error report and guarantees no second press can
        // replay it — which matters here because the server refuses every replay
        // uniformly, so a second press would show the seller the "cannot be
        // used" panel rather than their own confirmation.
        token.current = "";
        setAnswered(chosen);
        setStage("sent");
        trackCivilonEvent("sell_inventory_freshness_answered", {
          source_page: SELL_INVENTORY_FRESHNESS_PAGE_PATH,
        });
        return;
      }
      token.current = "";
      setStage("unavailable");
    } catch {
      setError("Your answer could not be sent. Check your connection and try again.");
      setStage("ready");
    }
  }

  if (stage === "reading" || stage === "loading") {
    return (
      <div className="marketplace-verify-panel" role="status">
        <p>Opening your secure link&hellip;</p>
      </div>
    );
  }

  if (stage === "unavailable") return <UnavailablePanel />;

  if (stage === "sent") {
    return (
      <div className="marketplace-verify-panel is-verified" role="status" aria-live="polite">
        <span className="section-label">RECORDED / YOUR ANSWER</span>
        <h2>Thank you &mdash; Civilon has your answer.</h2>
        <p>
          Civilon recorded that you said &ldquo;
          {answered ? sellInventoryFreshnessResponseLabels[answered] : ""}
          &rdquo;. It is held privately for Civilon&rsquo;s internal review and is
          not published, listed, or shown to a buyer. No account was created.
        </p>
        <div className="pc-final-note" role="note">
          <strong>What is still to be confirmed</strong>
          <p>
            Your answer is your own statement about your stock right now. Civilon
            reviews each submission internally and is not obliged to buy.
            Interest, availability, stated condition, documentation and price all
            remain subject to confirmation, and documentation varies by part and
            source. Neither the question nor your answer is certification,
            authentication, regulatory approval, airworthiness approval, or a
            guarantee of authenticity or fitness.
          </p>
        </div>
        <a className="button button-primary" href="/">Return to Civilon</a>
      </div>
    );
  }

  if (!check) return <UnavailablePanel />;

  const expiry = formatExpiry(check.expiresAt);

  return (
    <div className="marketplace-verify-panel">
      <span className="section-label">ONE QUESTION / NO ACCOUNT</span>
      <h2>Is this still available?</h2>
      <p>
        Reference <code>{check.reference}</code>. Civilon already has your
        submission&mdash;this only records whether it is still available. Nothing
        you answer is published, listed, or shown to a buyer, and no account is
        created.
      </p>
      {expiry && <p className="field-help">This secure link works until {expiry}.</p>}

      <fieldset className="marketplace-freshness-choices">
        <legend>Choose one answer</legend>
        {sellInventoryFreshnessResponses.map((response) => (
          <label key={response} htmlFor={`inventory-freshness-${response}`}>
            <input
              id={`inventory-freshness-${response}`}
              type="radio"
              name="inventory-freshness-response"
              value={response}
              checked={chosen === response}
              onChange={() => setChosen(response)}
              disabled={stage === "sending"}
            />
            {/* The answer and its explanation are direct children of the label,
                as the Sell form's own choices are: text nested one level deeper
                stops being the label's accessible name, which on a three-way
                choice is the difference between "Some items changed" and an
                unlabelled radio button. */}
            <strong>{sellInventoryFreshnessResponseLabels[response]}</strong>
            <small>{responseHints[response]}</small>
          </label>
        ))}
      </fieldset>

      {error && <p className="field-error" role="alert">{error}</p>}

      {/* Nothing is sent until this is pressed. Selecting an answer changes only
          what is on screen, so a mail scanner that renders the page and a seller
          who is still deciding both leave the record untouched. */}
      <button
        type="button"
        className="pc-next"
        onClick={() => void send()}
        disabled={stage === "sending" || !chosen}
      >
        {stage === "sending" ? "Sending…" : "Send this answer to Civilon"}
        <span aria-hidden="true">→</span>
      </button>
      <small className="field-help" role="status" aria-live="polite">
        {chosen ? "Your answer is sent only when you press the button." : "Choose one answer, then send."}{" "}
        Answering does not create an account and does not sell anything. Your
        answer is your own statement about your stock right now, and availability
        stays subject to confirmation. Civilon is not obliged to buy, and
        answering is not certification, authentication, regulatory or
        airworthiness approval, or a guarantee of authenticity or fitness.
        Documentation varies by part and source.
      </small>
    </div>
  );
}
