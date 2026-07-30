import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createOpaqueToken, hashToken } from "@/lib/security";
import { prisma } from "@/lib/prisma";
import { DeliveryPlatformError } from "./delivery-platform-errors";
import type {
  DeliveryCircuitSource,
  NormalizedExternalOrder,
} from "./delivery-platform-types";
import { assertDeliveryWriter } from "./writer-guard";

type ImportJobInput = {
  externalOrderLedgerId: string;
  webhookEventId: string | null;
  order: NormalizedExternalOrder;
};

type PreparedOrderItem = {
  productId: string;
  name: string;
  baseUnitPrice: number;
  unitPrice: number;
  quantity: number;
  note: string | null;
  noteOptions: Array<{
    noteGroupId: string;
    noteOptionId: string;
    groupName: string;
    optionName: string;
    priceDelta: number;
    sortOrder: number;
  }>;
};

export async function importExternalOrderFromJob(
  input: ImportJobInput,
  context: { jobId: string; circuit: DeliveryCircuitSource },
) {
  const outcome = await prisma.$transaction(async (transaction) => {
    await assertDeliveryWriter(transaction);
    await transaction.$queryRaw`
      select id
      from public.external_orders
      where id = ${input.externalOrderLedgerId}::uuid
      for update
    `;
    const externalOrder = await transaction.externalOrder.findUnique({
      where: { id: input.externalOrderLedgerId },
    });
    if (!externalOrder) {
      throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
    }
    if (externalOrder.internalOrderId) {
      return {
        status: "IMPORTED" as const,
        orderId: externalOrder.internalOrderId,
        idempotent: true,
      };
    }
    if (
      externalOrder.provider !== input.order.provider
      || externalOrder.externalOrderId !== input.order.externalOrderId
      || externalOrder.externalStoreId !== input.order.externalStoreId
    ) {
      throw new DeliveryPlatformError("UNSUPPORTED_MAPPING", { retryable: false });
    }

    const connection = await transaction.deliveryPlatformConnection.findFirst({
      where: {
        id: externalOrder.connectionId,
        organizationId: externalOrder.organizationId,
        stallId: externalOrder.stallId,
        provider: externalOrder.provider,
        status: "ACTIVE",
      },
    });
    const [stall, settings, storeMapping] = await Promise.all([
      transaction.stall.findFirst({
        where: {
          id: externalOrder.stallId,
          organizationId: externalOrder.organizationId,
          isActive: true,
        },
        select: { id: true, currency: true },
      }),
      transaction.stallOrderingSettings.findUnique({
        where: { stallId: externalOrder.stallId },
        select: { unconfirmedOrderTimeoutSeconds: true },
      }),
      transaction.externalStoreMapping.findFirst({
        where: {
          connectionId: externalOrder.connectionId,
          organizationId: externalOrder.organizationId,
          stallId: externalOrder.stallId,
          provider: externalOrder.provider,
          externalStoreId: input.order.externalStoreId,
          mappingStatus: "VERIFIED",
        },
        select: { id: true },
      }),
    ]);
    if (!connection || !stall || !settings || !storeMapping) {
      return markMappingRequired(transaction, externalOrder, input.webhookEventId, "STORE_MAPPING_REQUIRED");
    }
    if (
      stall.currency !== input.order.currency
      || input.order.payment.merchantCollectedCash
    ) {
      return markMappingRequired(transaction, externalOrder, input.webhookEventId, "PAYMENT_MAPPING_REQUIRED");
    }

    const preparedItems = await prepareMappedItems(
      transaction,
      externalOrder.organizationId,
      externalOrder.stallId,
      externalOrder.connectionId,
      input.order,
    );
    if (!preparedItems) {
      return markMappingRequired(transaction, externalOrder, input.webhookEventId, "MENU_MAPPING_REQUIRED");
    }

    const [businessDateRow] = await transaction.$queryRaw<Array<{ business_date: Date }>>`
      select public.stall_business_date(${externalOrder.stallId}::uuid, now()) as business_date
    `;
    if (!businessDateRow) {
      throw new DeliveryPlatformError("PROVIDER_UNAVAILABLE", { retryable: true });
    }
    const counter = await transaction.stallOrderCounter.upsert({
      where: {
        stallId_businessDate: {
          stallId: externalOrder.stallId,
          businessDate: businessDateRow.business_date,
        },
      },
      create: {
        stallId: externalOrder.stallId,
        organizationId: externalOrder.organizationId,
        businessDate: businessDateRow.business_date,
        nextValue: 2,
      },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    const orderNo = `${businessDateRow.business_date.toISOString().slice(2, 10).replaceAll("-", "")}-${String(counter.nextValue - 1).padStart(3, "0")}`;
    const now = new Date();
    const platformDiscount = input.order.pricing.platformDiscount;
    const merchantDiscount = input.order.pricing.merchantDiscount;
    const internalTotal = Math.max(
      0,
      input.order.pricing.subtotal - platformDiscount - merchantDiscount,
    );
    const isTest = input.order.provider === "MOCK";
    const canonical = await transaction.order.create({
      data: {
        organizationId: externalOrder.organizationId,
        stallId: externalOrder.stallId,
        orderNo,
        trackingTokenHash: hashToken(createOpaqueToken()),
        idempotencyKey: deterministicExternalOrderUuid(
          `${input.order.provider}:${input.order.externalOrderId}`,
        ),
        source: input.order.provider,
        origin: "IMPORTED",
        isTest,
        externalProvider: input.order.provider,
        externalOrderId: input.order.externalOrderId,
        externalOrderNumber: input.order.externalOrderNumber,
        externalStoreId: input.order.externalStoreId,
        externalPaymentStatus: input.order.payment.status,
        externalSubtotalAmount: input.order.pricing.subtotal,
        externalTotalAmount: input.order.pricing.total,
        merchantReceivableAmount: input.order.pricing.merchantReceivable,
        platformDiscountAmount: platformDiscount,
        merchantDiscountAmount: merchantDiscount,
        scheduledPickupAt: input.order.scheduledPickupAt,
        customerName: input.order.customerDisplayName
          || input.order.externalOrderNumber
          || "外送平台顧客",
        customerPhone: null,
        fulfillmentType: input.order.fulfillment.type === "DELIVERY" ? "DELIVERY" : "TAKEOUT",
        note: input.order.customerNote,
        status: "WAITING_CONFIRMATION",
        paymentStatus: "PENDING_RECONCILIATION",
        subtotal: input.order.pricing.subtotal,
        discountAmount: platformDiscount + merchantDiscount,
        total: internalTotal,
        deviceHash: hashToken(`delivery:${input.order.provider}:${input.order.externalStoreId}`),
        pickupCodeHash: null,
        confirmationExpiresAt: new Date(
          now.getTime() + settings.unconfirmedOrderTimeoutSeconds * 1000,
        ),
        items: {
          create: preparedItems.map((item) => ({
            organizationId: externalOrder.organizationId,
            stallId: externalOrder.stallId,
            productId: item.productId,
            name: item.name,
            baseUnitPrice: item.baseUnitPrice,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            note: item.note,
            noteOptions: {
              create: item.noteOptions.map((option) => ({
                organizationId: externalOrder.organizationId,
                stallId: externalOrder.stallId,
                ...option,
              })),
            },
          })),
        },
        events: {
          create: {
            organizationId: externalOrder.organizationId,
            stallId: externalOrder.stallId,
            eventType: "DELIVERY_ORDER_IMPORTED",
            previousStatus: null,
            newStatus: "WAITING_CONFIRMATION",
          },
        },
      },
      select: { id: true, orderNo: true },
    });

    await Promise.all([
      transaction.externalOrder.update({
        where: { id: externalOrder.id },
        data: {
          internalOrderId: canonical.id,
          processingStatus: "IMPORTED",
          externalStatus: "PENDING_CONFIRMATION",
          lastSyncedAt: now,
        },
      }),
      input.webhookEventId
        ? transaction.deliveryWebhookEvent.updateMany({
            where: {
              id: input.webhookEventId,
              connectionId: externalOrder.connectionId,
            },
            data: {
              processingStatus: "PROCESSED",
              processedAt: now,
              nextAttemptAt: null,
              lastErrorCode: null,
              lastErrorMessageSafe: null,
            },
          })
        : Promise.resolve(),
      transaction.auditLog.create({
        data: {
          organizationId: externalOrder.organizationId,
          stallId: externalOrder.stallId,
          action: "DELIVERY_ORDER_IMPORTED",
          entityType: "ORDER",
          entityId: canonical.id,
          outcome: "SUCCESS",
          requestId: `delivery-job:${context.jobId}`,
          afterJson: {
            provider: input.order.provider,
            externalOrderLedgerId: externalOrder.id,
            circuit: context.circuit,
            isTest,
          },
        },
      }),
    ]);
    return { status: "IMPORTED" as const, orderId: canonical.id, orderNo, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (outcome.status === "MAPPING_REQUIRED") {
    throw new DeliveryPlatformError("MAPPING_REQUIRED", { retryable: false });
  }
  return outcome;
}

async function prepareMappedItems(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  stallId: string,
  connectionId: string,
  order: NormalizedExternalOrder,
): Promise<PreparedOrderItem[] | null> {
  const externalProductIds = order.items.map((item) => item.externalProductId);
  const externalModifierIds = order.items.flatMap(
    (item) => item.modifiers.map((modifier) => modifier.externalModifierId),
  );
  const mappings = await transaction.externalMenuMapping.findMany({
    where: {
      organizationId,
      stallId,
      connectionId,
      mappingStatus: { in: ["MAPPED", "SYNCED"] },
      OR: [
        {
          internalEntityType: "PRODUCT",
          externalEntityId: { in: externalProductIds },
        },
        {
          internalEntityType: "MODIFIER_ITEM",
          externalEntityId: { in: externalModifierIds },
        },
      ],
    },
    select: {
      internalEntityType: true,
      internalEntityId: true,
      externalEntityId: true,
    },
  });
  const productMappings = new Map(
    mappings
      .filter((mapping) => mapping.internalEntityType === "PRODUCT")
      .map((mapping) => [mapping.externalEntityId, mapping.internalEntityId]),
  );
  const modifierMappings = new Map(
    mappings
      .filter((mapping) => mapping.internalEntityType === "MODIFIER_ITEM")
      .map((mapping) => [mapping.externalEntityId, mapping.internalEntityId]),
  );
  if (
    externalProductIds.some((id) => !productMappings.has(id))
    || externalModifierIds.some((id) => !modifierMappings.has(id))
  ) return null;

  const productIds = [...new Set(productMappings.values())];
  const modifierIds = [...new Set(modifierMappings.values())];
  const [products, options, assignments] = await Promise.all([
    transaction.stallProduct.findMany({
      where: {
        organizationId,
        stallId,
        productId: { in: productIds },
        isEnabled: true,
        isSoldOut: false,
        product: { isActive: true },
      },
      select: {
        productId: true,
        product: { select: { id: true } },
      },
    }),
    transaction.productNoteOption.findMany({
      where: {
        organizationId,
        id: { in: modifierIds },
        isActive: true,
        noteGroup: { isActive: true },
      },
      select: {
        id: true,
        name: true,
        priceDelta: true,
        sortOrder: true,
        noteGroup: { select: { id: true, name: true } },
      },
    }),
    transaction.productNoteGroupAssignment.findMany({
      where: {
        organizationId,
        productId: { in: productIds },
        isActive: true,
      },
      select: { productId: true, noteGroupId: true },
    }),
  ]);
  if (products.length !== productIds.length || options.length !== modifierIds.length) return null;
  const activeProducts = new Set(products.map((product) => product.productId));
  const optionsById = new Map(options.map((option) => [option.id, option]));
  const assignedGroupsByProduct = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const current = assignedGroupsByProduct.get(assignment.productId) ?? new Set<string>();
    current.add(assignment.noteGroupId);
    assignedGroupsByProduct.set(assignment.productId, current);
  }

  const prepared: PreparedOrderItem[] = [];
  for (const item of order.items) {
    const productId = productMappings.get(item.externalProductId);
    if (!productId || !activeProducts.has(productId)) return null;
    const noteOptions = [];
    for (const [index, modifier] of item.modifiers.entries()) {
      const optionId = modifierMappings.get(modifier.externalModifierId);
      const option = optionId ? optionsById.get(optionId) : null;
      if (
        !option
        || !assignedGroupsByProduct.get(productId)?.has(option.noteGroup.id)
      ) return null;
      noteOptions.push({
        noteGroupId: option.noteGroup.id,
        noteOptionId: option.id,
        groupName: option.noteGroup.name,
        optionName: modifier.name,
        priceDelta: modifier.unitPrice,
        sortOrder: index,
      });
    }
    const derivedUnitPrice = Math.round(item.totalPrice / item.quantity);
    prepared.push({
      productId,
      name: item.name,
      baseUnitPrice: item.unitPrice,
      unitPrice: derivedUnitPrice,
      quantity: item.quantity,
      note: item.notes,
      noteOptions,
    });
  }
  return prepared;
}

async function markMappingRequired(
  transaction: Prisma.TransactionClient,
  externalOrder: {
    id: string;
    organizationId: string;
    stallId: string;
    connectionId: string;
  },
  webhookEventId: string | null,
  reason: string,
) {
  const now = new Date();
  await transaction.externalOrder.update({
    where: { id: externalOrder.id },
    data: { processingStatus: "MAPPING_REQUIRED" },
  });
  if (webhookEventId) {
    await transaction.deliveryWebhookEvent.updateMany({
      where: { id: webhookEventId, connectionId: externalOrder.connectionId },
      data: {
        processingStatus: "DEAD_LETTER",
        processedAt: now,
        lastErrorCode: "MAPPING_REQUIRED",
        lastErrorMessageSafe: reason,
      },
    });
  }
  const existingAlert = await transaction.operationalAlert.findFirst({
    where: {
      organizationId: externalOrder.organizationId,
      stallId: externalOrder.stallId,
      alertType: "DELIVERY_ORDER_MAPPING_REQUIRED",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!existingAlert) {
    await transaction.operationalAlert.create({
      data: {
        organizationId: externalOrder.organizationId,
        stallId: externalOrder.stallId,
        alertType: "DELIVERY_ORDER_MAPPING_REQUIRED",
        severity: "WARNING",
        message: "外送平台訂單缺少必要對應，請由授權管理者完成商品與註記設定。",
        detectedAt: now,
      },
    });
  }
  return { status: "MAPPING_REQUIRED" as const, reason };
}

export function deterministicExternalOrderUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
