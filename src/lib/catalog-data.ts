import "server-only";

import { prisma } from "@/lib/prisma";

export async function getOrganizationCatalog(organizationId: string, authorizedStallIds: string[]) {
  const [categories, groups, products] = await Promise.all([
    prisma.productCategory.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, sortOrder: true, isActive: true },
    }),
    prisma.productGroup.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, categoryId: true, name: true, sortOrder: true, isActive: true },
    }),
    prisma.product.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        categoryId: true,
        groupId: true,
        name: true,
        description: true,
        defaultPrice: true,
        imageUrl: true,
        sortOrder: true,
        isActive: true,
        translations: {
          orderBy: { locale: "asc" },
          select: { locale: true, name: true, description: true },
        },
        stallProducts: {
          where: { stallId: { in: authorizedStallIds } },
          orderBy: { stallId: "asc" },
          select: {
            id: true,
            stallId: true,
            priceOverride: true,
            isEnabled: true,
            isSoldOut: true,
            sortOrder: true,
          },
        },
      },
    }),
  ]);

  return { categories, groups, products };
}
