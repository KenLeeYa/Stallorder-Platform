import type { DeliveryPlatformAdapter } from "./delivery-platform-adapter";
import { isProductionDeliveryRuntime } from "./delivery-environment";
import { DeliveryPlatformError } from "./delivery-platform-errors";
import type { DeliveryProvider } from "./delivery-platform-types";
import { FoodpandaAdapter } from "./providers/foodpanda/foodpanda-adapter";
import { MockDeliveryPlatformAdapter } from "./providers/mock/mock-delivery-platform-adapter";
import { UberEatsAdapter } from "./providers/uber-eats/uber-eats-adapter";

export function getDeliveryPlatformAdapter(
  provider: DeliveryProvider,
  environment: NodeJS.ProcessEnv = process.env,
): DeliveryPlatformAdapter {
  if (provider === "MOCK") {
    if (isProductionDeliveryRuntime(environment)) {
      throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
    }
    return new MockDeliveryPlatformAdapter(
      environment.DELIVERY_MOCK_WEBHOOK_SECRET?.trim() ?? "",
      environment,
    );
  }
  if (provider === "UBER_EATS") return new UberEatsAdapter();
  if (provider === "FOODPANDA") return new FoodpandaAdapter();
  throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
}
