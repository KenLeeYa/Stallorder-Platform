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
  title: "StallOrder 攤位點餐",
  description: "為夜市攤位、餐車與小型餐飲商戶打造的多租戶 QR Code 點餐 SaaS。",
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
        <PwaRuntime>{children}</PwaRuntime>
        {process.env.VERCEL === "1" ? <VercelPerformanceMonitoring /> : null}
      </body>
    </html>
  );
}
