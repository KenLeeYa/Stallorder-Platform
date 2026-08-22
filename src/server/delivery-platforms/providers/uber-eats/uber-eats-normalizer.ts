import { z } from "zod";
import { assertProviderMinorAmount } from "../../delivery-money";
import { DeliveryPlatformError } from "../../delivery-platform-errors";
import type { NormalizedExternalOrder } from "../../delivery-platform-types";

const moneySchema = z.object({
  amount: z.number().int().min(0).max(100_000_000),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
}).passthrough();

const modifierSchema = z.object({
  id: z.string().min(1).max(200),
  instance_id: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(300),
  quantity: z.number().int().min(0).max(100),
  price: z.object({
    unit_price: moneySchema,
    total_price: moneySchema,
  }).passthrough(),
}).passthrough();

const uberEatsOrderSchema = z.object({
  id: z.string().min(1).max(200),
  display_id: z.string().min(1).max(120),
  current_state: z.string().min(1).max(120),
  store: z.object({
    id: z.string().min(1).max(200),
    name: z.string().max(300).optional(),
  }).passthrough(),
  eater: z.object({
    first_name: z.string().max(120).nullable().optional(),
    last_name: z.string().max(120).nullable().optional(),
    phone: z.string().max(80).nullable().optional(),
  }).passthrough().nullable().optional(),
  cart: z.object({
    special_instructions: z.string().max(1_000).nullable().optional(),
    items: z.array(z.object({
      id: z.string().min(1).max(200),
      instance_id: z.string().min(1).max(200),
      title: z.string().min(1).max(300),
      quantity: z.number().int().min(1).max(100),
      price: z.object({
        unit_price: moneySchema,
        total_price: moneySchema,
      }).passthrough(),
      selected_modifier_groups: z.array(z.object({
        selected_items: z.array(modifierSchema).nullable().optional(),
      }).passthrough()).nullable().optional(),
      special_instructions: z.string().max(1_000).nullable().optional(),
    }).passthrough()).min(1).max(200),
  }).passthrough(),
  payment: z.object({
    charges: z.object({
      total: moneySchema,
      sub_total: moneySchema,
      tax: moneySchema.optional(),
      total_fee: moneySchema.optional(),
      delivery_fee: moneySchema.optional(),
      service_fee: moneySchema.optional(),
      total_promotion_applied: moneySchema.optional(),
      cash_amount_due: moneySchema.optional(),
    }).passthrough(),
  }).passthrough(),
  placed_at: z.string().datetime({ offset: true }),
  estimated_ready_for_pickup_at: z.string().datetime({ offset: true }).nullable().optional(),
  type: z.string().min(1).max(80),
  brand: z.string().min(1).max(80).optional(),
}).passthrough();

type UberEatsOrder = z.infer<typeof uberEatsOrderSchema>;

export function normalizeUberEatsOrder(payload: unknown): NormalizedExternalOrder {
  const parsed = uberEatsOrderSchema.safeParse(payload);
  if (!parsed.success) throw contractError();
  const order = parsed.data;
  const currency = order.payment.charges.total.currency_code;
  assertSingleCurrency(order, currency);
  const charges = order.payment.charges;

  return {
    provider: "UBER_EATS",
    externalOrderId: order.id,
    externalOrderNumber: order.display_id,
    externalStoreId: order.store.id,
    currency,
    placedAt: new Date(order.placed_at),
    scheduledPickupAt: order.estimated_ready_for_pickup_at
      ? new Date(order.estimated_ready_for_pickup_at)
      : null,
    customerDisplayName: customerName(order),
    customerPhoneMasked: maskProviderPhone(order.eater?.phone),
    customerNote: nullableTrimmed(order.cart.special_instructions),
    items: order.cart.items.map((item) => ({
      externalItemId: item.instance_id,
      externalProductId: item.id,
      name: item.title,
      quantity: item.quantity,
      unitPrice: assertProviderMinorAmount(item.price.unit_price.amount),
      totalPrice: assertProviderMinorAmount(item.price.total_price.amount),
      modifiers: (item.selected_modifier_groups ?? []).flatMap((group) =>
        (group.selected_items ?? []).map((modifier) => ({
          externalModifierId: modifier.instance_id ?? modifier.id,
          name: modifier.title,
          quantity: Math.max(1, modifier.quantity),
          unitPrice: assertProviderMinorAmount(modifier.price.unit_price.amount),
          totalPrice: assertProviderMinorAmount(modifier.price.total_price.amount),
        }))
      ),
      notes: nullableTrimmed(item.special_instructions),
    })),
    pricing: {
      subtotal: amount(charges.sub_total),
      platformDiscount: optionalAmount(charges.total_promotion_applied),
      merchantDiscount: 0,
      deliveryFee: optionalAmount(charges.delivery_fee),
      serviceFee: optionalAmount(charges.service_fee ?? charges.total_fee),
      tax: optionalAmount(charges.tax),
      total: amount(charges.total),
      merchantReceivable: amount(charges.total),
    },
    payment: {
      status: optionalAmount(charges.cash_amount_due) > 0
        ? "CASH_DUE_TO_MERCHANT"
        : "PAID_BY_PLATFORM",
      merchantCollectedCash: optionalAmount(charges.cash_amount_due) > 0,
    },
    fulfillment: {
      type: order.type === "PICK_UP" ? "PICKUP" : "DELIVERY",
    },
    providerMetadata: {
      currentState: order.current_state,
      fulfillmentType: order.type,
      brand: order.brand ?? "UBER_EATS",
    },
  };
}

function assertSingleCurrency(order: UberEatsOrder, currency: string) {
  const amounts = [
    order.payment.charges.total,
    order.payment.charges.sub_total,
    order.payment.charges.tax,
    order.payment.charges.total_fee,
    order.payment.charges.delivery_fee,
    order.payment.charges.service_fee,
    order.payment.charges.total_promotion_applied,
    order.payment.charges.cash_amount_due,
    ...order.cart.items.flatMap((item) => [
      item.price.unit_price,
      item.price.total_price,
      ...(item.selected_modifier_groups ?? []).flatMap((group) =>
        (group.selected_items ?? []).flatMap((modifier) => [
          modifier.price.unit_price,
          modifier.price.total_price,
        ])
      ),
    ]),
  ].filter((value): value is z.infer<typeof moneySchema> => Boolean(value));
  if (amounts.some((value) => value.currency_code !== currency)) throw contractError();
}

function customerName(order: UberEatsOrder) {
  const name = [order.eater?.first_name, order.eater?.last_name]
    .map((part) => nullableTrimmed(part))
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return name || null;
}

function maskProviderPhone(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 2 ? `***${digits.slice(-2)}` : null;
}

function amount(value: z.infer<typeof moneySchema>) {
  return assertProviderMinorAmount(value.amount);
}

function optionalAmount(value: z.infer<typeof moneySchema> | undefined) {
  return value ? amount(value) : 0;
}

function nullableTrimmed(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function contractError() {
  return new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
}
