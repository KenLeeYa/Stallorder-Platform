import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PwaRuntime } from "@/components/pwa-runtime";
import { VercelPerformanceMonitoring } from "@/components/vercel-performance-monitoring";
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
  title: "攤點通｜行動點餐與攤位營運",
  description: "協助夜市攤位、餐車與小型餐飲商家管理 QR Code 點餐、出餐、付款與銷售報表。",
  applicationName: "StallOrder",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "StallOrder",
  },
  icons: {
    icon: [
      { url: "/icons/stallorder-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/stallorder-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/stallorder-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant-TW"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full bg-stone-50 text-stone-950">
        <a href="#main-content" className="skip-link">跳至主要內容</a>
        <PwaRuntime>
          <div id="main-content" tabIndex={-1}>{children}</div>
        </PwaRuntime>
        {process.env.VERCEL === "1" ? <VercelPerformanceMonitoring /> : null}
      </body>
    </html>
  );
}
