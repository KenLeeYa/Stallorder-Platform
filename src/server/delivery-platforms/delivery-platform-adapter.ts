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
} from "./delivery-platform-types";

export interface DeliveryPlatformAdapter {
  readonly provider: DeliveryProvider;
  getConnectionCapabilities(): readonly DeliveryPlatformCapability[];
  beginConnection(input: BeginDeliveryConnectionInput): Promise<BeginDeliveryConnectionResult>;
  completeConnection(input: CompleteDeliveryConnectionInput): Promise<CompleteDeliveryConnectionResult>;
  disconnectConnection(input: DisconnectDeliveryConnectionInput): Promise<void>;
  listExternalStores(input: ListExternalStoresInput): Promise<ExternalStore[]>;
  activateStoreConnection(input: ActivateExternalStoreInput): Promise<ActivateExternalStoreResult>;
  syncMenu(input: SyncMenuInput): Promise<MenuSyncResult>;
  updateProductAvailability(input: UpdateAvailabilityInput): Promise<void>;
  acceptOrder(input: ExternalOrderActionInput): Promise<void>;
  rejectOrder(input: ExternalOrderActionInput): Promise<void>;
  markOrderPreparing(input: ExternalOrderActionInput): Promise<void>;
  markOrderReady(input: ExternalOrderActionInput): Promise<void>;
  verifyWebhook(
    request: Request,
    connection: import("./delivery-platform-types").DeliveryPlatformConnectionContext,
  ): Promise<VerifiedDeliveryWebhook>;
  fetchOrderDetails(input: FetchExternalOrderInput): Promise<NormalizedExternalOrder>;
  reconcileOrders(input: ReconcileExternalOrdersInput): Promise<ExternalOrderReconciliationResult>;
}
