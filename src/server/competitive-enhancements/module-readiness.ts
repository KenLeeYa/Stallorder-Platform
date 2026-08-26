import "server-only";

import {
  competitiveModuleCatalog,
  moduleFlagCode,
} from "@/server/competitive-enhancements/module-catalog";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

export async function getCompetitiveModuleReadiness(organizationId: string) {
  const flagCodes = competitiveModuleCatalog.map((module) => moduleFlagCode(module.code));
  const flags = await resolveResilienceFeatureFlags(flagCodes, { organizationId, rolloutKey: organizationId });
  return competitiveModuleCatalog.map((module) => {
    const enabled = flags[moduleFlagCode(module.code)].enabled;
    return {
      ...module,
      enabled,
      status: module.code === "CORE_OPS"
        ? "CORE_READY"
        : enabled
          ? "LOCAL_VERIFICATION"
          : module.risk === "EXTERNAL"
            ? "EXTERNAL_LOCKED"
            : "DISABLED",
    } as const;
  });
}
