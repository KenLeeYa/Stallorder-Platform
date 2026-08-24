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
  "FOODPANDA_ORDERS_ENABLED",
  "FOODPANDA_CATALOG_READ_ENABLED",
  "FOODPANDA_CATALOG_WRITE_ENABLED",
  "FOODPANDA_OUTLET_ENABLED",
  "FOODPANDA_PRODUCT_CREATE_BETA_ENABLED",
  "UBER_EATS_ORDERS_ENABLED",
  "UBER_EATS_MENU_READ_ENABLED",
  "UBER_EATS_MENU_FULL_WRITE_ENABLED",
  "UBER_EATS_MENU_ITEM_WRITE_ENABLED",
  "UBER_EATS_STORE_READ_ENABLED",
  "UBER_EATS_STORE_STATUS_WRITE_ENABLED",
  "UBER_EATS_HOLIDAY_HOURS_WRITE_ENABLED",
  "UBER_EATS_STORE_ACTIVATION_ENABLED",
  "UBER_EATS_REPORTS_READ_ENABLED",
  "UBER_EATS_ORDER_READY_ENABLED",
  "UBER_EATS_ORDER_READY_TIME_ENABLED",
  "UBER_EATS_FULFILLMENT_ISSUES_ENABLED",
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
    const mockEnabled = provider === "MOCK"
      && flags.DELIVERY_MOCK_PROVIDER_ENABLED.enabled
      && !isProductionDeliveryRuntime();
    const orders = provider === "UBER_EATS"
      ? flags.UBER_EATS_ORDERS_ENABLED.enabled
      : provider === "FOODPANDA"
        ? flags.FOODPANDA_ORDERS_ENABLED.enabled
        : mockEnabled;
    return {
      foundation: flags.DELIVERY_PLATFORM_FOUNDATION_ENABLED.enabled,
      ui: flags.DELIVERY_PLATFORM_UI_ENABLED.enabled,
      importOrders: flags.DELIVERY_EXTERNAL_ORDER_IMPORT_ENABLED.enabled,
      providerActions: flags.DELIVERY_PROVIDER_ACTIONS_ENABLED.enabled,
      menuSync: flags.DELIVERY_MENU_SYNC_ENABLED.enabled,
      providerEnabled,
      orders,
      oauth: provider === "UBER_EATS" && flags.UBER_EATS_OAUTH_ENABLED.enabled,
      api: provider === "UBER_EATS"
        ? flags.UBER_EATS_API_ENABLED.enabled
        : provider === "FOODPANDA"
          ? flags.FOODPANDA_PARTNER_API_ENABLED.enabled
          : flags.DELIVERY_MOCK_PROVIDER_ENABLED.enabled
            && !isProductionDeliveryRuntime(),
      webhook: provider === "FOODPANDA"
        ? flags.FOODPANDA_WEBHOOK_ENABLED.enabled && orders
        : provider === "MOCK"
          ? mockEnabled
          : flags.UBER_EATS_API_ENABLED.enabled && orders,
      catalogRead: provider === "FOODPANDA"
        ? flags.FOODPANDA_CATALOG_READ_ENABLED.enabled
        : provider === "UBER_EATS"
          ? flags.UBER_EATS_MENU_READ_ENABLED.enabled
          : mockEnabled,
      catalogWrite: provider === "FOODPANDA"
        ? flags.FOODPANDA_CATALOG_WRITE_ENABLED.enabled
        : provider === "UBER_EATS"
          ? flags.UBER_EATS_MENU_FULL_WRITE_ENABLED.enabled
          : mockEnabled,
      itemWrite: provider === "FOODPANDA"
        ? flags.FOODPANDA_CATALOG_WRITE_ENABLED.enabled
        : provider === "UBER_EATS"
          ? flags.UBER_EATS_MENU_ITEM_WRITE_ENABLED.enabled
          : mockEnabled,
      outlet: provider === "FOODPANDA"
        ? flags.FOODPANDA_OUTLET_ENABLED.enabled
        : provider === "UBER_EATS"
          ? flags.UBER_EATS_STORE_STATUS_WRITE_ENABLED.enabled
          : mockEnabled,
      storeRead: provider === "UBER_EATS"
        ? flags.UBER_EATS_STORE_READ_ENABLED.enabled
        : provider === "FOODPANDA"
          ? flags.FOODPANDA_PARTNER_API_ENABLED.enabled
          : mockEnabled,
      storeActivation: provider === "UBER_EATS"
        && flags.UBER_EATS_STORE_ACTIVATION_ENABLED.enabled,
      holidayHours: provider === "UBER_EATS"
        && flags.UBER_EATS_HOLIDAY_HOURS_WRITE_ENABLED.enabled,
      reports: provider === "UBER_EATS"
        && flags.UBER_EATS_REPORTS_READ_ENABLED.enabled,
      orderReady: provider === "FOODPANDA"
        ? orders
        : provider === "UBER_EATS"
          && flags.UBER_EATS_ORDER_READY_ENABLED.enabled,
      orderReadyTime: provider === "UBER_EATS"
        && flags.UBER_EATS_ORDER_READY_TIME_ENABLED.enabled,
      fulfillmentIssues: provider === "UBER_EATS"
        && flags.UBER_EATS_FULFILLMENT_ISSUES_ENABLED.enabled,
      productCreateBeta: provider === "FOODPANDA"
        && flags.FOODPANDA_PRODUCT_CREATE_BETA_ENABLED.enabled,
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
      orders: false,
      oauth: false,
      api: false,
      webhook: false,
      catalogRead: false,
      catalogWrite: false,
      itemWrite: false,
      outlet: false,
      storeRead: false,
      storeActivation: false,
      holidayHours: false,
      reports: false,
      orderReady: false,
      orderReadyTime: false,
      fulfillmentIssues: false,
      productCreateBeta: false,
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
