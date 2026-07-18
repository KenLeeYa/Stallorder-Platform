import "server-only";

import { prisma } from "@/lib/prisma";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";

export async function getStaffOrderCatalog(
  stallId: string,
  organizationId: string,
): Promise<StaffOrderCatalog> {
  const now = new Date();
  const [assignments, tables, settings] = await Promise.all([
    prisma.stallProduct.findMany({
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
    }),
    prisma.diningTable.findMany({
      where: { stallId, organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true },
    }),
    prisma.stallOrderingSettings.findUniqueOrThrow({
      where: { stallId },
      select: {
        maxItemQuantity: true,
        maxUniqueProducts: true,
        maxTotalQuantity: true,
        maxNoteLength: true,
      },
    }),
  ]);

  return {
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
    limits: settings,
  };
}
