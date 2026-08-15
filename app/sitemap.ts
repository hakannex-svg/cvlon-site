import type { MetadataRoute } from "next"; import { routes, siteConfig } from "@/lib/site-config";
export default function sitemap():MetadataRoute.Sitemap{return routes.map(path=>({url:new URL(path,siteConfig.url).toString(),lastModified:new Date(),changeFrequency:path==="/"?"weekly":"monthly",priority:path==="/"?1:.7}));}
