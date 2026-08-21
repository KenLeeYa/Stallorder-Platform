import { z } from "zod";
import { providerMajorAmountToInternalUnits } from "../../delivery-money";
import { DeliveryPlatformError } from "../../delivery-platform-errors";
import type {
  NormalizedExternalOrder,
  NormalizedExternalOrderModifier,
} from "../../delivery-platform-types";

const providerAmount = z.union([
  z.number().finite(),
  z.string().regex(/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/),
]);

const foodpandaModifierSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(100).default(1),
  unit_price: providerAmount.default(0),
  total_price: providerAmount.default(0),
}).passthrough();

const foodpandaOrderSchema = z.object({
  accepted_for: z.string().datetime({ offset: true }).nullable().optional(),
  promised_for: z.string().datetime({ offset: true }).nullable().optional(),
  comment: z.string().max(1_000).nullable().optional(),
  external_order_id: z.string().min(1).max(200).nullable().optional(),
  isPreorder: z.boolean().optional(),
  order_code: z.string().min(1).max(120).nullable().optional(),
  order_id: z.string().min(1).max(200),
  order_type: z.enum(["DELIVERY", "PICKUP"]),
  client: z.object({
    chain_id: z.string().min(1).max(200).optional(),
    store_id: z.string().min(1).max(200),
    country_code: z.string().min(2).max(3).optional(),
  }).passthrough(),
  customer: z.object({
    first_name: z.string().max(120).nullable().optional(),
    last_name: z.string().max(120).nullable().optional(),
    phone_number: z.string().max(40).nullable().optional(),
  }).passthrough().nullable().optional(),
  items: z.array(z.object({
    _id: z.string().min(1).max(200),
    sku: z.string().min(1).max(200).nullable().optional(),
    name: z.string().min(1).max(300),
    instructions: z.string().max(1_000).nullable().optional(),
    pricing: z.object({
      pricing_type: z.string().max(40).optional(),
      quantity: z.number().int().min(0).max(100),
      total_price: providerAmount,
      unit_price: providerAmount,
      weight: z.number().finite().min(0).optional(),
      weighted_pieces: z.number().int().min(0).max(1_000).optional(),
    }).passthrough(),
    promotion: z.array(z.object({
      discount_amount: providerAmount.default(0),
      sponsorships: z.array(z.object({
        sponsor: z.string().min(1).max(80),
        amount: providerAmount,
      }).passthrough()).optional(),
    }).passthrough()).optional(),
    modifiers: z.array(foodpandaModifierSchema).max(50).optional(),
  }).passthrough()).min(1).max(200),
  payment: z.object({
    collect_at_pickup: providerAmount.default(0),
    delivery_fee: providerAmount.default(0),
    discount: providerAmount.default(0),
    order_total: providerAmount,
    service_fee: providerAmount.default(0),
    sub_total: providerAmount,
    total_taxes: providerAmount.default(0),
    type: z.string().min(1).max(80),
  }).passthrough(),
  status: z.string().min(1).max(120),
  sys: z.object({
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }).optional(),
  }).passthrough(),
  transport_type: z.string().min(1).max(80),
  promotion_status: z.string().max(80).optional(),
}).passthrough();

type FoodpandaOrder = z.infer<typeof foodpandaOrderSchema>;

export function normalizeFoodpandaOrder(
  payload: unknown,
  currency = "TWD",
): NormalizedExternalOrder {
  const parsed = foodpandaOrderSchema.safeParse(payload);
  if (!parsed.success) throw contractError();
  const order = parsed.data;
  const normalizedCurrency = currency.trim().toUpperCase();
  const discounts = splitDiscounts(order, normalizedCurrency);
  const subtotal = money(order.payment.sub_total, normalizedCurrency);
  const total = money(order.payment.order_total, normalizedCurrency);
  const merchantCollectedCash = money(
    order.payment.collect_at_pickup,
    normalizedCurrency,
  ) > 0 || /CASH/i.test(order.payment.type);

  return {
    provider: "FOODPANDA",
    externalOrderId: order.order_id,
    externalOrderNumber: order.order_code ?? order.external_order_id ?? null,
    externalStoreId: order.client.store_id,
    currency: normalizedCurrency,
    placedAt: new Date(order.sys.created_at),
    scheduledPickupAt: parseNullableDate(order.accepted_for ?? order.promised_for),
    customerDisplayName: customerName(order),
    customerPhoneMasked: maskProviderPhone(order.customer?.phone_number),
    customerNote: nullableTrimmed(order.comment),
    items: order.items.map((item) => ({
      externalItemId: item._id,
      externalProductId: item.sku ?? item._id,
      name: item.name,
      quantity: normalizedFoodpandaQuantity(item.pricing),
      unitPrice: money(item.pricing.unit_price, normalizedCurrency),
      totalPrice: money(item.pricing.total_price, normalizedCurrency),
      modifiers: (item.modifiers ?? []).map((modifier) => normalizeModifier(
        modifier,
        normalizedCurrency,
      )),
      notes: nullableTrimmed(item.instructions),
    })),
    pricing: {
      subtotal,
      platformDiscount: discounts.platform,
      merchantDiscount: discounts.merchant,
      deliveryFee: money(order.payment.delivery_fee, normalizedCurrency),
      serviceFee: money(order.payment.service_fee, normalizedCurrency),
      tax: money(order.payment.total_taxes, normalizedCurrency),
      total,
      merchantReceivable: Math.max(0, subtotal - discounts.merchant),
    },
    payment: {
      status: order.payment.type,
      merchantCollectedCash,
    },
    fulfillment: {
      type: order.order_type === "PICKUP" ? "PICKUP" : "DELIVERY",
    },
    providerMetadata: {
      status: order.status,
      transportType: order.transport_type,
      preorder: order.isPreorder ?? false,
      promotionsAvailable: order.promotion_status !== "UNAVAILABLE",
      weightedItemCount: order.items.filter((item) =>
        item.pricing.pricing_type === "WEIGHT" || (item.pricing.weight ?? 0) > 0
      ).length,
    },
  };
}

export function parseFoodpandaOrder(payload: unknown) {
  const parsed = foodpandaOrderSchema.safeParse(payload);
  if (!parsed.success) throw contractError();
  return parsed.data;
}

function splitDiscounts(order: FoodpandaOrder, currency: string) {
  let merchant = 0;
  let platform = 0;
  for (const promotion of order.items.flatMap((item) => item.promotion ?? [])) {
    for (const sponsorship of promotion.sponsorships ?? []) {
      const amount = Math.abs(money(sponsorship.amount, currency));
      if (sponsorship.sponsor.toUpperCase() === "VENDOR") merchant += amount;
      else platform += amount;
    }
  }
  const declared = Math.abs(money(order.payment.discount, currency));
  const unallocated = Math.max(0, declared - merchant - platform);
  return { merchant, platform: platform + unallocated };
}

function normalizedFoodpandaQuantity(pricing: FoodpandaOrder["items"][number]["pricing"]) {
  if (pricing.pricing_type === "WEIGHT") {
    return Math.max(1, pricing.weighted_pieces ?? 1);
  }
  if (pricing.quantity < 1) throw contractError();
  return pricing.quantity;
}

function normalizeModifier(
  modifier: z.infer<typeof foodpandaModifierSchema>,
  currency: string,
): NormalizedExternalOrderModifier {
  return {
    externalModifierId: modifier.id,
    name: modifier.name,
    quantity: modifier.quantity,
    unitPrice: money(modifier.unit_price, currency),
    totalPrice: money(modifier.total_price, currency),
  };
}

function customerName(order: FoodpandaOrder) {
  const name = [order.customer?.first_name, order.customer?.last_name]
    .map((part) => nullableTrimmed(part))
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return name || null;
}

function parseNullableDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function nullableTrimmed(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function maskProviderPhone(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 2 ? `***${digits.slice(-2)}` : null;
}

function money(value: string | number, currency: string) {
  return providerMajorAmountToInternalUnits(value, currency);
}

function contractError() {
  return new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
}
