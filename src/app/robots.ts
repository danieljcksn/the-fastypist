import type { MetadataRoute } from "next";
import { siteUrl } from "@/i18n/seo";

// The private pages are left crawlable on purpose: next.config.ts marks them noindex, and a crawler that is disallowed never sees that.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/__clerk/"] },
    sitemap: new URL("/sitemap.xml", siteUrl()).href,
  };
}
