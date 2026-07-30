import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { NormalizedExternalOrder } from "./delivery-platform-types";

const moneySchema = z.number().int().min(0).max(100_000_000);
const identifierSchema = z.string().min(1).max(200);
const metadataValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const persistedOrderSchema = z.object({
  provider: z.enum(["UBER_EATS", "FOODPANDA", "MOCK"]),
  externalOrderId: identifierSchema,
  externalOrderNumber: z.string().min(1).max(120).nullable(),
  externalStoreId: identifierSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  placedAt: z.string().datetime({ offset: true }),
  scheduledPickupAt: z.string().datetime({ offset: true }).nullable(),
  customerDisplayName: z.string().max(120).nullable(),
  customerPhoneMasked: z.string().max(40).nullable(),
  customerNote: z.string().max(500).nullable(),
  items: z.array(z.object({
    externalItemId: identifierSchema,
    externalProductId: identifierSchema,
    name: z.string().min(1).max(200),
    quantity: z.number().int().min(1).max(100),
    unitPrice: moneySchema,
    totalPrice: moneySchema,
    modifiers: z.array(z.object({
      externalModifierId: identifierSchema,
      name: z.string().min(1).max(200),
      quantity: z.number().int().min(1).max(100),
      unitPrice: moneySchema,
      totalPrice: moneySchema,
    }).strict()).max(30),
    notes: z.string().max(500).nullable(),
  }).strict()).min(1).max(100),
  pricing: z.object({
    subtotal: moneySchema,
    platformDiscount: moneySchema,
    merchantDiscount: moneySchema,
    deliveryFee: moneySchema,
    serviceFee: moneySchema,
    tax: moneySchema,
    total: moneySchema,
    merchantReceivable: moneySchema,
  }).strict(),
  payment: z.object({
    status: z.string().min(1).max(80),
    merchantCollectedCash: z.boolean(),
  }).strict(),
  fulfillment: z.object({
    type: z.enum(["DELIVERY", "PICKUP"]),
  }).strict(),
  providerMetadata: z.record(z.string().max(80), metadataValueSchema),
}).strict();

export const deliveryOrderJobInputSchema = z.object({
  externalOrderLedgerId: z.string().uuid(),
  webhookEventId: z.string().uuid().nullable(),
  order: persistedOrderSchema,
}).strict();

export function serializeNormalizedExternalOrder(
  order: NormalizedExternalOrder,
): Prisma.InputJsonValue {
  return {
    ...order,
    placedAt: order.placedAt.toISOString(),
    scheduledPickupAt: order.scheduledPickupAt?.toISOString() ?? null,
  } as Prisma.InputJsonValue;
}

export function parseDeliveryOrderJobInput(value: Prisma.JsonValue) {
  const parsed = deliveryOrderJobInputSchema.parse(value);
  return {
    externalOrderLedgerId: parsed.externalOrderLedgerId,
    webhookEventId: parsed.webhookEventId,
    order: {
      ...parsed.order,
      placedAt: new Date(parsed.order.placedAt),
      scheduledPickupAt: parsed.order.scheduledPickupAt
        ? new Date(parsed.order.scheduledPickupAt)
        : null,
    } satisfies NormalizedExternalOrder,
  };
}
