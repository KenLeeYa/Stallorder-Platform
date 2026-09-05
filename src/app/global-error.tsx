"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_APP_LOCALE,
  resolveNavigatorLocale,
  type AppLocale,
} from "@/lib/app-locale";
import { getAppMessage } from "@/lib/app-messages";
import { reportClientException } from "@/lib/client-exception-reporting";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useSyncExternalStore(
    subscribeToStaticNavigatorLocale,
    readNavigatorLocale,
    readDefaultLocale,
  );
  useEffect(() => {
    reportClientException({ type: "REACT_BOUNDARY", error, digest: error.digest });
  }, [error]);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        style={{
          alignItems: "center",
          background: "#fafaf9",
          color: "#0c0a09",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          justifyContent: "center",
          margin: 0,
          minHeight: "100vh",
          padding: "1rem",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "1.5rem", margin: 0 }}>
            {getAppMessage(locale, "error.title")}
          </h1>
          <p style={{ color: "#57534e", lineHeight: 1.6, margin: "0.75rem 0 0" }}>
            {getAppMessage(locale, "error.description")}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#0f766e",
              border: 0,
              borderRadius: "0.375rem",
              color: "white",
              cursor: "pointer",
              font: "inherit",
              fontWeight: 600,
              marginTop: "1.5rem",
              minHeight: "2.75rem",
              padding: "0.5rem 1.25rem",
            }}
          >
            {getAppMessage(locale, "error.retry")}
          </button>
        </main>
      </body>
    </html>
  );
}

function subscribeToStaticNavigatorLocale() {
  return () => undefined;
}

function readNavigatorLocale() {
  const languages = navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];
  return resolveNavigatorLocale(languages);
}

function readDefaultLocale(): AppLocale {
  return DEFAULT_APP_LOCALE;
}
