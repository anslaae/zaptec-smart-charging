import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppToaster } from "@/components/AppToaster";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { TabBar } from "@/components/TabBar";
import { MockBanner } from "@/components/MockBanner";
import { nb } from "@/lib/i18n/nb";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: nb.app.name,
  description: "Planlegg lading av bilen på Zaptec-laderen",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: nb.app.name,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the tab bar's env(safe-area-inset-bottom) see the home-indicator area.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F5EF" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0F0D" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="nb"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* The translucent status bar + viewport-fit=cover draw the page from the very top
          of the screen on iOS: keep content below the clock/notch (0 elsewhere). */}
      <body className="min-h-full flex flex-col pt-[env(safe-area-inset-top)]">
        <ConfirmProvider>
          <MockBanner />
          {children}
          <TabBar />
        </ConfirmProvider>
        <AppToaster />
      </body>
    </html>
  );
}
