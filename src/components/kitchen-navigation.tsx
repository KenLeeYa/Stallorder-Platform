"use client";

import Link from "next/link";
import { ChefHat, ListTree, Settings2 } from "lucide-react";
import { LocaleSelector } from "@/components/locale-selector";
import { LogoutButton } from "@/components/logout-button";
import { useOperationsLocale } from "@/components/operations-locale";
import { PwaControls } from "@/components/pwa-controls";
import { WorkModeSwitcher } from "@/components/work-mode-switcher";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import type { WorkModeDestination } from "@/lib/work-mode";
import { getOperationalSwitcherVisibility } from "@/lib/work-mode";

type Props = {
  active: "BOARD" | "STATIONS" | "SETTINGS";
  stall: { id: string; organizationId: string; slug: string; name: string };
  availableStalls: Array<{ slug: string; name: string }>;
  canManage: boolean;
  workModeDestinations: WorkModeDestination[];
};

export function KitchenNavigation({ active, stall, availableStalls, canManage, workModeDestinations }: Props) {
  const { t } = useOperationsLocale();
  const switcherVisibility = getOperationalSwitcherVisibility(
    workModeDestinations,
    "KITCHEN",
    stall.organizationId,
  );
  const stallDestinations = availableStalls.map((candidate) => ({
    value: candidate.slug,
    label: candidate.name,
    href: `/kitchen?stall=${encodeURIComponent(candidate.slug)}`,
  }));
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
    <header className="sticky top-0 z-50 h-16 overflow-x-clip border-b border-stone-200 bg-white/95 shadow-sm backdrop-blur print:static print:h-auto">
      <div className="mx-auto max-w-[1600px] px-3 py-2 md:px-6">
        <h1 className="sr-only">{t("kitchen.systemTitle")}</h1>
        <div data-testid="kitchen-toolbar-row" className="flex h-11 w-full min-w-0 items-center gap-1">
          <nav data-testid="kitchen-primary-navigation" className="flex h-11 min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain pr-1 [&>*]:shrink-0" aria-label={t("kitchen.navigation")}>
            {links.filter(({ key }) => key !== "SETTINGS").map(({ key, href, label, icon: Icon }) => (
              <Link
                key={key}
                data-testid={`kitchen-nav-${key.toLowerCase()}`}
                href={href}
                title={label}
                className={`grid h-11 w-11 place-items-center rounded-md border text-sm font-semibold ${active === key ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600 hover:text-stone-950"}`}
              >
                <Icon className="h-5 w-5" />
                <span className="sr-only">{label}</span>
              </Link>
            ))}
            <div data-testid="kitchen-language-control" className="[&>label]:!h-11 [&>label]:!min-h-11 [&>label]:!w-11 [&_svg]:!h-5 [&_svg]:!w-5">
              <LocaleSelector compact />
            </div>
            {links.filter(({ key }) => key === "SETTINGS").map(({ key, href, label, icon: Icon }) => (
              <Link
                key={key}
                data-testid={`kitchen-nav-${key.toLowerCase()}`}
                href={href}
                title={label}
                className={`grid h-11 w-11 place-items-center rounded-md border text-sm font-semibold ${active === key ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600 hover:text-stone-950"}`}
              >
                <Icon className="h-5 w-5" />
                <span className="sr-only">{label}</span>
              </Link>
            ))}
            <div data-testid="kitchen-utility-toolbar" className="flex shrink-0 flex-nowrap items-center gap-1 [&>*]:shrink-0 [&_button]:!h-11 [&_button]:!w-11 [&_label]:!h-11 [&_label]:!min-h-11 [&_label]:!w-11 [&_span[title]]:!h-11 [&_span[title]]:!w-11 [&_span[title]]:!justify-center [&_span[title]]:rounded-md [&_span[title]]:border [&_span[title]]:border-stone-300 [&_span[title]]:!px-0 [&_svg]:!h-5 [&_svg]:!w-5">
              {switcherVisibility.showWorkMode ? <WorkModeSwitcher
                destinations={workModeDestinations}
                currentMode="KITCHEN"
                organizationId={stall.organizationId}
                stallId={stall.id}
              /> : null}
              {switcherVisibility.showStall ? <WorkspaceSwitcher
                kind="STALL"
                destinations={stallDestinations}
                currentValue={stall.slug}
                organizationId={stall.organizationId}
                label={t("workMode.stallLabel")}
              /> : null}
              <PwaControls showWakeLock showLocale={false} showQualityLabel={false} />
            </div>
          </nav>
          <div data-testid="kitchen-pinned-logout" className="ml-1 flex h-11 w-12 shrink-0 items-center justify-end border-l border-stone-200 pl-1 [&_button]:!h-11 [&_button]:!w-11 [&_svg]:!h-5 [&_svg]:!w-5">
            <LogoutButton offlineStallId={stall.id} />
          </div>
        </div>
      </div>
    </header>
  );
}
