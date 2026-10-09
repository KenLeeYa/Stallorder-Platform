import "server-only";

import { logEvent } from "@/lib/audit";
import { resolveResilienceFeatureFlags } from "./feature-flag-service";

/** Optional presentation configuration must never prevent staff from taking orders. */
export async function getStaffWorkspaceRedesignEnabled(organizationId: string, stallId: string) {
  try {
    const flags = await resolveResilienceFeatureFlags(["STAFF_WORKSPACE_REDESIGN_ENABLED"], { organizationId, stallId });
    return flags.STAFF_WORKSPACE_REDESIGN_ENABLED.enabled;
  } catch {
    logEvent("warn", "STAFF_WORKSPACE_FLAG_FALLBACK", { fallback: "legacy" });
    return false;
  }
}
