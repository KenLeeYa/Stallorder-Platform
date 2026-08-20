"use client";

import Link from "next/link";
import { ChefHat, ListTree, Settings2 } from "lucide-react";
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
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto max-w-[1600px] px-4 py-3 sm:py-4 md:px-6">
        <div className="flex items-start justify-between gap-2 sm:items-center sm:gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ChefHat className="h-7 w-7 shrink-0 text-teal-700" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">{t("kitchen.systemTitle")}</h1>
              <p className="truncate text-sm text-stone-600">{stall.name}</p>
            </div>
          </div>
          <div className="flex max-w-[58%] shrink-0 flex-col items-end gap-2 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-end">
            <WorkModeSwitcher
              destinations={workModeDestinations}
              currentMode="KITCHEN"
              organizationId={stall.organizationId}
              stallId={stall.id}
              compactOnMobile
              className="w-[min(52vw,220px)] shrink-0"
            />
            {availableStalls.length > 1 ? (
              <form method="get" className="flex items-end gap-2">
                <label className="block min-w-0 text-xs font-medium text-stone-500" htmlFor="kitchen-stall">
                  {t("kitchen.stall")}
                  <select id="kitchen-stall" name="stall" defaultValue={stall.slug} className="mt-1 block h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900">
                    {availableStalls.map((candidate) => <option key={candidate.slug} value={candidate.slug}>{candidate.name}</option>)}
                  </select>
                </label>
                <button type="submit" className="h-10 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white">{t("kitchen.switch")}</button>
              </form>
            ) : null}
          </div>
        </div>
        <nav data-testid="kitchen-primary-navigation" className="mt-3 grid w-full grid-flow-col auto-cols-fr gap-1 sm:mt-4 sm:flex sm:w-auto sm:overflow-x-auto" aria-label={t("kitchen.navigation")}>
          {links.map(({ key, href, label, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              title={label}
              aria-label={label}
              className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-2 border-b-2 px-2 text-sm font-semibold sm:shrink-0 sm:justify-start sm:px-3 ${active === key ? "border-teal-700 text-teal-800" : "border-transparent text-stone-600 hover:text-stone-950"}`}
            >
              <Icon className="h-5 w-5 sm:h-4 sm:w-4" />
              <span className="sr-only sm:not-sr-only">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
