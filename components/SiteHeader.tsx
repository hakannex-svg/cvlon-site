"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { navigation, siteConfig } from "@/lib/site-config";
import { CallAogAction, WhatsAppAogAction } from "./AogActions";
import { TopbarTicker } from "./TopbarTicker";
import { PUBLIC_CTA } from "@/lib/public-cta";
import { MroEuropeAnnouncement } from "./MroEuropePromotion";

type SiteHeaderProps = {
  marketplaceEnabled: boolean;
  sellSubmissionEnabled: boolean;
  priceCheckEnabled: boolean;
  searchHref: string;
};

export function SiteHeader({ marketplaceEnabled, sellSubmissionEnabled, priceCheckEnabled, searchHref }: SiteHeaderProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeMobile = (restore = true) => {
    setMobile(false);
    setOpen(null);
    if (restore) requestAnimationFrame(() => toggleRef.current?.focus());
  };

  useEffect(() => {
    document.body.classList.toggle("mobile-menu-active", mobile);
    window.dispatchEvent(new CustomEvent("civilon:mobile-menu", { detail: { open: mobile } }));
    if (mobile) requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("button,a")?.focus());
    return () => document.body.classList.remove("mobile-menu-active");
  }, [mobile]);

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (mobile) closeMobile();
        else setOpen(null);
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [mobile]);

  // Each workflow contributes its own entry under its own flag, so enabling
  // one can never reveal the other. The private verification page is
  // deliberately absent: it is only ever reached from an emailed link.
  const visibleNavigation = navigation.map((group) => group.label === "Services"
    ? {
      ...group,
      items: [
        ...group.items,
        ...(marketplaceEnabled ? [{ label: PUBLIC_CTA.buy, href: "/buy-sell-aircraft-parts/buy" }] : []),
        ...(sellSubmissionEnabled ? [{ label: PUBLIC_CTA.sell, href: "/buy-sell-aircraft-parts/sell" }] : []),
        ...(priceCheckEnabled ? [{ label: "Aircraft Part Price Check", href: "/price-check" }] : []),
      ],
    }
    : group);

  return <header>
    <div className="topbar">
      <div className="shell topbar-inner">
        <div className="topbar-aog">
          <span><i />24/7 AOG DESK</span>
          <a href={`tel:${siteConfig.aogTel}`}>{siteConfig.aogPhone}</a>
        </div>
        <TopbarTicker />
        <div className="topbar-office">
          <span className="topbar-place">Englewood Cliffs, New Jersey</span>
          <a className="topbar-mail" href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
        </div>
      </div>
    </div>
    <nav className="nav site-nav" aria-label="Main navigation" ref={ref}>
      <div className="shell nav-inner">
        <a className="brand" href="/" aria-label="Civilon home"><img src="/civilon-logo.svg" alt="Civilon" /></a>
        <div id="mobile-navigation" ref={panelRef} className={`nav-links ${mobile ? "mobile-open" : ""}`}>
          {visibleNavigation.map((group) => <div className="nav-group" key={group.label}>
            <button type="button" aria-expanded={open === group.label} onClick={() => setOpen(open === group.label ? null : group.label)}>{group.label}<span aria-hidden="true">⌄</span></button>
            <div className={`nav-menu ${open === group.label ? "is-open" : ""}`}>{group.items.map((item) => <a href={item.href} key={item.href} onClick={() => closeMobile(false)}>{item.label}</a>)}</div>
          </div>)}
          <div className="mobile-menu-actions">
            <a className="button button-primary" href={searchHref} onClick={() => closeMobile(false)}>{PUBLIC_CTA.buy}</a>
            <div><CallAogAction source_page="navigation">{PUBLIC_CTA.callAog}</CallAogAction><WhatsAppAogAction source_page="navigation">{PUBLIC_CTA.whatsAppAog}</WhatsAppAogAction></div>
          </div>
        </div>
        <a className="nav-cta" href={searchHref}>{PUBLIC_CTA.buy} <span>→</span></a>
        <button ref={toggleRef} className={`menu-toggle ${mobile ? "is-open" : ""}`} type="button" aria-expanded={mobile} aria-controls="mobile-navigation" aria-label={mobile ? "Close navigation" : "Open navigation"} onClick={() => mobile ? closeMobile() : setMobile(true)}><span /><span /><span /></button>
      </div>
    </nav>
    <MroEuropeAnnouncement />
  </header>;
}
