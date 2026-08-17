import type { MetadataRoute } from "next";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { routes, siteConfig } from "@/lib/site-config";

export default function sitemap(): MetadataRoute.Sitemap {
  const enabledRoutes = isPriceCheckEnabled() ? [...routes, "/price-check"] : routes;
  return enabledRoutes.map((path) => ({
    url: new URL(path, siteConfig.url).toString(),
    lastModified: new Date(),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/privacy-policy" || path === "/terms-of-use" ? 0.3 : 0.7,
  }));
}
