import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { LocaleProvider } from "@/components/locale-provider";
import { NavigationStateManager } from "@/components/navigation-state-manager";
import { PwaRuntime } from "@/components/pwa-runtime";
import { VercelPerformanceMonitoring } from "@/components/vercel-performance-monitoring";
import { ClientExceptionReporter } from "@/components/client-exception-reporter";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getAppMessage } from "@/lib/app-messages";
import { initializeThemeScript } from "@/lib/theme";
import { initializeAccessibilityModeScript } from "@/lib/accessibility-mode";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getRequestAppLocale();
  const appName = getAppMessage(locale, "app.name");

  return {
    title: getAppMessage(locale, "app.metadata.title"),
    description: getAppMessage(locale, "app.metadata.description"),
    applicationName: appName,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: appName,
    },
    icons: {
      icon: [
        { url: "/icons/stallorder-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/stallorder-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icons/stallorder-192.png", sizes: "192x192", type: "image/png" }],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, hasLocaleCookie } = await getRequestAppLocale();

  return (
    <html
      lang={locale}
      data-theme="light"
      data-interface-mode="standard"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <Script
          id="stallorder-theme-initializer"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: initializeThemeScript }}
        />
        <Script
          id="stallorder-accessibility-mode-initializer"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: initializeAccessibilityModeScript }}
        />
      </head>
      <body suppressHydrationWarning className="min-h-full bg-stone-50 text-stone-950">
        <a href="#main-content" className="skip-link">{getAppMessage(locale, "shell.skipToMain")}</a>
        <LocaleProvider initialLocale={locale} hasLocaleCookie={hasLocaleCookie}>
          <PwaRuntime>
            <ClientExceptionReporter />
            <NavigationStateManager />
            <div id="main-content" tabIndex={-1}>{children}</div>
          </PwaRuntime>
        </LocaleProvider>
        {process.env.VERCEL === "1" ? <VercelPerformanceMonitoring /> : null}
      </body>
    </html>
  );
}
