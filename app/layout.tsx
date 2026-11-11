import ConvexClientProvider from "@/components/ConvexClientProvider";
import { GAME_NAME, GAME_TAGLINE } from "@/lib/brand";
import type { Metadata, Viewport } from "next";

// Fonts are self-hosted from npm (Fontsource): no network fetch at build or run time.
import "@fontsource-variable/inter/wght.css";
import "@fontsource/cormorant-garamond/latin-400.css";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/cormorant-garamond/latin-600.css";
// Brush display face, Latin subset only: logo and big moments.
import "@fontsource/ma-shan-zheng/latin-400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: GAME_NAME,
  description: GAME_TAGLINE,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#03203e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full">
        <ConvexClientProvider>{children}</ConvexClientProvider>
        <div aria-hidden className="grain" />
      </body>
    </html>
  );
}
