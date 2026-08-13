import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/authorization";
import { MerchantProducts } from "@/components/merchant-products";
import { hasPermission } from "@/lib/rbac";
import { effectiveProductPrice } from "@/lib/shared-catalog";
import { getWorkspaceAccess } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ stallSlug: string }>;
};

export default async function MerchantPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const { stall, principal, role, roles } = await requirePagePermission(
    stallSlug,
    "MANAGE_PRODUCTS",
    `/merchant/${stallSlug}`,
  );
  const workspaces = await getWorkspaceAccess(principal.user.id, principal.user.platformRole);
  const workspace = workspaces.find((candidate) => candidate.id === stall.organizationId);
  const [products, qrCode] = await Promise.all([
    prisma.stallProduct.findMany({
      where: { stallId: stall.id },
      orderBy: [{ sortOrder: "asc" }, { product: { name: "asc" } }],
      include: {
        product: {
          include: {
            category: { select: { name: true } },
            group: { select: { name: true } },
          },
        },
      },
    }),
    prisma.qrCode.findFirst({
      where: { stallId: stall.id },
      orderBy: { tokenVersion: "desc" },
      select: { token: true, state: true, tokenVersion: true },
    }),
  ]);
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  const baseUrl = configuredUrl || "http://localhost:3000";

  return (
    <MerchantProducts
      stall={{
        id: stall.id,
        name: stall.name,
        slug: stall.slug,
        code: stall.code,
        currency: stall.currency,
        orderingState: stall.orderingState,
        isSoldOut: stall.isSoldOut,
      }}
      products={products.map((product) => ({
        id: product.id,
        productId: product.productId,
        categoryName: product.product.category.name,
        groupName: product.product.group?.name ?? null,
        name: product.product.name,
        description: product.product.description,
        defaultPrice: product.product.defaultPrice,
        priceOverride: product.priceOverride,
        effectivePrice: effectiveProductPrice(product.product.defaultPrice, product.priceOverride),
        isEnabled: product.isEnabled,
        isSoldOut: product.isSoldOut,
        sortOrder: product.sortOrder,
        availableFrom: product.availableFrom?.toISOString() ?? null,
        availableUntil: product.availableUntil?.toISOString() ?? null,
        masterIsActive: product.product.isActive,
      }))}
      sourceStalls={(workspace?.stalls ?? [])
        .filter((candidate) => candidate.id !== stall.id && candidate.roles.some((candidateRole) => hasPermission(candidateRole, "MANAGE_PRODUCTS")))
        .map((candidate) => ({ id: candidate.id, name: candidate.name, code: candidate.code }))}
      sharedCatalogUrl={roles.some((candidate) => hasPermission(candidate, "MANAGE_SHARED_PRODUCTS"))
        ? `/merchant/catalog?organizationId=${stall.organizationId}&stallId=${stall.id}&source=stall-products`
        : undefined}
      appBaseUrl={baseUrl}
      qrCode={qrCode}
      account={{ displayName: principal.user.displayName, role }}
    />
  );
}
