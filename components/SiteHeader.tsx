"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { navigation, siteConfig } from "@/lib/site-config";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { isMarketplaceEnabled } from "@/lib/marketplace/feature";
import { CallAogAction, WhatsAppAogAction } from "./AogActions";

export function SiteHeader() {
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
        ...(isMarketplaceEnabled() ? [{ label: "Buy & Sell Aircraft Parts", href: "/buy-sell-aircraft-parts" }] : []),
        ...(isPriceCheckEnabled() ? [{ label: "Aircraft Part Price Check", href: "/price-check" }] : []),
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
        <div className="topbar-message" aria-hidden="true">
          <span>24/7 monitored AOG phone &amp; WhatsApp</span>
          <span>FAA 8130-3 / EASA Form 1 where applicable</span>
          <span>Trace-to-source review</span>
          <span>Expedited routing options subject to availability</span>
        </div>
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
            <a className="button button-primary" href="/contact-us#rfq" onClick={() => closeMobile(false)}>Start a part search</a>
            <div><CallAogAction source_page="navigation">Call AOG desk</CallAogAction><WhatsAppAogAction source_page="navigation">WhatsApp AOG</WhatsAppAogAction></div>
          </div>
        </div>
        <a className="nav-cta" href="/contact-us#rfq">Start a part search <span>→</span></a>
        <button ref={toggleRef} className={`menu-toggle ${mobile ? "is-open" : ""}`} type="button" aria-expanded={mobile} aria-controls="mobile-navigation" aria-label={mobile ? "Close navigation" : "Open navigation"} onClick={() => mobile ? closeMobile() : setMobile(true)}><span /><span /><span /></button>
      </div>
    </nav>
  </header>;
}
