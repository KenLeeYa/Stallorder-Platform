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
  return (
    <header data-testid="storefront-mode-nav" className="border-b border-stone-200 bg-white print:hidden">
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
