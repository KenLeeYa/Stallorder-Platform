export const deliveryProviders = ["UBER_EATS", "FOODPANDA", "MOCK"] as const;
export type DeliveryProvider = (typeof deliveryProviders)[number];

export const deliveryCapabilities = [
  "OAUTH_CONNECTION",
  "PARTNER_MANAGED_CONNECTION",
  "STORE_LISTING",
  "MENU_PUSH",
  "MENU_PULL",
  "AVAILABILITY_PUSH",
  "ORDER_WEBHOOK",
  "ORDER_ACCEPT",
  "ORDER_REJECT",
  "ORDER_PREPARING",
  "ORDER_READY",
  "ORDER_RECONCILIATION",
  "PAYMENT_BREAKDOWN",
] as const;
export type DeliveryPlatformCapability = (typeof deliveryCapabilities)[number];

export const deliveryCircuitSources = [
  "CIRCUIT_A_EDGE",
  "CIRCUIT_B_VERCEL",
  "BACKGROUND_JOB",
  "PLATFORM_ADMIN",
  "UNKNOWN",
] as const;
export type DeliveryCircuitSource = (typeof deliveryCircuitSources)[number];

export type DeliveryPlatformConnectionContext = {
  id: string;
  organizationId: string;
  stallId: string;
  provider: DeliveryProvider;
  externalStoreId: string | null;
  credentialReference: string | null;
};

export type BeginDeliveryConnectionInput = {
  organizationId: string;
  stallId: string;
  state: string;
  codeChallenge: string;
  redirectUri: string;
};

export type BeginDeliveryConnectionResult = {
  authorizationUrl: URL | null;
  status: "PENDING_AUTHORIZATION" | "PENDING_PARTNER_APPROVAL" | "TESTING";
};

export type CompleteDeliveryConnectionInput = {
  organizationId: string;
  stallId: string;
  code: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
};

export type CompleteDeliveryConnectionResult = {
  externalAccountReference: string;
  credentialReference: string | null;
  status: "PENDING_STORE_MAPPING" | "TESTING";
};

export type DisconnectDeliveryConnectionInput = {
  connection: DeliveryPlatformConnectionContext;
  idempotencyKey: string;
};

export type ExternalStore = {
  id: string;
  chainId: string | null;
  name: string;
};

export type ListExternalStoresInput = {
  connection: DeliveryPlatformConnectionContext;
};

export type ActivateExternalStoreInput = {
  connection: DeliveryPlatformConnectionContext;
  externalStoreId: string;
  idempotencyKey: string;
};

export type ActivateExternalStoreResult = {
  externalStoreId: string;
  externalStoreName: string;
};

export type SyncMenuInput = {
  connection: DeliveryPlatformConnectionContext;
  idempotencyKey: string;
  menuVersion: string;
};

export type MenuSyncResult = {
  externalVersion: string;
  itemCount: number;
};

export type UpdateAvailabilityInput = {
  connection: DeliveryPlatformConnectionContext;
  externalProductId: string;
  available: boolean;
  idempotencyKey: string;
};

export type ExternalOrderActionInput = {
  connection: DeliveryPlatformConnectionContext;
  externalOrderId: string;
  idempotencyKey: string;
  reasonCode?: string;
};

export type FetchExternalOrderInput = {
  connection: DeliveryPlatformConnectionContext;
  externalOrderId: string;
};

export type ReconcileExternalOrdersInput = {
  connection: DeliveryPlatformConnectionContext;
  since: Date;
};

export type ExternalOrderReconciliationResult = {
  checked: number;
  changed: number;
};

export type NormalizedExternalOrderModifier = {
  externalModifierId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

export type NormalizedExternalOrderItem = {
  externalItemId: string;
  externalProductId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  modifiers: NormalizedExternalOrderModifier[];
  notes: string | null;
};

export type NormalizedExternalOrder = {
  provider: DeliveryProvider;
  externalOrderId: string;
  externalOrderNumber: string | null;
  externalStoreId: string;
  currency: string;
  placedAt: Date;
  scheduledPickupAt: Date | null;
  customerDisplayName: string | null;
  customerPhoneMasked: string | null;
  customerNote: string | null;
  items: NormalizedExternalOrderItem[];
  pricing: {
    subtotal: number;
    platformDiscount: number;
    merchantDiscount: number;
    deliveryFee: number;
    serviceFee: number;
    tax: number;
    total: number;
    merchantReceivable: number;
  };
  payment: {
    status: string;
    merchantCollectedCash: boolean;
  };
  fulfillment: {
    type: "DELIVERY" | "PICKUP";
  };
  providerMetadata: Record<string, string | number | boolean | null>;
};

export type VerifiedDeliveryWebhook = {
  provider: DeliveryProvider;
  externalEventId: string | null;
  eventType: string;
  replayKey: string;
  payloadHash: string;
  signatureValid: true;
  order: NormalizedExternalOrder | null;
};

export function parseDeliveryProvider(value: string): DeliveryProvider | null {
  const normalized = value.trim().toUpperCase();
  return deliveryProviders.find((provider) => provider === normalized) ?? null;
}
