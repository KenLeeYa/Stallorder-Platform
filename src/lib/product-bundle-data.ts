import "server-only";

import { prisma } from "@/lib/prisma";
import type { ProductBundleDefinition } from "@/lib/product-bundle-types";

/**
 * Loads one tenant-scoped bundle definition for future trusted menu and order
 * pricing integrations. Callers must derive organizationId from an authorized
 * workspace or server-side stall/session lookup.
 */
export async function getProductBundleDefinition(
  organizationId: string,
  bundleProductId: string,
): Promise<ProductBundleDefinition | null> {
  const bundle = await prisma.product.findFirst({
    where: { id: bundleProductId, organizationId, kind: "BUNDLE" },
    select: {
      id: true,
      organizationId: true,
      name: true,
      defaultPrice: true,
      kind: true,
      isActive: true,
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
  });

  if (!bundle || bundle.kind !== "BUNDLE") return null;
  return {
    id: bundle.id,
    organizationId: bundle.organizationId,
    name: bundle.name,
    defaultPrice: bundle.defaultPrice,
    kind: "BUNDLE",
    isActive: bundle.isActive,
    choiceGroups: bundle.bundleChoiceGroups,
  };
}
