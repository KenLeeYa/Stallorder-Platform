import "server-only";

import { prisma } from "@/lib/prisma";
import { mergeEnabledLocales, normalizeEnabledLocales } from "@/lib/enabled-locales";
import { calculateTranslationCoverage } from "@/lib/translation-completeness";

export async function getLocalizationOverview(organizationId: string, stallIds: string[]) {
  const [products, noteGroups, stalls] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        translations: { select: { locale: true, name: true, description: true } },
      },
    }),
    prisma.productNoteGroup.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        isActive: true,
        translations: { select: { locale: true, name: true } },
        options: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            isActive: true,
            translations: { select: { locale: true, name: true } },
          },
        },
      },
    }),
    prisma.stall.findMany({
      where: { organizationId, id: { in: stallIds }, isActive: true },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        orderingSettings: { select: { enabledLocales: true } },
      },
    }),
  ]);

  const normalizedStalls = stalls.map((stall) => ({
      id: stall.id,
      name: stall.name,
      enabledLocales: normalizeEnabledLocales(stall.orderingSettings?.enabledLocales),
    }));
  const enabledLocales = mergeEnabledLocales(normalizedStalls.map((stall) => stall.enabledLocales));

  return {
    coverage: calculateTranslationCoverage(enabledLocales, products, noteGroups),
    stalls: normalizedStalls,
  };
}

export async function getOrganizationEnabledLocales(organizationId: string, stallIds: string[]) {
  const stalls = await prisma.stall.findMany({
    where: { organizationId, id: { in: stallIds }, isActive: true },
    select: { orderingSettings: { select: { enabledLocales: true } } },
  });
  return mergeEnabledLocales(
    stalls.map((stall) => normalizeEnabledLocales(stall.orderingSettings?.enabledLocales)),
  );
}

export async function getLocalizedStallPreview(organizationId: string, stallId: string) {
  return prisma.stall.findFirst({
    where: { id: stallId, organizationId, isActive: true },
    select: {
      id: true,
      name: true,
      location: true,
      currency: true,
      orderingSettings: { select: { enabledLocales: true } },
      stallProducts: {
        where: { isEnabled: true, product: { isActive: true } },
        orderBy: [{ sortOrder: "asc" }, { product: { name: "asc" } }],
        select: {
          priceOverride: true,
          isSoldOut: true,
          product: {
            select: {
              id: true,
              name: true,
              description: true,
              defaultPrice: true,
              imageUrl: true,
              category: { select: { name: true } },
              translations: { select: { locale: true, name: true, description: true } },
              noteGroupAssignments: {
                where: { isActive: true, noteGroup: { isActive: true } },
                orderBy: { sortOrder: "asc" },
                select: {
                  noteGroup: {
                    select: {
                      id: true,
                      name: true,
                      isRequired: true,
                      minSelections: true,
                      maxSelections: true,
                      translations: { select: { locale: true, name: true } },
                      options: {
                        where: { isActive: true },
                        orderBy: { sortOrder: "asc" },
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
      },
    },
  });
}
