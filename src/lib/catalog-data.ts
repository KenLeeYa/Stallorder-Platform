import "server-only";

import { prisma } from "@/lib/prisma";
import { isProductSoldOut } from "@/lib/product-availability";
import { Prisma } from "@prisma/client";
import { buildOperationsPageMeta } from "@/lib/operations-pagination";
import { productListRowSchema, type CatalogReadInput } from "@/lib/operations-read-contract";

export async function getPaginatedOrganizationProducts(organizationId: string, authorizedStallIds: string[], input: CatalogReadInput) {
  if (input.stallId && !authorizedStallIds.includes(input.stallId)) throw new Error("OPERATIONS_NOT_FOUND");
  return prisma.$transaction(async (database) => {
    if (input.categoryId && !await database.productCategory.findFirst({ where: { id: input.categoryId, organizationId }, select: { id: true } })) throw new Error("OPERATIONS_NOT_FOUND");
    if (input.groupId && input.groupId !== "ungrouped" && !await database.productGroup.findFirst({ where: { id: input.groupId, organizationId, ...(input.categoryId ? { categoryId: input.categoryId } : {}) }, select: { id: true } })) throw new Error("OPERATIONS_NOT_FOUND");
    const literal = input.q.replace(/[\\%_]/g, "\\$&");
    const where: Prisma.ProductWhereInput = { organizationId,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.groupId ? { groupId: input.groupId === "ungrouped" ? null : input.groupId } : {}),
      ...(input.stallId ? { stallProducts: { some: { stallId: input.stallId } } } : {}),
      ...(input.active === "all" ? {} : { isActive: input.active === "active" }),
      ...(literal ? { OR: [{ name: { contains: literal, mode: "insensitive" } }, { translations: { some: { name: { contains: literal, mode: "insensitive" } } } }] } : {}),
    };
    const total = await database.product.count({ where });
    const pagination = buildOperationsPageMeta(total, input);
    const direction = input.sort === "nameDesc" ? "desc" : "asc";
    const products = await database.product.findMany({ where, orderBy: input.sort === "catalog" ? [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }] : [{ name: direction }, { id: direction }], skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize,
      select: { id: true, categoryId: true, groupId: true, name: true, kind: true, isActive: true, imageUrl: true, defaultPrice: true, sortOrder: true, translations: { orderBy: { locale: "asc" }, select: { locale: true, name: true } }, stallProducts: { where: { stallId: { in: authorizedStallIds } }, orderBy: { stallId: "asc" }, select: { stallId: true, isEnabled: true, isSoldOut: true, soldOutUntil: true, priceOverride: true, stockRemaining: true, stockVersion: true } } },
    });
    return { rows: products.map(({ stallProducts, ...product }) => productListRowSchema.parse({ ...product, localizedName: product.translations.find((t) => t.locale === input.locale)?.name ?? product.name, assignments: stallProducts.map((assignment) => ({ ...assignment, isSoldOut: isProductSoldOut(assignment), soldOutUntil: assignment.soldOutUntil?.toISOString() ?? null })) })), pagination };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function getOrganizationCatalog(organizationId: string, authorizedStallIds: string[]) {
  const [categories, groups, products, orderingSettings] = await Promise.all([
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
            soldOutUntil: true,
            stockRemaining: true,
            stockVersion: true,
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
    prisma.stallOrderingSettings.findMany({
      where: { stallId: { in: authorizedStallIds } },
      select: { stallId: true, checkoutUpsellProductIds: true },
    }),
  ]);

  const checkoutUpsellIdsByStall = new Map(
    orderingSettings.map((settings) => [
      settings.stallId,
      new Set(settings.checkoutUpsellProductIds),
    ]),
  );
  return {
    categories,
    groups,
    products: products.map((product) => ({
      ...product,
      stallProducts: product.stallProducts.map((assignment) => ({
        ...assignment,
        isSoldOut: isProductSoldOut(assignment),
        soldOutUntil: assignment.soldOutUntil?.toISOString() ?? null,
        checkoutUpsellSelected: checkoutUpsellIdsByStall
          .get(assignment.stallId)
          ?.has(product.id) ?? false,
      })),
    })),
  };
}
