import { FailClosedDeliveryPlatformAdapter } from "../fail-closed-delivery-platform-adapter";
import { DeliveryPlatformError } from "../../delivery-platform-errors";
import type {
  ActivateExternalStoreInput,
  BeginDeliveryConnectionInput,
  DeliveryPlatformConnectionContext,
  ExternalOrderActionInput,
  FetchExternalOrderInput,
  ListExternalStoresInput,
  ReconcileExternalOrdersInput,
  UpdateAvailabilityInput,
} from "../../delivery-platform-types";
import { FoodpandaApiClient } from "./foodpanda-client";
import { verifyFoodpandaWebhook } from "./foodpanda-webhook";

export class FoodpandaAdapter extends FailClosedDeliveryPlatformAdapter {
  readonly provider = "FOODPANDA" as const;

  constructor(private readonly client = new FoodpandaApiClient()) {
    super();
  }

  getConnectionCapabilities() {
    return [
      "PARTNER_MANAGED_CONNECTION",
      "STORE_LISTING",
      "AVAILABILITY_PUSH",
      "ORDER_WEBHOOK",
      "ORDER_ACCEPT",
      "ORDER_REJECT",
      "ORDER_READY",
      "ORDER_RECONCILIATION",
      "PAYMENT_BREAKDOWN",
    ] as const;
  }

  async beginConnection(input: BeginDeliveryConnectionInput) {
    void input;
    return { authorizationUrl: null, status: "PENDING_PARTNER_APPROVAL" as const };
  }

  async disconnectConnection() {}

  async listExternalStores(input: ListExternalStoresInput) {
    const storeId = input.connection.externalStoreId;
    if (!storeId) throw new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
    return [{ id: storeId, chainId: input.connection.externalChainId, name: storeId }];
  }

  async activateStoreConnection(input: ActivateExternalStoreInput) {
    if (input.connection.externalStoreId !== input.externalStoreId) {
      throw new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
    }
    return { externalStoreId: input.externalStoreId, externalStoreName: input.externalStoreId };
  }

  async updateProductAvailability(input: UpdateAvailabilityInput) {
    await this.client.updateProductAvailability(
      input.connection,
      input.externalProductId,
      input.available,
    );
  }

  async acceptOrder(input: ExternalOrderActionInput) {
    const order = await this.client.fetchOrderDetails(input.connection, input.externalOrderId);
    assertMappedStore(input.connection, order.externalStoreId);
  }

  async rejectOrder(input: ExternalOrderActionInput) {
    await this.client.updateOrderStatus(
      input.connection,
      input.externalOrderId,
      "CANCELLED",
      input.reasonCode ?? "MERCHANT_REJECTED",
    );
  }

  async markOrderPreparing(input: ExternalOrderActionInput) {
    const order = await this.client.fetchOrderDetails(input.connection, input.externalOrderId);
    assertMappedStore(input.connection, order.externalStoreId);
  }

  async markOrderReady(input: ExternalOrderActionInput) {
    const order = await this.client.fetchOrderDetails(input.connection, input.externalOrderId);
    assertMappedStore(input.connection, order.externalStoreId);
    const status = order.providerMetadata.transportType === "VENDOR_DELIVERY"
      ? "DISPATCHED"
      : "READY_FOR_PICKUP";
    await this.client.updateOrderStatus(input.connection, input.externalOrderId, status);
  }

  verifyWebhook(request: Request, connection: DeliveryPlatformConnectionContext) {
    return verifyFoodpandaWebhook(request, connection);
  }

  fetchOrderDetails(input: FetchExternalOrderInput) {
    return this.client.fetchOrderDetails(input.connection, input.externalOrderId);
  }

  async reconcileOrders(input: ReconcileExternalOrdersInput) {
    const orders = await this.client.reconcileOrders(input.connection, input.since);
    return { checked: orders.length, changed: 0 };
  }
}

function assertMappedStore(connection: DeliveryPlatformConnectionContext, externalStoreId: string) {
  if (!connection.externalStoreId || connection.externalStoreId !== externalStoreId) {
    throw new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
  }
}
