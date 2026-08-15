import type { Metadata } from "next";
import { siteConfig } from "./site-config";

export function pageMetadata(title: string, description: string, path: string): Metadata {
  return { title: `${title} | Civilon Air`, description, alternates: { canonical: path }, robots: { index: process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true", follow: true }, openGraph: { title: `${title} | Civilon Air`, description, url: path, siteName: siteConfig.name, images: [{ url: "/og.png", width: 1200, height: 630, alt: "Civilon Air business aviation support" }] } };
}
