import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { GlobalAogChrome } from "@/components/GlobalAogChrome";
import { siteConfig } from "@/lib/site-config";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: "Aircraft Parts Sourcing & 24/7 AOG Support | Civilon Air",
  description: "Civilon Air sources fully traceable business-aircraft components and coordinates 24/7 AOG delivery worldwide.",
  openGraph: {
    title: "Civilon Air | The right aircraft part. Certified and moving.",
    description: "Aircraft parts sourcing and 24/7 AOG support worldwide.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Civilon Air aircraft parts and AOG support" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const schema = { "@context":"https://schema.org", "@type":["Organization","LocalBusiness"], name:siteConfig.name, url:siteConfig.url, telephone:siteConfig.officePhone, email:siteConfig.email, address:{"@type":"PostalAddress",streetAddress:"375 Sylvan Avenue, Unit 23",addressLocality:"Englewood Cliffs",addressRegion:"NJ",postalCode:"07632",addressCountry:"US"}, contactPoint:{"@type":"ContactPoint",telephone:siteConfig.aogPhone,contactType:"AOG support"} };
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}><SiteHeader />{children}<GlobalAogChrome /><SiteFooter /><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema)}} /></body></html>;
}
