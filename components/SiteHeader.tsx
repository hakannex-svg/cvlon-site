"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element -- plain anchors preserve vinext navigation and the supplied SVG asset. */
import { useEffect, useRef, useState } from "react";
import { navigation, siteConfig } from "@/lib/site-config";

export function SiteHeader() {
  const [open, setOpen] = useState<string | null>(null); const [mobile, setMobile] = useState(false); const [currentPath]=useState(()=>typeof window === "undefined" ? "" : window.location.pathname); const ref = useRef<HTMLElement>(null);
  useEffect(() => { const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); }; const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); setMobile(false); } }; document.addEventListener("mousedown", close); document.addEventListener("keydown", key); return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); }; }, []);
  return <>
    <div className="topbar"><div className="shell topbar-inner"><span><i /> 24/7 AOG DESK</span><a href={`tel:${siteConfig.aogTel}`}>{siteConfig.aogPhone}</a><span className="topbar-place">Englewood Cliffs, New Jersey</span><a className="topbar-mail" href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a></div></div>
    <nav className="nav site-nav" aria-label="Main navigation" ref={ref}><div className="shell nav-inner"><a className="brand" href="/" aria-label="Civilon Air home"><img src="/civilon-logo.svg" alt="Civilon Air" /></a>
      <div className={`nav-links ${mobile ? "mobile-open" : ""}`}>{navigation.map(group => <div className="nav-group" key={group.label}><button type="button" aria-expanded={open === group.label} onClick={() => setOpen(open === group.label ? null : group.label)}>{group.label}<span aria-hidden="true">⌄</span></button><div className={`nav-menu ${open === group.label ? "is-open" : ""}`}>{group.items.map(item => <a href={item.href} aria-current={currentPath === item.href.split("#")[0] ? "page" : undefined} key={item.href} onClick={() => { setOpen(null); setMobile(false); }}>{item.label}</a>)}</div></div>)}</div>
      <a className="nav-cta" href="/contact-us#rfq">Start a part search <span>→</span></a><button className="menu-toggle" type="button" aria-expanded={mobile} aria-label="Toggle navigation" onClick={() => setMobile(!mobile)}><span /><span /><span /></button>
    </div></nav>
  </>;
}
