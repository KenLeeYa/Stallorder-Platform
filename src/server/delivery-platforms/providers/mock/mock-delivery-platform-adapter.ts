import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DeliveryPlatformAdapter } from "../../delivery-platform-adapter";
import { isProductionDeliveryRuntime } from "../../delivery-environment";
import { DeliveryPlatformError } from "../../delivery-platform-errors";
import type {
  ActivateExternalStoreInput,
  BeginDeliveryConnectionInput,
  CompleteDeliveryConnectionInput,
  DeliveryPlatformConnectionContext,
  ExternalOrderActionInput,
  FetchExternalOrderInput,
  NormalizedExternalOrder,
  SyncMenuInput,
  UpdateAvailabilityInput,
} from "../../delivery-platform-types";

const money = z.number().int().min(0).max(100_000_000);
const fixtureSchema = z.object({
  eventId: z.string().min(1).max(120),
  eventType: z.string().min(1).max(120),
  order: z.object({
    externalOrderId: z.string().min(1).max(120),
    externalOrderNumber: z.string().min(1).max(120).nullable(),
    externalStoreId: z.string().min(1).max(120),
    currency: z.string().regex(/^[A-Z]{3}$/),
    placedAt: z.string().datetime({ offset: true }),
    scheduledPickupAt: z.string().datetime({ offset: true }).nullable(),
    customerDisplayName: z.string().max(120).nullable(),
    customerPhoneMasked: z.string().max(40).nullable(),
    customerNote: z.string().max(500).nullable(),
    items: z.array(z.object({
      externalItemId: z.string().min(1).max(120),
      externalProductId: z.string().min(1).max(120),
      name: z.string().min(1).max(200),
      quantity: z.number().int().min(1).max(100),
      unitPrice: money,
      totalPrice: money,
      modifiers: z.array(z.object({
        externalModifierId: z.string().min(1).max(120),
        name: z.string().min(1).max(200),
        quantity: z.number().int().min(1).max(100),
        unitPrice: money,
        totalPrice: money,
      })).max(30),
      notes: z.string().max(500).nullable(),
    })).min(1).max(100),
    pricing: z.object({
      subtotal: money,
      platformDiscount: money,
      merchantDiscount: money,
      deliveryFee: money,
      serviceFee: money,
      tax: money,
      total: money,
      merchantReceivable: money,
    }),
    payment: z.object({
      status: z.string().min(1).max(80),
      merchantCollectedCash: z.boolean(),
    }),
    fulfillment: z.object({
      type: z.enum(["DELIVERY", "PICKUP"]),
    }),
    providerMetadata: z.record(
      z.string().max(80),
      z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
    ),
  }),
}).strict();

const mockCapabilities = [
  "STORE_LISTING",
  "MENU_PUSH",
  "AVAILABILITY_PUSH",
  "ORDER_WEBHOOK",
  "ORDER_ACCEPT",
  "ORDER_REJECT",
  "ORDER_PREPARING",
  "ORDER_READY",
  "ORDER_RECONCILIATION",
  "PAYMENT_BREAKDOWN",
] as const;

export class MockDeliveryPlatformAdapter implements DeliveryPlatformAdapter {
  readonly provider = "MOCK" as const;

  constructor(
    private readonly webhookSecret: string,
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    if (isProductionDeliveryRuntime(environment)) {
      throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
    }
    if (webhookSecret.length < 32) {
      throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
    }
  }

  getConnectionCapabilities() {
    return mockCapabilities;
  }

  async beginConnection(input: BeginDeliveryConnectionInput) {
    void input;
    return { authorizationUrl: null, status: "TESTING" as const };
  }

  async completeConnection(input: CompleteDeliveryConnectionInput) {
    if (input.code !== "mock-authorization-code") {
      throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
    }
    return {
      externalAccountReference: "synthetic-account",
      credentialReference: null,
      status: "TESTING" as const,
    };
  }

  async disconnectConnection() {}

  async listExternalStores() {
    return [
      { id: "mock-store-taipei-001", chainId: "mock-chain-001", name: "合成台北測試門市" },
      { id: "mock-store-kaohsiung-001", chainId: "mock-chain-001", name: "合成高雄測試門市" },
    ];
  }

  async activateStoreConnection(input: ActivateExternalStoreInput) {
    const store = (await this.listExternalStores()).find(
      (candidate) => candidate.id === input.externalStoreId,
    );
    if (!store) throw new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
    return { externalStoreId: store.id, externalStoreName: store.name };
  }

  async syncMenu(input: SyncMenuInput) {
    this.assertActionMode(input.idempotencyKey);
    return { externalVersion: `mock-${input.menuVersion}`, itemCount: 3 };
  }

  async updateProductAvailability(input: UpdateAvailabilityInput) {
    this.assertActionMode(input.idempotencyKey);
  }

  async acceptOrder(input: ExternalOrderActionInput) {
    this.assertActionMode(input.idempotencyKey);
  }

  async rejectOrder(input: ExternalOrderActionInput) {
    this.assertActionMode(input.idempotencyKey);
  }

  async markOrderPreparing(input: ExternalOrderActionInput) {
    this.assertActionMode(input.idempotencyKey);
  }

  async markOrderReady(input: ExternalOrderActionInput) {
    this.assertActionMode(input.idempotencyKey);
  }

  async verifyWebhook(
    request: Request,
    connection: DeliveryPlatformConnectionContext,
  ) {
    if (connection.provider !== "MOCK") {
      throw new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].toLowerCase();
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentType !== "application/json" || contentLength > 128_000) {
      throw new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
    }
    const body = await request.text();
    if (body.length === 0 || body.length > 128_000) {
      throw new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
    }
    const suppliedSignature = request.headers.get("x-stallorder-mock-signature")?.trim() ?? "";
    const expectedSignature = createHmac("sha256", this.webhookSecret).update(body).digest("hex");
    if (!safeHexEqual(suppliedSignature, expectedSignature)) {
      throw new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      throw new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
    }
    const parsed = fixtureSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
    }
    const payloadHash = sha256(body);
    return {
      provider: this.provider,
      externalEventId: parsed.data.eventId,
      eventType: parsed.data.eventType,
      replayKey: sha256(`${this.provider}:${parsed.data.eventId}`),
      payloadHash,
      signatureValid: true as const,
      order: normalizeFixtureOrder(parsed.data.order),
      orderReference: null,
    };
  }

  async fetchOrderDetails(input: FetchExternalOrderInput) {
    return syntheticOrder(input.externalOrderId, input.connection.externalStoreId ?? "mock-store-taipei-001");
  }

  async reconcileOrders() {
    return { checked: 1, changed: 0 };
  }

  private assertActionMode(idempotencyKey: string) {
    if (idempotencyKey.includes("retryable-error")) {
      throw new DeliveryPlatformError("RETRYABLE_PROVIDER_ERROR", { retryable: true });
    }
    if (idempotencyKey.includes("permanent-error")) {
      throw new DeliveryPlatformError("PERMISSION_DENIED", { retryable: false });
    }
    if (idempotencyKey.includes("ambiguous-response")) {
      throw new DeliveryPlatformError("PROVIDER_UNAVAILABLE", { retryable: true });
    }
  }
}

function normalizeFixtureOrder(order: z.infer<typeof fixtureSchema>["order"]): NormalizedExternalOrder {
  return {
    provider: "MOCK",
    ...order,
    placedAt: new Date(order.placedAt),
    scheduledPickupAt: order.scheduledPickupAt ? new Date(order.scheduledPickupAt) : null,
  };
}

function syntheticOrder(externalOrderId: string, externalStoreId: string): NormalizedExternalOrder {
  return {
    provider: "MOCK",
    externalOrderId,
    externalOrderNumber: "M001",
    externalStoreId,
    currency: "TWD",
    placedAt: new Date("2026-07-30T00:00:00.000Z"),
    scheduledPickupAt: null,
    customerDisplayName: "合成顧客",
    customerPhoneMasked: "***-***-000",
    customerNote: null,
    items: [{
      externalItemId: "mock-item-001",
      externalProductId: "mock-product-001",
      name: "合成測試餐點",
      quantity: 1,
      unitPrice: 100,
      totalPrice: 100,
      modifiers: [],
      notes: null,
    }],
    pricing: {
      subtotal: 100,
      platformDiscount: 0,
      merchantDiscount: 0,
      deliveryFee: 20,
      serviceFee: 0,
      tax: 0,
      total: 120,
      merchantReceivable: 100,
    },
    payment: { status: "PAID_BY_PLATFORM", merchantCollectedCash: false },
    fulfillment: { type: "DELIVERY" },
    providerMetadata: { synthetic: true },
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
