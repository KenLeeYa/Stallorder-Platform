import "server-only";

import { logEvent } from "@/lib/audit";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

const mobileFlagCodes = [
  "MOBILE_APP_ENABLED",
  "MOBILE_PLATFORM_ADMIN_ENABLED",
  "MOBILE_PUSH_ENABLED",
  "MOBILE_OFFLINE_POS_ENABLED",
  "MOBILE_DIRECT_PRINT_ENABLED",
] as const;

export function isLocalMobilePilot(profileId?: string) {
 const ids = (process.env.MOBILE_LOCAL_TEST_PROFILE_IDS ?? "").split(",").filter(Boolean);
 if (!ids.length || ids.length > 8 || !ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) return false;
 if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.CI || process.env.APP_URL !== "http://127.0.0.1:3026") return false;
 for (const key of ["DATABASE_URL", "DIRECT_URL", "DR_DATABASE_URL", "DR_DIRECT_URL"]) {
  const value = process.env[key]; if (!value) { if (key === "DATABASE_URL" || key === "DIRECT_URL") return false; continue; }
  try { const url = new URL(value); if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "56822" || url.pathname !== "/postgres") return false; } catch { return false; }
 }
 return profileId === undefined || ids.includes(profileId);
}
export async function resolveMobileFeatureState(profileId?: string) {
  try {
    const flags = await resolveResilienceFeatureFlags(mobileFlagCodes);
    return {
      localPilot: isLocalMobilePilot(),
      mobileApp: flags.MOBILE_APP_ENABLED.enabled || (!!profileId && isLocalMobilePilot(profileId)),
      platformAdmin: flags.MOBILE_PLATFORM_ADMIN_ENABLED.enabled || (!!profileId && isLocalMobilePilot(profileId)),
      push: flags.MOBILE_PUSH_ENABLED.enabled,
      offlinePos: flags.MOBILE_OFFLINE_POS_ENABLED.enabled,
      directPrint: flags.MOBILE_DIRECT_PRINT_ENABLED.enabled,
    };
  } catch {
    logEvent("warn", "MOBILE_FEATURE_FLAG_READ_FAILED", {});
    return {
      localPilot: false,
      mobileApp: false,
      platformAdmin: false,
      push: false,
      offlinePos: false,
      directPrint: false,
    };
  }
}
