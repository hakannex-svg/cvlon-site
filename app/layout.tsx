import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { GlobalAogChrome } from "@/components/GlobalAogChrome";
import { AnalyticsBootstrap } from "@/components/AnalyticsBootstrap";
import { ConsentPreferences } from "@/components/ConsentPreferences";
import { siteConfig } from "@/lib/site-config";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: "Business Aircraft Parts Sourcing & AOG Coordination | Civilon",
  description: "Source business-aircraft components with condition, documentation and delivery requirements coordinated through one Civilon contact.",
  alternates: { canonical: "/" },
  robots: { index: process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true", follow: true },
  openGraph: {
    title: "Civilon | Business Aircraft Parts Sourcing",
    description: "Business-aircraft parts sourcing, AOG coordination and repair-management support.",
    url: "/",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Civilon aircraft parts sourcing and AOG coordination" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const schema = { "@context":"https://schema.org", "@type":["Organization","LocalBusiness"], name:siteConfig.name, legalName:siteConfig.legalName, url:siteConfig.url, telephone:siteConfig.officePhone, email:siteConfig.email, address:{"@type":"PostalAddress",streetAddress:"375 Sylvan Ave, Suite 23",addressLocality:"Englewood Cliffs",addressRegion:"NJ",postalCode:"07632",addressCountry:"US"}, openingHoursSpecification:{"@type":"OpeningHoursSpecification",dayOfWeek:["Monday","Tuesday","Wednesday","Thursday","Friday"],opens:"08:00",closes:"17:00"}, contactPoint:[{"@type":"ContactPoint",telephone:siteConfig.officePhone,contactType:"sales and office"},{"@type":"ContactPoint",telephone:siteConfig.aogPhone,contactType:"AOG support",hoursAvailable:{"@type":"OpeningHoursSpecification",dayOfWeek:["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],opens:"00:00",closes:"23:59"}}] };
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}><SiteHeader />{children}<GlobalAogChrome /><SiteFooter /><AnalyticsBootstrap /><ConsentPreferences /><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema)}} /></body></html>;
}
