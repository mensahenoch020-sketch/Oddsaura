import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
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
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
