import Link from "next/link";
import {
  buildPublicStorefrontPath,
  type PublicStorefrontSearchParams,
  type PublicStorefrontView,
} from "@/lib/public-storefront";

type ModeAvailability = Record<PublicStorefrontView, {
  enabled: boolean;
  reason: string;
}>;

const modes: Array<{ view: PublicStorefrontView; label: string }> = [
  { view: "menu", label: "線上 Menu" },
  { view: "pickup", label: "外帶自取" },
  { view: "delivery", label: "外送" },
];

export function StorefrontModeNav({
  identifier,
  currentView,
  availability,
  searchParams,
}: {
  identifier: string;
  currentView: PublicStorefrontView;
  availability: ModeAvailability;
  searchParams: PublicStorefrontSearchParams;
}) {
  return (
    <header data-testid="storefront-mode-nav" className="border-b border-stone-200 bg-white print:hidden">
      <div className="mx-auto max-w-5xl px-4 py-4 md:px-8">
        <nav aria-label="公開點餐服務" className="grid grid-cols-3 gap-2">
          {modes.map(({ view, label }) => {
            const mode = availability[view];
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
                <span className="mt-0.5 text-[11px] font-medium">目前未開放</span>
              </span>
            );
          })}
        </nav>
        <p className="mt-3 text-center text-xs leading-5 text-stone-600">
          內用請掃描桌上的 QR Code；此公開連結不含桌號，無法代替桌上 QR Code。
        </p>
      </div>
    </header>
  );
}
