import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: "https://oddsaura.site", lastModified, changeFrequency: "weekly", priority: 1 },
    { url: "https://oddsaura.site/privacy", lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: "https://oddsaura.site/terms", lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: "https://oddsaura.site/responsible-gambling", lastModified, changeFrequency: "yearly", priority: 0.5 },
    { url: "https://oddsaura.site/contact", lastModified, changeFrequency: "monthly", priority: 0.5 },
  ];
}
