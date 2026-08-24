import { ClientCredentialsTokenService } from "../../client-credentials-token-service";
import { DeliveryProviderHttpClient } from "../../delivery-provider-http-client";
import { DeliveryPlatformError } from "../../delivery-platform-errors";
import {
  createEnvironmentDeliverySecretResolver,
  type DeliverySecretResolver,
} from "../../delivery-secret-resolver";
import type { DeliveryPlatformConnectionContext } from "../../delivery-platform-types";
import { getFoodpandaPartnerConfig } from "./foodpanda-auth";
import {
  normalizeFoodpandaOrder,
  parseFoodpandaOrder,
} from "./foodpanda-normalizer";

type Fetch = typeof fetch;

export class FoodpandaApiClient {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly resolveSecret: DeliverySecretResolver;
  private readonly fetchImpl: Fetch;
  private readonly now: () => number;
  private readonly tokenServices = new Map<string, ClientCredentialsTokenService>();

  constructor(options: {
    environment?: NodeJS.ProcessEnv;
    resolveSecret?: DeliverySecretResolver;
    fetchImpl?: Fetch;
    now?: () => number;
  } = {}) {
    this.environment = options.environment ?? process.env;
    this.resolveSecret = options.resolveSecret
      ?? createEnvironmentDeliverySecretResolver(this.environment);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async fetchOrderDetails(
    connection: DeliveryPlatformConnectionContext,
    externalOrderId: string,
  ) {
    const config = this.config(connection);
    const raw = await this.request(connection, {
      method: "GET",
      path: `/v2/chains/${segment(connection.externalChainId)}/orders/${segment(externalOrderId)}`,
    });
    return normalizeFoodpandaOrder(raw, config.currency);
  }

  async updateOrderStatus(
    connection: DeliveryPlatformConnectionContext,
    externalOrderId: string,
    status: "CANCELLED" | "DISPATCHED" | "READY_FOR_PICKUP",
    cancellationReason = "",
  ) {
    const current = parseFoodpandaOrder(await this.request(connection, {
      method: "GET",
      path: `/v2/chains/${segment(connection.externalChainId)}/orders/${segment(externalOrderId)}`,
    }));
    const body = {
      cancellation: { reason: status === "CANCELLED" ? cancellationReason.slice(0, 200) : "" },
      items: current.items.map((item) => ({
        _id: item._id,
        pricing: {
          pricing_type: item.pricing.pricing_type,
          quantity: item.pricing.quantity,
          unit_price: item.pricing.unit_price,
          weight: item.pricing.weight ?? 0,
          weighted_pieces: item.pricing.weighted_pieces ?? 0,
        },
        sku: item.sku ?? undefined,
        status: "IN_CART",
      })),
      order_id: current.order_id,
      status,
    };
    await this.request(connection, {
      method: "PUT",
      path: `/v2/chains/${segment(connection.externalChainId)}/orders/${segment(externalOrderId)}`,
      body,
      expectedStatuses: [200],
    });
  }

  async updateProductAvailability(
    connection: DeliveryPlatformConnectionContext,
    externalProductId: string,
    available: boolean,
  ) {
    if (!connection.externalStoreId) throw storeError();
    const response = await this.request(connection, {
      method: "PUT",
      path: `/v2/chains/${segment(connection.externalChainId)}/vendors/${segment(connection.externalStoreId)}/catalog`,
      body: { products: [{ sku: externalProductId, active: available }] },
      expectedStatuses: [202],
    });
    return response;
  }

  async reconcileOrders(
    connection: DeliveryPlatformConnectionContext,
    since: Date,
  ) {
    if (!connection.externalStoreId || !Number.isFinite(since.getTime())) throw storeError();
    const start = new Date(Math.max(
      since.getTime(),
      this.now() - 60 * 24 * 60 * 60 * 1000,
    ));
    const query = new URLSearchParams({
      start_time: start.toISOString(),
      end_time: new Date(this.now()).toISOString(),
      page_size: "500",
      page: "1",
    });
    const response = await this.request(connection, {
      method: "GET",
      path: `/v2/chains/${segment(connection.externalChainId)}/vendors/${segment(connection.externalStoreId)}/orders?${query}`,
    });
    if (!response || typeof response !== "object" || !("orders" in response) || !Array.isArray(response.orders)) {
      throw new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
    }
    return response.orders.map((order) => normalizeFoodpandaOrder(order, this.config(connection).currency));
  }

  private config(connection: DeliveryPlatformConnectionContext) {
    if (!connection.externalChainId) throw storeError();
    return getFoodpandaPartnerConfig(this.environment, connection.credentialReference);
  }

  private request(
    connection: DeliveryPlatformConnectionContext,
    input: Parameters<DeliveryProviderHttpClient["requestJson"]>[0],
  ) {
    const config = this.config(connection);
    const key = `${config.providerEnvironment}:${config.clientId}:${config.credentialReference}`;
    let tokenService = this.tokenServices.get(key);
    if (!tokenService) {
      tokenService = new ClientCredentialsTokenService({
        clientId: config.clientId,
        resolveClientSecret: () => this.resolveSecret(config.credentialReference),
        tokenUrl: new URL("/v2/oauth/token", config.baseUrl),
        refreshSkewSeconds: config.tokenRefreshSkewSeconds,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl: this.fetchImpl,
        now: this.now,
      });
      this.tokenServices.set(key, tokenService);
    }
    return new DeliveryProviderHttpClient({
      baseUrl: config.baseUrl,
      tokenProvider: tokenService,
      timeoutMs: config.requestTimeoutMs,
      fetchImpl: this.fetchImpl,
    }).requestJson(input);
  }
}

function segment(value: string | null) {
  if (!value || value.length > 200) throw storeError();
  return encodeURIComponent(value);
}

function storeError() {
  return new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
}
