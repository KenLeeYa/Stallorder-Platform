import "server-only";

import { Prisma, type PrismaClient, type UserRole } from "@prisma/client";
import { staffOrderSelect } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import type { CreateStaffOrderInput } from "@/lib/staff-order-contract";
import { resolveStaffCheckout } from "@/lib/staff-checkout";
import { createOpaqueToken, hashToken } from "@/lib/security";

type OrderDataClient = Prisma.TransactionClient | PrismaClient;

export class StaffOrderCreateError extends Error {
  constructor(public readonly code:
    | "ORDER_LIMIT_EXCEEDED"
    | "PRODUCT_UNAVAILABLE"
    | "INVALID_PRODUCT_NOTES"
    | "TABLE_UNAVAILABLE"
    | "DELIVERY_UNAVAILABLE"
    | "ORDER_CONFLICT") {
    super(code);
  }
}

export async function createStaffOrder(input: {
  organizationId: string;
  stallId: string;
  actorProfileId: string;
  actorRoles: readonly UserRole[];
  request: CreateStaffOrderInput;
}) {
  const deviceHash = hashToken(`staff-order:${input.actorProfileId}`);
  const existing = await prisma.order.findFirst({
    where: {
      stallId: input.stallId,
      idempotencyKey: input.request.idempotencyKey,
      source: "STAFF_POS",
      deviceHash,
    },
    select: staffOrderSelect,
  });
  if (existing) return { order: existing, idempotent: true };

  const prepared = await prepareOrder(prisma, input.organizationId, input.stallId, input.request);
  const checkout = input.request.paymentTiming === "PAY_NOW"
    ? await resolveStaffCheckout({
        organizationId: input.organizationId,
        stallId: input.stallId,
        subtotals: [prepared.subtotal],
        actorProfileId: input.actorProfileId,
        actorRoles: input.actorRoles,
        request: input.request.checkout ?? {},
      })
    : null;
  const createdAt = new Date();

  try {
    const order = await prisma.$transaction(async (transaction) => {
      const current = await prepareOrder(
        transaction,
        input.organizationId,
        input.stallId,
        input.request,
      );
      if (JSON.stringify(current) !== JSON.stringify(prepared)) {
        throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");
      }

      const [businessDateRow] = await transaction.$queryRaw<Array<{ business_date: Date }>>`
        select public.stall_business_date(${input.stallId}::uuid, now()) as business_date
      `;
      if (!businessDateRow) throw new StaffOrderCreateError("ORDER_CONFLICT");
      const counter = await transaction.stallOrderCounter.upsert({
        where: {
          stallId_businessDate: {
            stallId: input.stallId,
            businessDate: businessDateRow.business_date,
          },
        },
        create: {
          stallId: input.stallId,
          organizationId: input.organizationId,
          businessDate: businessDateRow.business_date,
          nextValue: 2,
        },
        update: { nextValue: { increment: 1 } },
        select: { nextValue: true },
      });
      const orderNo = `${businessDateRow.business_date.toISOString().slice(2, 10).replaceAll("-", "")}-${String(counter.nextValue - 1).padStart(3, "0")}`;
      const total = checkout?.total ?? prepared.subtotal;

      return transaction.order.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          orderNo,
          trackingTokenHash: hashToken(createOpaqueToken()),
          idempotencyKey: input.request.idempotencyKey,
          source: "STAFF_POS",
          customerName: input.request.customerName || "現場顧客",
          customerPhone: input.request.customerPhone || null,
          deliveryAddress: input.request.fulfillmentType === "DELIVERY"
            ? input.request.deliveryAddress
            : null,
          tableLabel: prepared.tableLabel,
          diningTableId: prepared.diningTableId,
          fulfillmentType: input.request.fulfillmentType,
          note: input.request.customerNote || null,
          status: "CONFIRMED",
          paymentStatus: checkout ? "PAID" : "UNPAID",
          subtotal: prepared.subtotal,
          discountAmount: checkout?.discountAmount ?? 0,
          discountOptionId: checkout?.discountOptionId,
          discountLabel: checkout?.discountLabel,
          discountRateBps: checkout?.discountRateBps,
          discountAppliedById: checkout?.discountAppliedById,
          discountApprovedById: checkout?.discountApprovedById,
          discountApprovalReason: checkout?.discountApprovalReason,
          total,
          deviceHash,
          pickupCodeHash: null,
          confirmationExpiresAt: createdAt,
          confirmedAt: createdAt,
          paidAt: checkout ? createdAt : null,
          items: {
            create: prepared.items.map((item) => ({
              organizationId: input.organizationId,
              stallId: input.stallId,
              productId: item.productId,
              name: item.name,
              baseUnitPrice: item.baseUnitPrice,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              note: item.note,
              noteOptions: {
                create: item.noteOptions.map((option) => ({
                  organizationId: input.organizationId,
                  stallId: input.stallId,
                  noteGroupId: option.noteGroupId,
                  noteOptionId: option.noteOptionId,
                  groupName: option.groupName,
                  optionName: option.optionName,
                  priceDelta: option.priceDelta,
                  sortOrder: option.sortOrder,
                })),
              },
            })),
          },
          events: {
            create: {
              organizationId: input.organizationId,
              stallId: input.stallId,
              eventType: checkout ? "STAFF_ORDER_CREATED_PAID" : "STAFF_ORDER_CREATED",
              previousStatus: null,
              newStatus: "CONFIRMED",
              createdBy: input.actorProfileId,
            },
          },
          payment: checkout ? {
            create: {
              organizationId: input.organizationId,
              stallId: input.stallId,
              paymentOptionId: checkout.paymentOptionId,
              amount: checkout.total,
              method: checkout.method,
              status: "PAID",
              methodLabel: checkout.methodLabel,
              cashReceived: checkout.cashReceived,
              changeAmount: checkout.changeAmount,
              recordedById: input.actorProfileId,
              paidAt: createdAt,
            },
          } : undefined,
        },
        select: staffOrderSelect,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { order, idempotent: false };
  } catch (error) {
    if (error instanceof StaffOrderCreateError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await prisma.order.findFirst({
        where: {
          stallId: input.stallId,
          idempotencyKey: input.request.idempotencyKey,
          source: "STAFF_POS",
          deviceHash,
        },
        select: staffOrderSelect,
      });
      if (replay) return { order: replay, idempotent: true };
      throw new StaffOrderCreateError("ORDER_CONFLICT");
    }
    throw error;
  }
}

async function prepareOrder(
  client: OrderDataClient,
  organizationId: string,
  stallId: string,
  request: CreateStaffOrderInput,
) {
  const now = new Date();
  const [settings, assignments] = await Promise.all([
    client.stallOrderingSettings.findUnique({
      where: { stallId },
      select: {
        dineInEnabled: true,
        deliveryModuleEnabled: true,
        maxItemQuantity: true,
        maxUniqueProducts: true,
        maxTotalQuantity: true,
        maxNoteLength: true,
      },
    }),
    client.stallProduct.findMany({
      where: {
        organizationId,
        stallId,
        productId: { in: request.items.map((item) => item.productId) },
        isEnabled: true,
        isSoldOut: false,
        OR: [{ availableFrom: null }, { availableFrom: { lte: now } }],
        AND: [{ OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] }],
        product: { isActive: true, category: { isActive: true } },
      },
      select: {
        productId: true,
        priceOverride: true,
        product: {
          select: {
            name: true,
            defaultPrice: true,
            noteGroupAssignments: {
              where: { isActive: true, noteGroup: { isActive: true } },
              orderBy: [{ sortOrder: "asc" }, { noteGroup: { sortOrder: "asc" } }],
              select: {
                noteGroup: {
                  select: {
                    id: true,
                    name: true,
                    minSelections: true,
                    maxSelections: true,
                    options: {
                      where: { isActive: true },
                      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                      select: { id: true, name: true, priceDelta: true, sortOrder: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  if (!settings) throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");
  const totalQuantity = request.items.reduce((sum, item) => sum + item.quantity, 0);
  if (
    request.items.length > settings.maxUniqueProducts
    || totalQuantity > settings.maxTotalQuantity
    || request.items.some((item) => item.quantity > settings.maxItemQuantity || item.note.length > settings.maxNoteLength)
    || request.customerNote.length > settings.maxNoteLength
  ) throw new StaffOrderCreateError("ORDER_LIMIT_EXCEEDED");
  if (assignments.length !== request.items.length) {
    throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");
  }

  let diningTableId: string | null = null;
  let tableLabel: string | null = null;
  if (request.fulfillmentType === "DINE_IN") {
    if (!settings.dineInEnabled) throw new StaffOrderCreateError("TABLE_UNAVAILABLE");
    const table = await client.diningTable.findFirst({
      where: { id: request.diningTableId, organizationId, stallId, isActive: true },
      select: { id: true, label: true },
    });
    if (!table) throw new StaffOrderCreateError("TABLE_UNAVAILABLE");
    diningTableId = table.id;
    tableLabel = table.label;
  } else if (request.fulfillmentType === "DELIVERY" && !settings.deliveryModuleEnabled) {
    throw new StaffOrderCreateError("DELIVERY_UNAVAILABLE");
  }

  const assignmentsByProduct = new Map(assignments.map((assignment) => [assignment.productId, assignment]));
  const items = request.items.map((requested) => {
    const assignment = assignmentsByProduct.get(requested.productId);
    if (!assignment) throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");
    const selectedIds = new Set(requested.noteOptionIds);
    const allowedIds = new Set(
      assignment.product.noteGroupAssignments.flatMap(({ noteGroup }) => noteGroup.options.map((option) => option.id)),
    );
    if ([...selectedIds].some((optionId) => !allowedIds.has(optionId))) {
      throw new StaffOrderCreateError("INVALID_PRODUCT_NOTES");
    }

    const noteOptions = assignment.product.noteGroupAssignments.flatMap(({ noteGroup }, groupIndex) => {
      const selected = noteGroup.options.filter((option) => selectedIds.has(option.id));
      if (
        selected.length < noteGroup.minSelections
        || (noteGroup.maxSelections !== null && selected.length > noteGroup.maxSelections)
      ) throw new StaffOrderCreateError("INVALID_PRODUCT_NOTES");
      return selected.map((option) => ({
        noteGroupId: noteGroup.id,
        noteOptionId: option.id,
        groupName: noteGroup.name,
        optionName: option.name,
        priceDelta: option.priceDelta,
        sortOrder: groupIndex * 1000 + option.sortOrder,
      }));
    });
    const baseUnitPrice = assignment.priceOverride ?? assignment.product.defaultPrice;
    const unitPrice = Math.max(0, baseUnitPrice + noteOptions.reduce((sum, option) => sum + option.priceDelta, 0));
    return {
      productId: requested.productId,
      name: assignment.product.name,
      baseUnitPrice,
      unitPrice,
      quantity: requested.quantity,
      note: requested.note || null,
      noteOptions,
    };
  });

  return {
    diningTableId,
    tableLabel,
    subtotal: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    items,
  };
}
