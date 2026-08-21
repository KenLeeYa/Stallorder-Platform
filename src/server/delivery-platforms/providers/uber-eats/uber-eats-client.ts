import { ClientCredentialsTokenService } from "../../client-credentials-token-service";
import { DeliveryProviderHttpClient } from "../../delivery-provider-http-client";
import { DeliveryPlatformError } from "../../delivery-platform-errors";
import {
  createEnvironmentDeliverySecretResolver,
  type DeliverySecretResolver,
} from "../../delivery-secret-resolver";
import type { DeliveryPlatformConnectionContext } from "../../delivery-platform-types";
import { normalizeUberEatsOrder } from "./uber-eats-normalizer";
import { getUberEatsOAuthConfig } from "./uber-eats-oauth";

type Fetch = typeof fetch;

const denyReasonCodes = new Set([
  "STORE_CLOSED",
  "POS_NOT_READY",
  "POS_OFFLINE",
  "ITEM_AVAILABILITY",
  "MISSING_ITEM",
  "MISSING_INFO",
  "PRICING",
  "CAPACITY",
  "ADDRESS",
  "SPECIAL_INSTRUCTIONS",
  "OTHER",
]);

export class UberEatsApiClient {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly resolveSecret: DeliverySecretResolver;
  private readonly fetchImpl: Fetch;
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

  private readonly now: () => number;

  async fetchOrderDetails(
    connection: DeliveryPlatformConnectionContext,
    externalOrderId: string,
  ) {
    const response = await this.request(connection, "eats.order", {
      method: "GET",
      path: `/v2/eats/order/${segment(externalOrderId)}`,
    });
    return normalizeUberEatsOrder(response);
  }

  async acceptOrder(
    connection: DeliveryPlatformConnectionContext,
    externalOrderId: string,
  ) {
    await this.request(connection, "eats.order", {
      method: "POST",
      path: `/v1/eats/orders/${segment(externalOrderId)}/accept_pos_order`,
      body: {
        reason: "Accepted by StallOrder",
        fields_relayed: {
          order_special_instructions: true,
          item_special_instructions: true,
          promotions: true,
        },
      },
      expectedStatuses: [204],
    });
  }

  async denyOrder(
    connection: DeliveryPlatformConnectionContext,
    externalOrderId: string,
    internalReason?: string,
  ) {
    const reasonCode = internalReason && denyReasonCodes.has(internalReason)
      ? internalReason
      : "OTHER";
    await this.request(connection, "eats.order", {
      method: "POST",
      path: `/v1/eats/orders/${segment(externalOrderId)}/deny_pos_order`,
      body: {
        reason: {
          explanation: reasonCode === "OTHER" ? "Merchant rejected in StallOrder" : reasonCode,
          code: reasonCode,
        },
      },
      expectedStatuses: [204],
    });
  }

  async updateProductAvailability(
    connection: DeliveryPlatformConnectionContext,
    externalProductId: string,
    available: boolean,
  ) {
    if (!connection.externalStoreId) throw storeError();
    await this.request(connection, "eats.store", {
      method: "POST",
      path: `/v2/eats/stores/${segment(connection.externalStoreId)}/menus/items/${segment(externalProductId)}`,
      body: {
        suspension_info: {
          suspension: available
            ? null
            : { suspend_until: Math.floor(this.now() / 1000) + 365 * 24 * 60 * 60, reason: "StallOrder availability sync" },
        },
      },
      expectedStatuses: [204],
    });
  }

  private request(
    connection: DeliveryPlatformConnectionContext,
    scope: string,
    input: Parameters<DeliveryProviderHttpClient["requestJson"]>[0],
  ) {
    const config = getUberEatsOAuthConfig(this.environment, connection.credentialReference);
    const normalizedScope = scope.split(/\s+/).filter(Boolean).sort().join(" ");
    const key = [
      config.providerEnvironment,
      config.clientId,
      config.credentialReference,
      normalizedScope,
    ].join(":");
    let tokenService = this.tokenServices.get(key);
    if (!tokenService) {
      tokenService = new ClientCredentialsTokenService({
        clientId: config.clientId,
        resolveClientSecret: () => this.resolveSecret(config.credentialReference),
        tokenUrl: new URL("/oauth/v2/token", config.authBaseUrl),
        scope: normalizedScope,
        refreshSkewSeconds: config.tokenRefreshSkewSeconds,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl: this.fetchImpl,
        now: this.now,
      });
      this.tokenServices.set(key, tokenService);
    }
    return new DeliveryProviderHttpClient({
      baseUrl: config.apiBaseUrl,
      tokenProvider: tokenService,
      timeoutMs: config.requestTimeoutMs,
      fetchImpl: this.fetchImpl,
    }).requestJson(input);
  }
}

function segment(value: string) {
  if (!value || value.length > 200) {
    throw new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
  }
  return encodeURIComponent(value);
}

function storeError() {
  return new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
}
