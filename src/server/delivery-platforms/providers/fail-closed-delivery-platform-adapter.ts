import type { DeliveryPlatformAdapter } from "../delivery-platform-adapter";
import { DeliveryPlatformError } from "../delivery-platform-errors";
import type {
  DeliveryPlatformCapability,
  DeliveryProvider,
} from "../delivery-platform-types";

export abstract class FailClosedDeliveryPlatformAdapter implements DeliveryPlatformAdapter {
  abstract readonly provider: DeliveryProvider;
  abstract getConnectionCapabilities(): readonly DeliveryPlatformCapability[];

  protected unavailable(): never {
    throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
  }

  async beginConnection(): Promise<never> { return this.unavailable(); }
  async completeConnection(): Promise<never> { return this.unavailable(); }
  async disconnectConnection(): Promise<never> { return this.unavailable(); }
  async listExternalStores(): Promise<never> { return this.unavailable(); }
  async activateStoreConnection(): Promise<never> { return this.unavailable(); }
  async syncMenu(): Promise<never> { return this.unavailable(); }
  async updateProductAvailability(): Promise<never> { return this.unavailable(); }
  async acceptOrder(): Promise<never> { return this.unavailable(); }
  async rejectOrder(): Promise<never> { return this.unavailable(); }
  async markOrderPreparing(): Promise<never> { return this.unavailable(); }
  async markOrderReady(): Promise<never> { return this.unavailable(); }
  async verifyWebhook(): Promise<never> { return this.unavailable(); }
  async fetchOrderDetails(): Promise<never> { return this.unavailable(); }
  async reconcileOrders(): Promise<never> { return this.unavailable(); }
}
