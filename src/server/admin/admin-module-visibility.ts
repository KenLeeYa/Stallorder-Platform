import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

export type AdminModule = "delivery" | "payments";

export const getAdminModuleVisibility = cache(async () => {
  const flags = await resolveResilienceFeatureFlags([
    "DELIVERY_PLATFORM_UI_ENABLED",
    "PAYMENTS_ADMIN_UI_ENABLED",
  ]);
  return {
    delivery: flags.DELIVERY_PLATFORM_UI_ENABLED.enabled,
    payments: flags.PAYMENTS_ADMIN_UI_ENABLED.enabled,
  } satisfies Record<AdminModule, boolean>;
});

export async function requireAdminModuleVisible(module: AdminModule) {
  const visibility = await getAdminModuleVisibility();
  if (!visibility[module]) notFound();
}
