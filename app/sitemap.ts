import type { MetadataRoute } from "next";
import { isPriceCheckEnabled } from "@/lib/price-check/feature";
import { isMarketplaceEnabled, isSellSubmissionEnabled } from "@/lib/marketplace/feature";
import { routes, siteConfig } from "@/lib/site-config";

export default function sitemap(): MetadataRoute.Sitemap {
  // Only publicly discoverable marketplace surfaces are listed. The
  // verification page is intentionally excluded: it is private, per-recipient,
  // and has nothing to offer a crawler.
  const enabledRoutes = [
    ...routes,
    ...(isMarketplaceEnabled() ? ["/buy-sell-aircraft-parts", "/buy-sell-aircraft-parts/buy"] : []),
    ...(isSellSubmissionEnabled() ? ["/buy-sell-aircraft-parts/sell"] : []),
    ...(isPriceCheckEnabled() ? ["/price-check"] : []),
  ];
  return enabledRoutes.map((path) => ({
    url: new URL(path, siteConfig.url).toString(),
    lastModified: new Date(),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/privacy-policy" || path === "/terms-of-use" ? 0.3 : 0.7,
  }));
}
