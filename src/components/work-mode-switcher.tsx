"use client";

import { BriefcaseBusiness } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOperationsLocale } from "@/components/operations-locale";
import type { WorkMode, WorkModeDestination } from "@/lib/work-mode";
import { currentWorkModeValue } from "@/lib/work-mode";

const ORGANIZATION_STORAGE_KEY = "stallorder.organization.preference";

export function WorkModeSwitcher({
  destinations,
  currentMode,
  organizationId,
  stallId,
  offlineGuardStallId,
  compactOnMobile = false,
  className = "",
}: {
  destinations: readonly WorkModeDestination[];
  currentMode: WorkMode;
  organizationId: string;
  stallId?: string;
  offlineGuardStallId?: string;
  compactOnMobile?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { t } = useOperationsLocale();
  if (destinations.length < 2) return null;

  const selectedValue = currentWorkModeValue(currentMode, organizationId, stallId);

  async function switchMode(value: string) {
    const destination = destinations.find((candidate) => candidate.value === value);
    if (!destination) return;
    if (offlineGuardStallId && destination.value !== selectedValue) {
      const { getOfflineQueueSummary } = await import("@/offline/offline-operations");
      const summary = await getOfflineQueueSummary(offlineGuardStallId).catch(() => null);
      if ((summary?.pendingCount ?? 0) > 0) {
        window.alert(t("workMode.offlineBlocked", { count: summary?.pendingCount ?? 0 }));
        return;
      }
    }
    window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, destination.organizationId);
    router.push(destination.href);
  }

  return (
    <label className={`block min-w-0 text-xs font-medium text-stone-500 ${className}`}>
      <span className={`${compactOnMobile ? "sr-only sm:not-sr-only sm:inline-flex" : "inline-flex"} items-center gap-1.5`}>
        <BriefcaseBusiness className="h-3.5 w-3.5 text-teal-700" />
        {t("workMode.label")}
      </span>
      <select
        aria-label={t("workMode.switchLabel")}
        title={t("workMode.switchLabel")}
        value={selectedValue}
        onChange={(event) => void switchMode(event.target.value)}
        className={`${compactOnMobile ? "mt-0 h-11 sm:mt-1 sm:h-10" : "mt-1 h-10"} block w-full min-w-0 rounded-md border border-stone-300 bg-white px-2 text-sm font-semibold text-stone-900 md:max-w-[220px]`}
      >
        {destinations.map((destination) => (
          <option key={destination.value} value={destination.value}>{destination.label}</option>
        ))}
      </select>
    </label>
  );
}
