"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type Props = {
  resetKey: number;
  locale?: string;
  label: string;
  missingKeyMessage: string;
  onToken: (token: string | null) => void;
};

export function TurnstileWidget({ resetKey, locale = "auto", label, missingKeyMessage, onToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    const container = containerRef.current;
    if (!scriptReady || !container || !siteKey || !window.turnstile) return;

    if (widgetIdRef.current) window.turnstile.remove(widgetIdRef.current);
    container.replaceChildren();
    widgetIdRef.current = window.turnstile.render(container, {
      sitekey: siteKey,
      action: "public_order",
      language: locale === "zh-TW" ? "zh-tw" : locale,
      theme: "light",
      size: "flexible",
      callback: (token: string) => onToken(token),
      "expired-callback": () => onToken(null),
      "timeout-callback": () => onToken(null),
      "error-callback": () => onToken(null),
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [locale, onToken, resetKey, scriptReady, siteKey]);

  if (!siteKey) {
    return <p role="alert" className="text-sm text-red-700">{missingKeyMessage}</p>;
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <div ref={containerRef} className="min-h-16 w-full" aria-label={label} />
    </>
  );
}
