import type { MetadataRoute } from "next"; import { siteConfig } from "@/lib/site-config";
export default function robots():MetadataRoute.Robots{const allowed=process.env.NEXT_PUBLIC_ALLOW_INDEXING==="true";return {rules:{userAgent:"*",allow:allowed?"/":undefined,disallow:allowed?undefined:"/"},sitemap:`${siteConfig.url}/sitemap.xml`};}
