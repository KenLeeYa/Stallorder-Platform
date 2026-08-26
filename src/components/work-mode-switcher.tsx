"use client";

import { BriefcaseBusiness, UserRound, type LucideProps } from "lucide-react";
import { CompactSwitcherDialog } from "@/components/compact-switcher-dialog";
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
  className = "",
}: {
  destinations: readonly WorkModeDestination[];
  currentMode: WorkMode;
  organizationId: string;
  stallId?: string;
  offlineGuardStallId?: string;
  compactOnMobile?: boolean;
  hideVisualLabel?: boolean;
  className?: string;
}) {
  const { t } = useOperationsLocale();
  const selectedValue = currentWorkModeValue(currentMode, organizationId, stallId);
  const currentDestination = destinations.find((destination) => destination.value === selectedValue);
  const ModeIcon = currentMode === "MERCHANT"
    ? BriefcaseBusiness
    : currentMode === "STAFF"
      ? UserRound
      : BeardedChefIcon;

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
    window.location.assign(destination.href);
  }

  return (
    <CompactSwitcherDialog
      destinations={destinations}
      currentValue={selectedValue}
      buttonLabel={currentDestination?.label ?? t("workMode.switchLabel")}
      dialogTitle={t("workMode.switchLabel")}
      icon={<ModeIcon data-testid={`work-mode-icon-${currentMode.toLowerCase()}`} className="h-5 w-5" />}
      onSelect={switchMode}
      className={className}
    />
  );
}

function BeardedChefIcon({ className, ...props }: LucideProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M7.5 8.5h9" />
      <path d="M8 8.5a3 3 0 0 1 .8-5.9A4.5 4.5 0 0 1 12 1a4.5 4.5 0 0 1 3.2 1.6 3 3 0 0 1 .8 5.9" />
      <path d="M8 9.5v2.3c0 4.4 1.8 7.7 4 9.2 2.2-1.5 4-4.8 4-9.2V9.5" />
      <path d="M9.5 13c1.1 0 1.5-.8 2.5-.8s1.4.8 2.5.8" />
      <path d="M9.5 15.5c.8 1.1 1.6 1.6 2.5 1.6s1.7-.5 2.5-1.6" />
    </svg>
  );
}
