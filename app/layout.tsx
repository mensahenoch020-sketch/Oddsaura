import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./legal.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://oddsaura.site"),
  title: "OddsAura | Probability-led football picks",
  description: "Simple football picks and ready-to-copy bookmaker codes.",
  openGraph: {
    title: "OddsAura | Probability-led football picks",
    description: "Football predictions, backed by probability.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "OddsAura | Probability-led football picks",
    description: "Football predictions, backed by probability.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  manifest: "/manifest.webmanifest",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "OddsAura",
          url: "https://oddsaura.site",
          applicationCategory: "SportsApplication",
          operatingSystem: "Any",
          description: "Football predictions, booking-code creation and bookmaker-code conversion.",
        }) }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
