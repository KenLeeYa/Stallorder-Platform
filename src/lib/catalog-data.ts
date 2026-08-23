import "server-only";

import { prisma } from "@/lib/prisma";

export async function getOrganizationCatalog(organizationId: string, authorizedStallIds: string[]) {
  const [categories, groups, products] = await Promise.all([
    prisma.productCategory.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isActive: true,
        translations: {
          orderBy: { locale: "asc" },
          select: { locale: true, name: true },
        },
      },
    }),
    prisma.productGroup.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        categoryId: true,
        name: true,
        sortOrder: true,
        isActive: true,
        translations: {
          orderBy: { locale: "asc" },
          select: { locale: true, name: true },
        },
      },
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
        kind: true,
        imageUrl: true,
        isOrderDiscountEligible: true,
        isLotteryEligible: true,
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
        bundleChoiceGroups: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            bundleProductId: true,
            name: true,
            minSelections: true,
            maxSelections: true,
            sortOrder: true,
            choices: {
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              select: {
                id: true,
                choiceGroupId: true,
                componentProductId: true,
                quantity: true,
                priceDelta: true,
                isEnabled: true,
                sortOrder: true,
                componentProduct: {
                  select: { id: true, name: true, kind: true, isActive: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  return { categories, groups, products };
}
