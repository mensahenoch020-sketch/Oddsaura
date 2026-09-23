import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/assistant", "/builder", "/dashboard", "/daily", "/matches", "/results"] }],
    sitemap: "https://oddsaura.site/sitemap.xml",
    host: "https://oddsaura.site",
  };
}
