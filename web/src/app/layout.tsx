import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { BottomNav } from "@/components/bottom-nav";
import { AuthProvider } from "@/components/auth-provider";
import { NameSetupModal } from "@/components/name-setup-modal";
import { MainContainer } from "@/components/main-container";
import { ToasterProvider } from "@/components/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://sports-streaming-app.vercel.app";

const SITE_DESCRIPTION =
  "子どもの部活・スポーツ少年団・ローカル大会を、保護者がスマホで配信。離れた家族や応援団が一緒に観戦できる、UGC型スポーツライブ配信プラットフォーム。";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "LIVE SPOtCH - 地域の試合をスマホで配信・視聴",
    template: "%s | LIVE SPOtCH",
  },
  description: SITE_DESCRIPTION,
  applicationName: "LIVE SPOtCH",
  keywords: [
    "スポーツ配信",
    "ライブ配信",
    "部活",
    "スポーツ少年団",
    "地域大会",
    "サッカー",
    "野球",
    "バスケ",
    "バレー",
    "子ども",
    "試合",
    "観戦",
  ],
  openGraph: {
    title: "LIVE SPOtCH - 地域の試合をスマホで配信・視聴",
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: "LIVE SPOtCH",
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LIVE SPOtCH - 地域の試合をスマホで配信・視聴",
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-white">
        <AuthProvider>
          <ToasterProvider>
            <NameSetupModal />
            <MainContainer>{children}</MainContainer>
            <BottomNav />
          </ToasterProvider>
        </AuthProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
