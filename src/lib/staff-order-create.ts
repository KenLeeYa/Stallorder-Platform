import "server-only";

import { Prisma, type PrismaClient, type ProductKind, type UserRole } from "@prisma/client";
import { calculateCapacitySnapshot } from "@/lib/capacity";
import {
  CashShiftOperationError,
  requireOpenCashShift,
} from "@/lib/cash-shifts";
import { staffOrderSelect } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getStaffFulfillmentError } from "@/lib/staff-fulfillment";
import type { CreateStaffOrderInput } from "@/lib/staff-order-contract";
import { resolveStaffCheckout } from "@/lib/staff-checkout";
import { createOpaqueToken, hashToken } from "@/lib/security";

type OrderDataClient = Prisma.TransactionClient | PrismaClient;

export type TrustedStaffOrderAssignment = {
  productId: string;
  priceOverride: number | null;
  product: {
    organizationId: string;
    name: string;
    defaultPrice: number;
    kind: ProductKind;
    noteGroupAssignments: Array<{
      noteGroup: {
        id: string;
        name: string;
        minSelections: number;
        maxSelections: number | null;
        options: Array<{
          id: string;
          name: string;
          priceDelta: number;
          sortOrder: number;
        }>;
      };
    }>;
    bundleChoiceGroups: Array<{
      id: string;
      organizationId: string;
      bundleProductId: string;
      name: string;
      minSelections: number;
      maxSelections: number;
      choices: Array<{
        id: string;
        organizationId: string;
        choiceGroupId: string;
        quantity: number;
        priceDelta: number;
        isEnabled: boolean;
        componentProduct: {
          organizationId: string;
          name: string;
          kind: ProductKind;
          isActive: boolean;
          category: { isActive: boolean };
          stallProducts: Array<{
            organizationId: string;
            stallId: string;
            isEnabled: boolean;
            isSoldOut: boolean;
            availableFrom: Date | null;
            availableUntil: Date | null;
          }>;
        };
      }>;
    }>;
  };
};

export class StaffOrderCreateError extends Error {
  constructor(public readonly code:
    | "ORDER_LIMIT_EXCEEDED"
    | "PRODUCT_UNAVAILABLE"
    | "INVALID_PRODUCT_NOTES"
    | "TABLE_UNAVAILABLE"
    | "DELIVERY_UNAVAILABLE"
    | "ACTIVE_SHIFT_REQUIRED"
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
  creationMode?: "STAFF_POS" | "SETUP_TEST";
}) {
  const creationMode = input.creationMode ?? "STAFF_POS";
  const source = creationMode === "SETUP_TEST" ? "MERCHANT_SETUP_TEST" : "STAFF_POS";
  const deviceHash = hashToken(`staff-order:${input.actorProfileId}:${creationMode}`);
  const existing = await prisma.order.findFirst({
    where: {
      stallId: input.stallId,
      idempotencyKey: input.request.idempotencyKey,
      source,
      deviceHash,
    },
    select: staffOrderSelect,
  });
  if (existing) return { order: existing, idempotent: true };

  const prepared = await prepareOrder(prisma, input.organizationId, input.stallId, input.request);
  const checkout = creationMode === "STAFF_POS" && input.request.paymentTiming === "PAY_NOW"
    ? await resolveStaffCheckout({
        organizationId: input.organizationId,
        stallId: input.stallId,
        subtotals: [prepared.subtotal],
        actorProfileId: input.actorProfileId,
        actorRoles: input.actorRoles,
        request: input.request.checkout ?? {},
      })
    : null;
  const capacity = await calculateCapacitySnapshot(
    input.stallId,
    input.request.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
  );
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
      const isSetupTest = creationMode === "SETUP_TEST";
      const initialStatus = isSetupTest ? "WAITING_CONFIRMATION" : "CONFIRMED";
      const cashShiftId = checkout?.method === "CASH"
        ? await requireOpenCashShift(transaction, input.organizationId, input.stallId)
        : null;

      const order = await transaction.order.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          orderNo,
          trackingTokenHash: hashToken(createOpaqueToken()),
          idempotencyKey: input.request.idempotencyKey,
          source,
          origin: isSetupTest ? "TEST" : "ONLINE_STAFF",
          isTest: isSetupTest,
          customerName: input.request.customerName || "現場顧客",
          customerPhone: input.request.customerPhone || null,
          deliveryAddress: input.request.fulfillmentType === "DELIVERY"
            ? input.request.deliveryAddress
            : null,
          tableLabel: prepared.tableLabel,
          diningTableId: prepared.diningTableId,
          fulfillmentType: input.request.fulfillmentType,
          note: input.request.customerNote || null,
          status: initialStatus,
          paymentStatus: isSetupTest || checkout ? "PAID" : "UNPAID",
          subtotal: prepared.subtotal,
          discountAmount: checkout?.discountAmount ?? 0,
          discountSource: checkout?.discountOptionId ? "STAFF" : "NONE",
          discountOptionId: checkout?.discountOptionId,
          discountLabel: checkout?.discountLabel,
          discountRateBps: checkout?.discountRateBps,
          discountAppliedById: checkout?.discountAppliedById,
          discountApprovedById: checkout?.discountApprovedById,
          discountApprovalReason: checkout?.discountApprovalReason,
          total,
          quotedWaitMinutes: capacity.quoteMaxMinutes,
          quotedReadyAt: new Date(createdAt.getTime() + capacity.quoteMaxMinutes * 60_000),
          deviceHash,
          pickupCodeHash: null,
          confirmationExpiresAt: isSetupTest
            ? new Date(createdAt.getTime() + prepared.unconfirmedOrderTimeoutSeconds * 1000)
            : createdAt,
          confirmedAt: isSetupTest ? null : createdAt,
          paidAt: isSetupTest || checkout ? createdAt : null,
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
              eventType: isSetupTest ? "MERCHANT_SETUP_TEST_ORDER_CREATED" : checkout ? "STAFF_ORDER_CREATED_PAID" : "STAFF_ORDER_CREATED",
              previousStatus: null,
              newStatus: initialStatus,
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
              cashShiftId,
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
      await transaction.$queryRaw`
        select public.refresh_stall_capacity(
          ${input.stallId}::uuid,
          true,
          'STAFF_ORDER_CREATED'
        )
      `;
      return order;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { order, idempotent: false };
  } catch (error) {
    if (error instanceof StaffOrderCreateError) throw error;
    if (error instanceof CashShiftOperationError && error.code === "ACTIVE_SHIFT_REQUIRED") {
      throw new StaffOrderCreateError("ACTIVE_SHIFT_REQUIRED");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await prisma.order.findFirst({
        where: {
          stallId: input.stallId,
          idempotencyKey: input.request.idempotencyKey,
          source,
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

export function prepareTrustedStaffOrderItem(input: {
  organizationId: string;
  stallId: string;
  now: Date;
  assignment: TrustedStaffOrderAssignment;
  requested: CreateStaffOrderInput["items"][number];
}) {
  const { organizationId, stallId, now, assignment, requested } = input;
  if (
    assignment.productId !== requested.productId
    || assignment.product.organizationId !== organizationId
  ) throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");

  const selectedBundleIds = new Set(requested.bundleChoiceIds);
  if (selectedBundleIds.size !== requested.bundleChoiceIds.length) {
    throw new StaffOrderCreateError("INVALID_PRODUCT_NOTES");
  }

  const bundleNoteOptions: Array<{
    noteGroupId: null;
    noteOptionId: null;
    groupName: string;
    optionName: string;
    priceDelta: number;
    sortOrder: number;
  }> = [];
  if (assignment.product.kind === "SINGLE") {
    if (selectedBundleIds.size > 0) {
      throw new StaffOrderCreateError("INVALID_PRODUCT_NOTES");
    }
  } else {
    const groups = assignment.product.bundleChoiceGroups;
    if (groups.length === 0) throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");
    const allChoiceIds = new Set(groups.flatMap((group) => group.choices.map((choice) => choice.id)));
    if ([...selectedBundleIds].some((choiceId) => !allChoiceIds.has(choiceId))) {
      throw new StaffOrderCreateError("INVALID_PRODUCT_NOTES");
    }

    groups.forEach((group, groupIndex) => {
      if (
        group.organizationId !== organizationId
        || group.bundleProductId !== requested.productId
      ) throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");
      const availableChoices = group.choices.filter((choice) => {
        const componentAssignment = choice.componentProduct.stallProducts.find((candidate) => (
          candidate.organizationId === organizationId && candidate.stallId === stallId
        ));
        return choice.organizationId === organizationId
          && choice.choiceGroupId === group.id
          && choice.isEnabled
          && choice.componentProduct.organizationId === organizationId
          && choice.componentProduct.kind === "SINGLE"
          && choice.componentProduct.isActive
          && choice.componentProduct.category.isActive
          && Boolean(componentAssignment?.isEnabled)
          && !componentAssignment?.isSoldOut
          && (!componentAssignment?.availableFrom || componentAssignment.availableFrom <= now)
          && (!componentAssignment?.availableUntil || componentAssignment.availableUntil > now);
      });
      if (availableChoices.length < group.minSelections) {
        throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");
      }
      const availableIds = new Set(availableChoices.map((choice) => choice.id));
      if (group.choices.some((choice) => (
        selectedBundleIds.has(choice.id) && !availableIds.has(choice.id)
      ))) throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");
      const selected = availableChoices.filter((choice) => selectedBundleIds.has(choice.id));
      if (
        selected.length < group.minSelections
        || selected.length > group.maxSelections
      ) throw new StaffOrderCreateError("INVALID_PRODUCT_NOTES");
      selected.forEach((choice, choiceIndex) => {
        bundleNoteOptions.push({
          noteGroupId: null,
          noteOptionId: null,
          groupName: `套餐 · ${group.name}`,
          optionName: `${choice.componentProduct.name} × ${choice.quantity}`,
          priceDelta: choice.priceDelta,
          sortOrder: groupIndex * 1000 + choiceIndex,
        });
      });
    });
  }

  const selectedNoteIds = new Set(requested.noteOptionIds);
  if (selectedNoteIds.size !== requested.noteOptionIds.length) {
    throw new StaffOrderCreateError("INVALID_PRODUCT_NOTES");
  }
  const allowedNoteIds = new Set(
    assignment.product.noteGroupAssignments.flatMap(({ noteGroup }) => (
      noteGroup.options.map((option) => option.id)
    )),
  );
  if ([...selectedNoteIds].some((optionId) => !allowedNoteIds.has(optionId))) {
    throw new StaffOrderCreateError("INVALID_PRODUCT_NOTES");
  }
  const productNoteOptions = assignment.product.noteGroupAssignments.flatMap(
    ({ noteGroup }, groupIndex) => {
      const selected = noteGroup.options.filter((option) => selectedNoteIds.has(option.id));
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
        sortOrder: (assignment.product.kind === "BUNDLE" ? 100_000 : 0)
          + groupIndex * 1000
          + option.sortOrder,
      }));
    },
  );
  const noteOptions = [...bundleNoteOptions, ...productNoteOptions];
  const baseUnitPrice = assignment.priceOverride ?? assignment.product.defaultPrice;
  const unitPrice = Math.max(
    0,
    baseUnitPrice + noteOptions.reduce((sum, option) => sum + option.priceDelta, 0),
  );
  return {
    productId: requested.productId,
    name: assignment.product.name,
    baseUnitPrice,
    unitPrice,
    quantity: requested.quantity,
    note: requested.note || null,
    noteOptions,
  };
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
        unconfirmedOrderTimeoutSeconds: true,
        dineInEnabled: true,
        staffDeliveryEnabled: true,
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
            organizationId: true,
            name: true,
            defaultPrice: true,
            kind: true,
            bundleChoiceGroups: {
              orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
              select: {
                id: true,
                organizationId: true,
                bundleProductId: true,
                name: true,
                minSelections: true,
                maxSelections: true,
                choices: {
                  orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                  select: {
                    id: true,
                    organizationId: true,
                    choiceGroupId: true,
                    quantity: true,
                    priceDelta: true,
                    isEnabled: true,
                    componentProduct: {
                      select: {
                        organizationId: true,
                        name: true,
                        kind: true,
                        isActive: true,
                        category: { select: { isActive: true } },
                        stallProducts: {
                          where: { organizationId, stallId },
                          select: {
                            organizationId: true,
                            stallId: true,
                            isEnabled: true,
                            isSoldOut: true,
                            availableFrom: true,
                            availableUntil: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
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
  const fulfillmentError = getStaffFulfillmentError(request.fulfillmentType, settings);
  if (fulfillmentError) throw new StaffOrderCreateError(fulfillmentError);
  if (request.fulfillmentType === "DINE_IN") {
    const table = await client.diningTable.findFirst({
      where: { id: request.diningTableId, organizationId, stallId, isActive: true },
      select: { id: true, label: true },
    });
    if (!table) throw new StaffOrderCreateError("TABLE_UNAVAILABLE");
    diningTableId = table.id;
    tableLabel = table.label;
  }

  const assignmentsByProduct = new Map(assignments.map((assignment) => [assignment.productId, assignment]));
  const items = request.items.map((requested) => {
    const assignment = assignmentsByProduct.get(requested.productId);
    if (!assignment) throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");
    return prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment,
      requested,
    });
  });

  return {
    unconfirmedOrderTimeoutSeconds: settings.unconfirmedOrderTimeoutSeconds,
    diningTableId,
    tableLabel,
    subtotal: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    items,
  };
}
