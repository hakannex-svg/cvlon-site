"use client";
/* eslint-disable @next/next/no-img-element -- supplied event art has explicit dimensions. */
import { useEffect, useState } from "react";
import { trackCivilonEvent } from "@/lib/analytics";
import { isPrivateAnalyticsRoute } from "@/lib/analytics-private-routes";
import { getMroEuropePromotionPhase, MRO_EUROPE_2026, type MroEuropePromotionPhase } from "@/lib/mro-europe-2026";

const MAX_TIMER_DELAY = 2_147_000_000;

function usePromotionPhase() {
  // The checked-in promotion is rendered in the pre-expiry HTML, then the
  // client clock keeps long-lived static deploys accurate without a rebuild.
  const [phase, setPhase] = useState<MroEuropePromotionPhase>("show");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      if (isPrivateAnalyticsRoute(window.location.pathname)) {
        setPhase("inactive");
        return;
      }

      const next = getMroEuropePromotionPhase();
      setPhase(next);
      if (next === "inactive") return;

      const boundary = next === "show" ? MRO_EUROPE_2026.showEndsAt : MRO_EUROPE_2026.promotionEndsAt;
      timer = setTimeout(refresh, Math.min(Math.max(Date.parse(boundary) - Date.now(), 1), MAX_TIMER_DELAY));
    };

    refresh();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  return phase;
}

function sourcePage() {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

export function MroEuropeAnnouncement() {
  const phase = usePromotionPhase();
  if (phase === "inactive") return null;

  const followUp = phase === "follow-up";
  return (
    <aside className="mro-announcement" aria-label="MRO Europe 2026 announcement">
      <div className="shell mro-announcement-inner">
        <span className="mro-announcement-tag">MRO EUROPE 2026</span>
        <p>
          <strong>{followUp ? "Civilon was in Amsterdam" : "Meet Civilon in Amsterdam"}</strong>
          <span>{MRO_EUROPE_2026.dates} · {MRO_EUROPE_2026.venue} · Booth {MRO_EUROPE_2026.booth}</span>
        </p>
        <a
          href={followUp ? MRO_EUROPE_2026.followUpHref : "/#mro-europe-2026"}
          onClick={() => trackCivilonEvent("event_banner_click", {
            source_page: sourcePage(),
            cta_location: followUp ? "mro_announcement_follow_up" : "mro_announcement",
          })}
        >
          {followUp ? "Continue the conversation" : `Meet us at Booth ${MRO_EUROPE_2026.booth}`} <span aria-hidden="true">→</span>
        </a>
      </div>
    </aside>
  );
}

export function MroEuropeFeature() {
  const phase = usePromotionPhase();
  if (phase === "inactive") return null;

  const followUp = phase === "follow-up";
  return (
    <section className="section section-tight mro-event-section" id="mro-europe-2026" aria-labelledby="mro-europe-heading">
      <div className="shell mro-event-layout">
        <div className="mro-event-art">
          <img src={MRO_EUROPE_2026.image} width="420" height="220" alt={MRO_EUROPE_2026.imageAlt} />
        </div>
        <div className="mro-event-copy">
          <span className="section-label">MEET CIVILON / MRO EUROPE 2026</span>
          <h2 id="mro-europe-heading">{followUp ? "Continue the conversation." : "Meet Civilon in Amsterdam."}</h2>
          <p>{followUp
            ? "Civilon joined the aviation aftermarket community in Amsterdam. Connect with our team to continue a conversation about parts sourcing, AOG coordination, repair management or private inventory opportunities."
            : "Discuss business-aircraft parts sourcing, AOG coordination, repair management and private inventory opportunities with our team."}</p>
          <dl className="mro-event-facts">
            <div><dt>When</dt><dd>{MRO_EUROPE_2026.dates}</dd></div>
            <div><dt>Where</dt><dd>{MRO_EUROPE_2026.venue}<br />{MRO_EUROPE_2026.location}</dd></div>
            <div><dt>Booth</dt><dd>{MRO_EUROPE_2026.booth}</dd></div>
          </dl>
          <a
            className="button button-primary mro-event-cta"
            href={followUp ? MRO_EUROPE_2026.followUpHref : MRO_EUROPE_2026.meetingHref}
            onClick={() => trackCivilonEvent("mro_meeting_click", {
              source_page: "/",
              cta_location: followUp ? "mro_home_follow_up" : "mro_home_feature",
            })}
          >
            {followUp ? "Email our team" : "Schedule a meeting"} <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}
