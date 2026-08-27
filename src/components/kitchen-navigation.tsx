"use client";

import Link from "next/link";
import {
  ChefHat,
  ListChecks,
  RadioTower,
  RefreshCw,
  Rows3,
  Settings2,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react";
import { LocaleSelector } from "@/components/locale-selector";
import { LogoutButton } from "@/components/logout-button";
import { useOperationsLocale } from "@/components/operations-locale";
import { PwaControls } from "@/components/pwa-controls";
import { WorkModeSwitcher } from "@/components/work-mode-switcher";
import type { KitchenBoardMode } from "@/lib/kitchen-board-contract";
import type { WorkModeDestination } from "@/lib/work-mode";
import { getOperationalSwitcherVisibility } from "@/lib/work-mode";

type BoardControls = {
  mode: KitchenBoardMode;
  onModeChange: (mode: KitchenBoardMode) => void;
  connection: "CONNECTING" | "CONNECTED" | "FALLBACK";
  alertsEnabled: boolean;
  onToggleAlerts: () => void;
  refreshing: boolean;
  disabled: boolean;
  onRefresh: () => void;
};

type Props = {
  active: "BOARD" | "STATIONS" | "SETTINGS";
  stall: { id: string; organizationId: string; slug: string; name: string };
  canManage: boolean;
  workModeDestinations: WorkModeDestination[];
  boardControls?: BoardControls;
};

export function KitchenNavigation({ active, stall, canManage, workModeDestinations, boardControls }: Props) {
  const { t } = useOperationsLocale();
  const switcherVisibility = getOperationalSwitcherVisibility(
    workModeDestinations,
    "KITCHEN",
    stall.organizationId,
  );
  const modes = [
    { key: "ORDER" as const, label: t("kitchen.mode.ordersShort"), icon: Rows3 },
    { key: "ITEM" as const, label: t("kitchen.mode.itemsShort"), icon: ListChecks },
    { key: "STATION" as const, label: t("kitchen.mode.stationsShort"), icon: ChefHat },
  ];
  const connectionLabel = boardControls?.connection === "CONNECTED"
    ? t("kitchen.connection.connected")
    : boardControls?.connection === "CONNECTING"
      ? t("kitchen.connection.connecting")
      : t("kitchen.connection.polling");
  return (
    <header className="sticky top-0 z-50 h-16 overflow-x-clip border-b border-stone-200 bg-white/95 shadow-sm backdrop-blur print:static print:h-auto">
      <div className="mx-auto max-w-[1600px] px-3 py-2 md:px-6">
        <h1 className="sr-only">{t("kitchen.systemTitle")}</h1>
        <div data-testid="kitchen-toolbar-row" className="flex h-11 w-full min-w-0 items-center gap-1">
          <nav data-testid="kitchen-primary-navigation" className="flex h-11 min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain pr-1 [&>*]:shrink-0" aria-label={t("kitchen.navigation")}>
            <div data-testid="kitchen-mode-selector" className="inline-grid h-11 grid-cols-3 overflow-hidden rounded-md border border-stone-300 bg-white" role="group" aria-label={t("kitchen.mode.label")}>
              {modes.map(({ key, label, icon: Icon }) => boardControls ? (
                <button
                  key={key}
                  type="button"
                  data-testid={`kitchen-mode-${key.toLowerCase()}`}
                  title={label}
                  aria-label={label}
                  aria-pressed={boardControls.mode === key}
                  onClick={() => boardControls.onModeChange(key)}
                  className={`grid h-11 w-11 place-items-center border-r border-stone-300 text-sm font-semibold last:border-r-0 ${boardControls.mode === key ? "bg-teal-50 text-teal-800" : "bg-white text-stone-600"}`}
                >
                  <Icon className="h-5 w-5" /><span className="sr-only">{label}</span>
                </button>
              ) : (
                <Link
                  key={key}
                  data-testid={`kitchen-mode-${key.toLowerCase()}`}
                  href={`/kitchen?stall=${encodeURIComponent(stall.slug)}&view=${key}`}
                  title={label}
                  aria-label={label}
                  className="grid h-11 w-11 place-items-center border-r border-stone-300 text-sm font-semibold text-stone-600 last:border-r-0 hover:bg-stone-50 hover:text-stone-950"
                >
                  <Icon className="h-5 w-5" /><span className="sr-only">{label}</span>
                </Link>
              ))}
            </div>
            {switcherVisibility.showWorkMode ? <div data-testid="kitchen-work-mode-control" className="shrink-0">
              <WorkModeSwitcher
                destinations={workModeDestinations}
                currentMode="KITCHEN"
                organizationId={stall.organizationId}
                stallId={stall.id}
              />
            </div> : null}
            <div data-testid="kitchen-language-control" className="[&>label]:!h-11 [&>label]:!min-h-11 [&>label]:!w-11 [&_svg]:!h-5 [&_svg]:!w-5">
              <LocaleSelector compact />
            </div>
            <div data-testid="kitchen-pwa-controls" className="[&>div]:gap-1 [&_button]:!h-11 [&_button]:!w-11 [&_span[title]]:!h-11 [&_span[title]]:!w-11 [&_span[title]]:!justify-center [&_span[title]]:rounded-md [&_span[title]]:border [&_span[title]]:border-stone-300 [&_span[title]]:!px-0 [&_svg]:!h-5 [&_svg]:!w-5">
              <PwaControls showWakeLock showLocale={false} showQualityLabel={false} showInstall={false} />
            </div>
            {boardControls ? <span
              data-testid="kitchen-live-status"
              role="status"
              aria-label={`SSE · ${connectionLabel}`}
              title={boardControls.connection === "CONNECTED" ? `SSE · ${t("kitchen.connection.connectedTitle")}` : `SSE · ${t("kitchen.connection.fallbackTitle")}`}
              className={`grid h-11 w-11 place-items-center rounded-md border text-sm font-medium ${boardControls.connection === "CONNECTED" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}`}
            >
              <RadioTower className="h-5 w-5" />
              <span className="sr-only">{connectionLabel}</span>
            </span> : null}
            {canManage ? <>
              <Link
                data-testid="kitchen-nav-stations"
                href={`/merchant/stalls/${stall.id}/kitchen/stations?source=kitchen`}
                title={t("kitchen.nav.stations")}
                className={`grid h-11 w-11 place-items-center rounded-md border text-sm font-semibold ${active === "STATIONS" ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600 hover:text-stone-950"}`}
              >
                <SlidersHorizontal className="h-5 w-5" />
                <span className="sr-only">{t("kitchen.nav.stations")}</span>
              </Link>
              <Link
                data-testid="kitchen-nav-settings"
                href={`/merchant/stalls/${stall.id}/kitchen/settings?source=kitchen`}
                title={t("kitchen.nav.settings")}
                className={`grid h-11 w-11 place-items-center rounded-md border text-sm font-semibold ${active === "SETTINGS" ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600 hover:text-stone-950"}`}
              >
                <Settings2 className="h-5 w-5" />
                <span className="sr-only">{t("kitchen.nav.settings")}</span>
              </Link>
            </> : null}
            {boardControls ? <>
              <button data-testid="kitchen-alert-control" type="button" role="switch" aria-checked={boardControls.alertsEnabled} onClick={boardControls.onToggleAlerts} title={boardControls.alertsEnabled ? t("kitchen.alert.disable") : t("kitchen.alert.enable")} className={`grid h-11 w-11 place-items-center rounded-md border ${boardControls.alertsEnabled ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600"}`}>
                {boardControls.alertsEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                <span className="sr-only">{boardControls.alertsEnabled ? t("kitchen.alert.enabledSr") : t("kitchen.alert.disabledSr")}</span>
              </button>
              <button data-testid="kitchen-refresh-control" type="button" title={t("common.refresh")} disabled={boardControls.disabled} onClick={boardControls.onRefresh} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-50">
                <RefreshCw className={`h-5 w-5 ${boardControls.refreshing ? "animate-spin" : ""}`} />
                <span className="sr-only">{t("common.refresh")}</span>
              </button>
            </> : null}
          </nav>
          <div data-testid="kitchen-pinned-logout" className="ml-1 flex h-11 w-12 shrink-0 items-center justify-end border-l border-stone-200 pl-1 [&_button]:!h-11 [&_button]:!w-11 [&_svg]:!h-5 [&_svg]:!w-5">
            <LogoutButton offlineStallId={stall.id} />
          </div>
        </div>
      </div>
    </header>
  );
}
