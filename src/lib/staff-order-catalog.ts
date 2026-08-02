import "server-only";

import { prisma } from "@/lib/prisma";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";
import { getStaffFulfillmentModules } from "@/lib/staff-fulfillment";

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
            organizationId: true,
            name: true,
            description: true,
            defaultPrice: true,
            kind: true,
            imageUrl: true,
            category: { select: { name: true } },
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
        staffDeliveryEnabled: true,
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
        staffDeliveryEnabled: true,
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

  const fulfillmentModules = getStaffFulfillmentModules(settings);
  const catalogProducts = assignments.flatMap((assignment) => {
    const bundleChoiceGroups = assignment.product.bundleChoiceGroups.map((group) => ({
      id: group.id,
      name: group.name,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      choices: group.choices.flatMap((choice) => {
        const componentAssignment = choice.componentProduct.stallProducts[0];
        const isAvailable = choice.isEnabled
          && choice.organizationId === organizationId
          && choice.choiceGroupId === group.id
          && group.organizationId === organizationId
          && group.bundleProductId === assignment.product.id
          && choice.componentProduct.organizationId === organizationId
          && choice.componentProduct.kind === "SINGLE"
          && choice.componentProduct.isActive
          && choice.componentProduct.category.isActive
          && componentAssignment?.organizationId === organizationId
          && componentAssignment.stallId === stallId
          && componentAssignment.isEnabled
          && !componentAssignment.isSoldOut
          && (!componentAssignment.availableFrom || componentAssignment.availableFrom <= now)
          && (!componentAssignment.availableUntil || componentAssignment.availableUntil > now);
        return isAvailable ? [{
          id: choice.id,
          name: choice.componentProduct.name,
          quantity: choice.quantity,
          priceDelta: choice.priceDelta,
        }] : [];
      }),
    }));
    if (assignment.product.organizationId !== organizationId) return [];
    if (
      assignment.product.kind === "BUNDLE"
      && (
        bundleChoiceGroups.length === 0
        || bundleChoiceGroups.some((group) => (
          group.choices.length < group.minSelections
        ))
      )
    ) return [];

    return [{
      id: assignment.product.id,
      name: assignment.product.name,
      description: assignment.product.description,
      category: assignment.product.category.name,
      price: assignment.priceOverride ?? assignment.product.defaultPrice,
      kind: assignment.product.kind,
      bundleChoiceGroups: assignment.product.kind === "BUNDLE" ? bundleChoiceGroups : [],
      imageUrl: assignment.product.imageUrl,
      noteGroups: assignment.product.noteGroupAssignments.map(({ noteGroup }) => noteGroup),
    }];
  });

  return {
    modules: {
      ...fulfillmentModules,
      print: settings?.printModuleEnabled ?? false,
      payment: settings?.paymentModuleEnabled ?? false,
      discount: settings?.discountModuleEnabled ?? false,
      discountApprovalThresholdBps: settings?.discountApprovalThresholdBps ?? 8000,
    },
    catalog: includeCatalog && settings ? {
      products: catalogProducts,
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
