import { FailClosedDeliveryPlatformAdapter } from "../fail-closed-delivery-platform-adapter";
import { DeliveryPlatformError } from "../../delivery-platform-errors";
import type {
  BeginDeliveryConnectionInput,
  DeliveryPlatformConnectionContext,
  ExternalOrderActionInput,
  FetchExternalOrderInput,
  UpdateAvailabilityInput,
} from "../../delivery-platform-types";
import { UberEatsApiClient } from "./uber-eats-client";
import { getUberEatsOAuthConfig } from "./uber-eats-oauth";
import { verifyUberEatsWebhook } from "./uber-eats-webhook";

export class UberEatsAdapter extends FailClosedDeliveryPlatformAdapter {
  readonly provider = "UBER_EATS" as const;

  constructor(
    private readonly client = new UberEatsApiClient(),
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {
    super();
  }

  getConnectionCapabilities() {
    return [
      "OAUTH_CONNECTION",
      "AVAILABILITY_PUSH",
      "ORDER_WEBHOOK",
      "ORDER_ACCEPT",
      "ORDER_REJECT",
      "PAYMENT_BREAKDOWN",
    ] as const;
  }

  async beginConnection(input: BeginDeliveryConnectionInput) {
    const config = getUberEatsOAuthConfig(this.environment);
    if (new URL(input.redirectUri).toString() !== config.callbackUrl) {
      throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
    }
    const authorizationUrl = new URL("/oauth/v2/authorize", config.authBaseUrl);
    authorizationUrl.search = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.callbackUrl,
      scope: "eats.pos_provisioning",
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return { authorizationUrl, status: "PENDING_AUTHORIZATION" as const };
  }

  async updateProductAvailability(input: UpdateAvailabilityInput) {
    await this.client.updateProductAvailability(
      input.connection,
      input.externalProductId,
      input.available,
    );
  }

  async acceptOrder(input: ExternalOrderActionInput) {
    await this.client.acceptOrder(input.connection, input.externalOrderId);
  }

  async rejectOrder(input: ExternalOrderActionInput) {
    await this.client.denyOrder(input.connection, input.externalOrderId, input.reasonCode);
  }

  async markOrderPreparing(input: ExternalOrderActionInput) {
    const order = await this.client.fetchOrderDetails(input.connection, input.externalOrderId);
    assertMappedStore(input.connection, order.externalStoreId);
  }

  verifyWebhook(request: Request, connection: DeliveryPlatformConnectionContext) {
    return verifyUberEatsWebhook(request, connection);
  }

  fetchOrderDetails(input: FetchExternalOrderInput) {
    return this.client.fetchOrderDetails(input.connection, input.externalOrderId);
  }
}

function assertMappedStore(connection: DeliveryPlatformConnectionContext, externalStoreId: string) {
  if (!connection.externalStoreId || connection.externalStoreId !== externalStoreId) {
    throw new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
  }
}
