"use client";

import { BriefcaseBusiness } from "lucide-react";
import { useRouter } from "next/navigation";
import type { WorkMode, WorkModeDestination } from "@/lib/work-mode";
import { currentWorkModeValue } from "@/lib/work-mode";

const ORGANIZATION_STORAGE_KEY = "stallorder.organization.preference";

export function WorkModeSwitcher({
  destinations,
  currentMode,
  organizationId,
  stallId,
  className = "",
}: {
  destinations: readonly WorkModeDestination[];
  currentMode: WorkMode;
  organizationId: string;
  stallId?: string;
  className?: string;
}) {
  const router = useRouter();
  if (destinations.length < 2) return null;

  const selectedValue = currentWorkModeValue(currentMode, organizationId, stallId);

  function switchMode(value: string) {
    const destination = destinations.find((candidate) => candidate.value === value);
    if (!destination) return;
    window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, destination.organizationId);
    router.push(destination.href);
  }

  return (
    <label className={`block min-w-0 text-xs font-medium text-stone-500 ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <BriefcaseBusiness className="h-3.5 w-3.5 text-teal-700" />
        工作模式
      </span>
      <select
        aria-label="切換工作模式"
        value={selectedValue}
        onChange={(event) => switchMode(event.target.value)}
        className="mt-1 block h-10 w-full min-w-0 rounded-md border border-stone-300 bg-white px-2 text-sm font-semibold text-stone-900 md:max-w-[220px]"
      >
        {destinations.map((destination) => (
          <option key={destination.value} value={destination.value}>{destination.label}</option>
        ))}
      </select>
    </label>
  );
}
