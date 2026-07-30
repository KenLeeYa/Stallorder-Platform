import "server-only";

import { logEvent } from "@/lib/audit";
import {
  resolveResilienceFeatureFlags,
  type ResilienceFlagEvaluationContext,
} from "@/server/resilience/feature-flag-service";
import { isProductionDeliveryRuntime } from "./delivery-environment";
import { DeliveryPlatformError } from "./delivery-platform-errors";
import type { DeliveryProvider } from "./delivery-platform-types";

const deliveryFlagCodes = [
  "DELIVERY_PLATFORM_FOUNDATION_ENABLED",
  "DELIVERY_PLATFORM_UI_ENABLED",
  "DELIVERY_EXTERNAL_ORDER_IMPORT_ENABLED",
  "DELIVERY_PROVIDER_ACTIONS_ENABLED",
  "DELIVERY_MENU_SYNC_ENABLED",
  "DELIVERY_MOCK_PROVIDER_ENABLED",
  "UBER_EATS_INTEGRATION_ENABLED",
  "UBER_EATS_OAUTH_ENABLED",
  "UBER_EATS_API_ENABLED",
  "FOODPANDA_INTEGRATION_ENABLED",
  "FOODPANDA_PARTNER_API_ENABLED",
  "FOODPANDA_WEBHOOK_ENABLED",
] as const;

export async function resolveDeliveryFeatureState(
  provider: DeliveryProvider,
  context: ResilienceFlagEvaluationContext = {},
) {
  try {
    const flags = await resolveResilienceFeatureFlags(deliveryFlagCodes, context);
    const providerEnabled = provider === "UBER_EATS"
      ? flags.UBER_EATS_INTEGRATION_ENABLED.enabled
      : provider === "FOODPANDA"
        ? flags.FOODPANDA_INTEGRATION_ENABLED.enabled
        : flags.DELIVERY_MOCK_PROVIDER_ENABLED.enabled
          && !isProductionDeliveryRuntime();
    return {
      foundation: flags.DELIVERY_PLATFORM_FOUNDATION_ENABLED.enabled,
      ui: flags.DELIVERY_PLATFORM_UI_ENABLED.enabled,
      importOrders: flags.DELIVERY_EXTERNAL_ORDER_IMPORT_ENABLED.enabled,
      providerActions: flags.DELIVERY_PROVIDER_ACTIONS_ENABLED.enabled,
      menuSync: flags.DELIVERY_MENU_SYNC_ENABLED.enabled,
      providerEnabled,
      oauth: provider === "UBER_EATS" && flags.UBER_EATS_OAUTH_ENABLED.enabled,
      api: provider === "UBER_EATS"
        ? flags.UBER_EATS_API_ENABLED.enabled
        : provider === "FOODPANDA"
          ? flags.FOODPANDA_PARTNER_API_ENABLED.enabled
          : flags.DELIVERY_MOCK_PROVIDER_ENABLED.enabled
            && !isProductionDeliveryRuntime(),
      webhook: provider === "FOODPANDA"
        ? flags.FOODPANDA_WEBHOOK_ENABLED.enabled
        : provider === "MOCK"
          ? flags.DELIVERY_MOCK_PROVIDER_ENABLED.enabled
            && !isProductionDeliveryRuntime()
          : flags.UBER_EATS_API_ENABLED.enabled,
    };
  } catch {
    logEvent("warn", "DELIVERY_FEATURE_FLAG_READ_FAILED", { provider });
    return {
      foundation: false,
      ui: false,
      importOrders: false,
      providerActions: false,
      menuSync: false,
      providerEnabled: false,
      oauth: false,
      api: false,
      webhook: false,
    };
  }
}

export async function assertDeliveryProviderEnabled(
  provider: DeliveryProvider,
  context: ResilienceFlagEvaluationContext = {},
) {
  const state = await resolveDeliveryFeatureState(provider, context);
  if (!state.foundation || !state.providerEnabled) {
    throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
  }
  return state;
}
