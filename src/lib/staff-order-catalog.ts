import "server-only";

import { prisma } from "@/lib/prisma";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";

export async function getStaffOrderPageConfiguration(
  stallId: string,
  organizationId: string,
  includeCatalog: boolean,
) {
  const now = new Date();
  const [assignments, tables, settings] = await Promise.all([
    includeCatalog ? prisma.stallProduct.findMany({
      where: {
        stallId,
        organizationId,
        isEnabled: true,
        isSoldOut: false,
        OR: [{ availableFrom: null }, { availableFrom: { lte: now } }],
        AND: [{ OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] }],
        product: { isActive: true, category: { isActive: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { product: { sortOrder: "asc" } }],
      select: {
        priceOverride: true,
        product: {
          select: {
            id: true,
            name: true,
            description: true,
            defaultPrice: true,
            imageUrl: true,
            category: { select: { name: true } },
            noteGroupAssignments: {
              where: { isActive: true, noteGroup: { isActive: true } },
              orderBy: [{ sortOrder: "asc" }, { noteGroup: { sortOrder: "asc" } }],
              select: {
                noteGroup: {
                  select: {
                    id: true,
                    name: true,
                    selectionMode: true,
                    isRequired: true,
                    minSelections: true,
                    maxSelections: true,
                    options: {
                      where: { isActive: true },
                      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                      select: { id: true, name: true, priceDelta: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }) : Promise.resolve([]),
    includeCatalog ? prisma.diningTable.findMany({
      where: { stallId, organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true },
    }) : Promise.resolve([]),
    includeCatalog ? prisma.stallOrderingSettings.findUniqueOrThrow({
      where: { stallId },
      select: {
        dineInEnabled: true,
        deliveryModuleEnabled: true,
        printModuleEnabled: true,
        paymentModuleEnabled: true,
        discountModuleEnabled: true,
        discountApprovalThresholdBps: true,
        maxItemQuantity: true,
        maxUniqueProducts: true,
        maxTotalQuantity: true,
        maxNoteLength: true,
      },
    }) : prisma.stallOrderingSettings.findUnique({
      where: { stallId },
      select: {
        dineInEnabled: true,
        deliveryModuleEnabled: true,
        printModuleEnabled: true,
        paymentModuleEnabled: true,
        discountModuleEnabled: true,
        discountApprovalThresholdBps: true,
        maxItemQuantity: true,
        maxUniqueProducts: true,
        maxTotalQuantity: true,
        maxNoteLength: true,
      },
    }),
  ]);

  return {
    modules: {
      dineIn: settings?.dineInEnabled ?? false,
      delivery: settings?.deliveryModuleEnabled ?? false,
      print: settings?.printModuleEnabled ?? false,
      payment: settings?.paymentModuleEnabled ?? false,
      discount: settings?.discountModuleEnabled ?? false,
      discountApprovalThresholdBps: settings?.discountApprovalThresholdBps ?? 8000,
    },
    catalog: includeCatalog && settings ? {
      products: assignments.map((assignment) => ({
        id: assignment.product.id,
        name: assignment.product.name,
        description: assignment.product.description,
        category: assignment.product.category.name,
        price: assignment.priceOverride ?? assignment.product.defaultPrice,
        imageUrl: assignment.product.imageUrl,
        noteGroups: assignment.product.noteGroupAssignments.map(({ noteGroup }) => noteGroup),
      })),
      tables,
      limits: {
        maxItemQuantity: settings.maxItemQuantity,
        maxUniqueProducts: settings.maxUniqueProducts,
        maxTotalQuantity: settings.maxTotalQuantity,
        maxNoteLength: settings.maxNoteLength,
      },
    } satisfies StaffOrderCatalog : null,
  };
}
