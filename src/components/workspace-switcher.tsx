"use client";

import { Building2, Store } from "lucide-react";
import { CompactSwitcherDialog } from "@/components/compact-switcher-dialog";

const ORGANIZATION_STORAGE_KEY = "stallorder.organization.preference";

export type WorkspaceSwitcherDestination = {
  value: string;
  label: string;
  href: string;
};

export function WorkspaceSwitcher({
  kind,
  destinations,
  currentValue,
  organizationId,
  label,
}: {
  kind: "ORGANIZATION" | "STALL";
  destinations: readonly WorkspaceSwitcherDestination[];
  currentValue: string;
  organizationId?: string;
  label: string;
}) {
  const Icon = kind === "ORGANIZATION" ? Building2 : Store;
  const currentLabel = destinations.find((destination) => destination.value === currentValue)?.label;

  return (
    <CompactSwitcherDialog
      destinations={destinations}
      currentValue={currentValue}
      buttonLabel={currentLabel ? `${label}：${currentLabel}` : label}
      dialogTitle={label}
      icon={<Icon className="h-5 w-5" />}
      onSelect={(value) => {
        const destination = destinations.find((candidate) => candidate.value === value);
        if (!destination) return;
        const nextOrganizationId = kind === "ORGANIZATION" ? destination.value : organizationId;
        if (nextOrganizationId) {
          window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, nextOrganizationId);
        }
        window.location.assign(destination.href);
      }}
    />
  );
}
