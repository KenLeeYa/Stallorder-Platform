import "server-only";

import { prisma } from "@/lib/prisma";

export async function getOrganizationProductNotes(organizationId: string) {
  return prisma.productNoteGroup.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      selectionMode: true,
      isRequired: true,
      minSelections: true,
      maxSelections: true,
      sortOrder: true,
      isActive: true,
      translations: {
        orderBy: { locale: "asc" },
        select: { locale: true, name: true },
      },
      assignments: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { productId: "asc" }],
        select: { productId: true },
      },
      options: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          priceDelta: true,
          sortOrder: true,
          isActive: true,
          translations: {
            orderBy: { locale: "asc" },
            select: { locale: true, name: true },
          },
        },
      },
    },
  });
}
