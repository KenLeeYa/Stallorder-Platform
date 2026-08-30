"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { AppLocale } from "@/lib/app-locale";
import { publicMessages } from "@/lib/messages/public";
import {
  buildPublicStorefrontPath,
  type PublicStorefrontSearchParams,
  type PublicStorefrontView,
} from "@/lib/public-storefront";

type ModeAvailability = Record<PublicStorefrontView, {
  enabled: boolean;
  reason: string;
}>;

const modes: PublicStorefrontView[] = ["menu", "pickup", "delivery"];

export function StorefrontModeNav({
  identifier,
  currentView,
  availability,
  searchParams,
  locale,
}: {
  identifier: string;
  currentView: PublicStorefrontView;
  availability: ModeAvailability;
  searchParams: PublicStorefrontSearchParams;
  locale: AppLocale;
}) {
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const root = document.documentElement;
    const updateOffset = () => {
      root.style.setProperty("--storefront-mode-nav-height", `${header.offsetHeight}px`);
    };
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(header);
    window.addEventListener("resize", updateOffset);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffset);
      root.style.removeProperty("--storefront-mode-nav-height");
    };
  }, []);

  return (
    <header ref={headerRef} data-testid="storefront-mode-nav" className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 shadow-sm backdrop-blur print:static print:hidden">
      <div className="mx-auto max-w-5xl px-4 py-4 md:px-8">
        <nav aria-label={publicMessages.get(locale, "storefrontModeNav")} className="grid grid-cols-3 gap-2">
          {modes.map((view) => {
            const mode = availability[view];
            const label = publicMessages.get(
              locale,
              view === "menu"
                ? "storefrontMenu"
                : view === "pickup"
                  ? "storefrontPickup"
                  : "storefrontDelivery",
            );
            const classes = `flex min-h-12 flex-col items-center justify-center rounded-md border px-2 py-2 text-center text-sm font-semibold ${
              currentView === view
                ? "border-teal-800 bg-teal-800 text-white"
                : "border-stone-300 bg-white text-stone-800"
            }`;
            return mode.enabled ? (
              <Link
                key={view}
                href={buildPublicStorefrontPath(identifier, view, searchParams)}
                aria-current={currentView === view ? "page" : undefined}
                className={classes}
              >
                {label}
              </Link>
            ) : (
              <span key={view} aria-disabled="true" title={mode.reason} className={`${classes} cursor-not-allowed opacity-55`}>
                <span>{label}</span>
                <span className="mt-0.5 text-[11px] font-medium">
                  {publicMessages.get(locale, "storefrontUnavailableShort")}
                </span>
              </span>
            );
          })}
        </nav>
        <p className="mt-3 text-center text-xs leading-5 text-stone-600">
          {publicMessages.get(locale, "storefrontTableQrInstruction")}
        </p>
      </div>
    </header>
  );
}
