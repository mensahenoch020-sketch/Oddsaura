import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OddsAura",
    short_name: "OddsAura",
    description: "Football predictions and bookmaker code conversion.",
    start_url: "/",
    display: "standalone",
    background_color: "#080c0a",
    theme_color: "#080c0a",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    share_target: {
      action: "/admin",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
  } as MetadataRoute.Manifest;
}
