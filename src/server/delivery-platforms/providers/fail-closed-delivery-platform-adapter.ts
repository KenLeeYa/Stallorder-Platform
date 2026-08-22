import type { DeliveryPlatformAdapter } from "../delivery-platform-adapter";
import { DeliveryPlatformError } from "../delivery-platform-errors";
import type {
  ActivateExternalStoreInput,
  ActivateExternalStoreResult,
  BeginDeliveryConnectionInput,
  BeginDeliveryConnectionResult,
  CompleteDeliveryConnectionInput,
  CompleteDeliveryConnectionResult,
  DeliveryPlatformCapability,
  DeliveryProvider,
  DisconnectDeliveryConnectionInput,
  ExternalOrderActionInput,
  ExternalOrderReconciliationResult,
  ExternalStore,
  FetchExternalOrderInput,
  ListExternalStoresInput,
  MenuSyncResult,
  NormalizedExternalOrder,
  ReconcileExternalOrdersInput,
  SyncMenuInput,
  UpdateAvailabilityInput,
  VerifiedDeliveryWebhook,
} from "../delivery-platform-types";

export abstract class FailClosedDeliveryPlatformAdapter implements DeliveryPlatformAdapter {
  abstract readonly provider: DeliveryProvider;
  abstract getConnectionCapabilities(): readonly DeliveryPlatformCapability[];

  protected unavailable(): never {
    throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
  }

  async beginConnection(input: BeginDeliveryConnectionInput): Promise<BeginDeliveryConnectionResult> {
    void input;
    return this.unavailable();
  }
  async completeConnection(input: CompleteDeliveryConnectionInput): Promise<CompleteDeliveryConnectionResult> {
    void input;
    return this.unavailable();
  }
  async disconnectConnection(input: DisconnectDeliveryConnectionInput): Promise<void> {
    void input;
    return this.unavailable();
  }
  async listExternalStores(input: ListExternalStoresInput): Promise<ExternalStore[]> {
    void input;
    return this.unavailable();
  }
  async activateStoreConnection(input: ActivateExternalStoreInput): Promise<ActivateExternalStoreResult> {
    void input;
    return this.unavailable();
  }
  async syncMenu(input: SyncMenuInput): Promise<MenuSyncResult> {
    void input;
    return this.unavailable();
  }
  async updateProductAvailability(input: UpdateAvailabilityInput): Promise<void> {
    void input;
    return this.unavailable();
  }
  async acceptOrder(input: ExternalOrderActionInput): Promise<void> {
    void input;
    return this.unavailable();
  }
  async rejectOrder(input: ExternalOrderActionInput): Promise<void> {
    void input;
    return this.unavailable();
  }
  async markOrderPreparing(input: ExternalOrderActionInput): Promise<void> {
    void input;
    return this.unavailable();
  }
  async markOrderReady(input: ExternalOrderActionInput): Promise<void> {
    void input;
    return this.unavailable();
  }
  async verifyWebhook(
    request: Request,
    connection: import("../delivery-platform-types").DeliveryPlatformConnectionContext,
  ): Promise<VerifiedDeliveryWebhook> {
    void request;
    void connection;
    return this.unavailable();
  }
  async fetchOrderDetails(input: FetchExternalOrderInput): Promise<NormalizedExternalOrder> {
    void input;
    return this.unavailable();
  }
  async reconcileOrders(input: ReconcileExternalOrdersInput): Promise<ExternalOrderReconciliationResult> {
    void input;
    return this.unavailable();
  }
}
