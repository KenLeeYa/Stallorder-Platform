import "server-only";

import { prisma } from "@/lib/prisma";
import {
  compareConfiguredProductOrder,
  UNGROUPED_PRODUCT_SORT_ORDER,
} from "@/lib/configured-product-order";
import { DEFAULT_DINING_FLOOR_NAME } from "@/lib/dining-floor";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";
import { getStaffFulfillmentModules } from "@/lib/staff-fulfillment";

export async function getStaffOrderPageConfiguration(
  stallId: string,
  organizationId: string,
  includeCatalog: boolean,
) {
  const now = new Date();
  const [assignments, tables, settings, fulfillmentSlotRows] = await Promise.all([
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
        sortOrder: true,
        product: {
          select: {
            id: true,
            organizationId: true,
            name: true,
            description: true,
            translations: { select: { locale: true, name: true, description: true } },
            defaultPrice: true,
            kind: true,
            imageUrl: true,
            isOrderDiscountEligible: true,
            sortOrder: true,
            category: { select: { name: true, sortOrder: true, translations: { select: { locale: true, name: true } } } },
            group: { select: { name: true, sortOrder: true, translations: { select: { locale: true, name: true } } } },
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
                        translations: { select: { locale: true, name: true, description: true } },
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
                    translations: { select: { locale: true, name: true } },
                    selectionMode: true,
                    isRequired: true,
                    minSelections: true,
                    maxSelections: true,
                    options: {
                      where: { isActive: true },
                      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                      select: {
                        id: true,
                        name: true,
                        priceDelta: true,
                        translations: { select: { locale: true, name: true } },
                      },
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
      orderBy: [{ floor: { sortOrder: "asc" } }, { sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true, floorId: true, floor: { select: { name: true } } },
    }) : Promise.resolve([]),
    includeCatalog ? prisma.stallOrderingSettings.findUniqueOrThrow({
      where: { stallId },
      select: {
        dineInEnabled: true,
        staffDeliveryEnabled: true,
        printModuleEnabled: true,
        kdsModuleEnabled: true,
        paymentModuleEnabled: true,
        discountModuleEnabled: true,
        discountApprovalThresholdBps: true,
        preorderReminderMinutes: true,
        orderAlertSoundPreset: true,
        orderAlertSoundObjectPath: true,
        orderAlertVolume: true,
        orderAlertRepeatCount: true,
        businessDayCutoffHour: true,
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
        kdsModuleEnabled: true,
        paymentModuleEnabled: true,
        discountModuleEnabled: true,
        discountApprovalThresholdBps: true,
        preorderReminderMinutes: true,
        orderAlertSoundPreset: true,
        orderAlertSoundObjectPath: true,
        orderAlertVolume: true,
        orderAlertRepeatCount: true,
        businessDayCutoffHour: true,
        maxItemQuantity: true,
        maxUniqueProducts: true,
        maxTotalQuantity: true,
        maxNoteLength: true,
      },
    }),
    includeCatalog ? prisma.$queryRaw<Array<{ slots: unknown }>>`
      select public.get_fulfillment_time_slots_raw(${stallId}::uuid, ${now}::timestamptz) as slots
    ` : Promise.resolve([]),
  ]);

  const fulfillmentModules = getStaffFulfillmentModules(settings);
  const fulfillmentSlots = Array.isArray(fulfillmentSlotRows[0]?.slots)
    ? fulfillmentSlotRows[0].slots.filter((slot): slot is string => typeof slot === "string")
    : [];
  const catalogProducts = [...assignments].sort((left, right) => compareConfiguredProductOrder(
    {
      categorySortOrder: left.product.category.sortOrder,
      groupSortOrder: left.product.group?.sortOrder ?? UNGROUPED_PRODUCT_SORT_ORDER,
      productSortOrder: left.product.sortOrder,
      stallProductSortOrder: left.sortOrder,
      name: left.product.name,
      id: left.product.id,
    },
    {
      categorySortOrder: right.product.category.sortOrder,
      groupSortOrder: right.product.group?.sortOrder ?? UNGROUPED_PRODUCT_SORT_ORDER,
      productSortOrder: right.product.sortOrder,
      stallProductSortOrder: right.sortOrder,
      name: right.product.name,
      id: right.product.id,
    },
  )).flatMap((assignment) => {
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
          translations: choice.componentProduct.translations,
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
      translations: assignment.product.translations,
      category: assignment.product.category.name,
      categoryTranslations: assignment.product.category.translations,
      group: assignment.product.group?.name ?? null,
      groupTranslations: assignment.product.group?.translations ?? [],
      price: assignment.priceOverride ?? assignment.product.defaultPrice,
      isOrderDiscountEligible: assignment.product.isOrderDiscountEligible,
      kind: assignment.product.kind,
      bundleChoiceGroups: assignment.product.kind === "BUNDLE" ? bundleChoiceGroups : [],
      imageUrl: assignment.product.imageUrl,
      noteGroups: assignment.product.noteGroupAssignments.map(({ noteGroup }) => noteGroup),
    }];
  });

  return {
    businessDayCutoffHour: settings?.businessDayCutoffHour ?? 0,
    modules: {
      ...fulfillmentModules,
      print: settings?.printModuleEnabled ?? false,
      kds: settings?.kdsModuleEnabled ?? false,
      payment: settings?.paymentModuleEnabled ?? false,
      discount: settings?.discountModuleEnabled ?? false,
      discountApprovalThresholdBps: settings?.discountApprovalThresholdBps ?? 8000,
      preorderReminderMinutes: settings?.preorderReminderMinutes ?? 30,
      orderAlertSoundPreset: normalizeOrderAlertSoundPreset(settings?.orderAlertSoundPreset),
      orderAlertSoundConfigured: Boolean(settings?.orderAlertSoundObjectPath),
      orderAlertVolume: settings?.orderAlertVolume ?? 100,
      orderAlertRepeatCount: settings?.orderAlertRepeatCount ?? 2,
    },
    catalog: includeCatalog && settings ? {
      products: catalogProducts,
      tables: tables.map(({ floor, ...table }) => ({
        ...table,
        floorName: floor?.name ?? DEFAULT_DINING_FLOOR_NAME,
      })),
      fulfillmentSlots,
      limits: {
        maxItemQuantity: settings.maxItemQuantity,
        maxUniqueProducts: settings.maxUniqueProducts,
        maxTotalQuantity: settings.maxTotalQuantity,
        maxNoteLength: settings.maxNoteLength,
      },
    } satisfies StaffOrderCatalog : null,
  };
}

function normalizeOrderAlertSoundPreset(value: string | null | undefined): "URGENT" | "BELL" | "CHIME" | "CUSTOM" {
  return value === "BELL" || value === "CHIME" || value === "CUSTOM" ? value : "URGENT" as const;
}
