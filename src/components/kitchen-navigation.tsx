"use client";

import Link from "next/link";
import { ChefHat, ListTree, RefreshCw, Settings2 } from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import { WorkModeSwitcher } from "@/components/work-mode-switcher";
import type { WorkModeDestination } from "@/lib/work-mode";

type Props = {
  active: "BOARD" | "STATIONS" | "SETTINGS";
  stall: { id: string; organizationId: string; slug: string; name: string };
  availableStalls: Array<{ slug: string; name: string }>;
  canManage: boolean;
  workModeDestinations: WorkModeDestination[];
};

export function KitchenNavigation({ active, stall, availableStalls, canManage, workModeDestinations }: Props) {
  const { t } = useOperationsLocale();
  const links = [
    {
      key: "BOARD" as const,
      href: `/kitchen?stall=${encodeURIComponent(stall.slug)}`,
      label: t("kitchen.nav.board"),
      icon: ChefHat,
    },
    ...(canManage ? [
      {
        key: "STATIONS" as const,
        href: `/merchant/stalls/${stall.id}/kitchen/stations?source=kitchen`,
        label: t("kitchen.nav.stations"),
        icon: ListTree,
      },
      {
        key: "SETTINGS" as const,
        href: `/merchant/stalls/${stall.id}/kitchen/settings?source=kitchen`,
        label: t("kitchen.nav.settings"),
        icon: Settings2,
      },
    ] : []),
  ];
  return (
    <header className="sticky top-0 z-50 h-28 border-b border-stone-200 bg-white/95 shadow-sm backdrop-blur print:static print:h-auto">
      <div className="mx-auto max-w-[1600px] px-3 py-2 md:px-6">
        <div className="flex h-11 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <ChefHat className="h-6 w-6 shrink-0 text-teal-700" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold sm:text-base">{t("kitchen.systemTitle")}</h1>
              <p className="truncate text-xs text-stone-600">{stall.name}</p>
            </div>
          </div>
          <div className="flex min-w-0 max-w-[72%] shrink-0 items-center justify-end gap-2 sm:max-w-none">
            <WorkModeSwitcher
              destinations={workModeDestinations}
              currentMode="KITCHEN"
              organizationId={stall.organizationId}
              stallId={stall.id}
              compactOnMobile
              hideVisualLabel
              className="w-[min(44vw,220px)] shrink-0"
            />
            {availableStalls.length > 1 ? (
              <form method="get" className="flex min-w-0 items-center gap-1">
                <label className="sr-only" htmlFor="kitchen-stall">{t("kitchen.stall")}</label>
                  <select id="kitchen-stall" name="stall" defaultValue={stall.slug} className="h-11 min-w-0 max-w-32 rounded-md border border-stone-300 bg-white px-2 text-xs font-semibold text-stone-900">
                    {availableStalls.map((candidate) => <option key={candidate.slug} value={candidate.slug}>{candidate.name}</option>)}
                  </select>
                <button type="submit" title={t("kitchen.switch")} aria-label={t("kitchen.switch")} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 bg-white text-stone-700"><RefreshCw className="h-5 w-5" /></button>
              </form>
            ) : null}
          </div>
        </div>
        <nav data-testid="kitchen-primary-navigation" className="mt-2 flex h-11 w-full items-center gap-2 overflow-x-auto [&>*]:shrink-0" aria-label={t("kitchen.navigation")}>
          {links.map(({ key, href, label, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              title={label}
              className={`grid h-11 w-11 place-items-center rounded-md border text-sm font-semibold ${active === key ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600 hover:text-stone-950"}`}
            >
              <Icon className="h-5 w-5" />
              <span className="sr-only">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
