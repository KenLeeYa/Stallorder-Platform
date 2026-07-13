import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/authorization";
import { MerchantProducts } from "@/components/merchant-products";

type PageProps = {
  params: Promise<{ stallSlug: string }>;
};

export default async function MerchantPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const { stall, principal, role } = await requirePagePermission(
    stallSlug,
    "MANAGE_PRODUCTS",
    `/merchant/${stallSlug}`,
  );
  const [products, categories, qrCode, orderingSettings] = await Promise.all([
    prisma.product.findMany({
      where: { stallId: stall.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.productCategory.findMany({
      where: { stallId: stall.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.qrCode.findFirst({
      where: { stallId: stall.id },
      orderBy: { tokenVersion: "desc" },
      select: { token: true, state: true, tokenVersion: true },
    }),
    prisma.stallOrderingSettings.findUnique({ where: { stallId: stall.id } }),
  ]);
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  const baseUrl = configuredUrl || "http://localhost:3000";

  return (
    <MerchantProducts
      stall={{
        name: stall.name,
        slug: stall.slug,
        currency: stall.currency,
        orderingState: stall.orderingState,
        isSoldOut: stall.isSoldOut,
      }}
      products={products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        categoryId: product.categoryId,
        isAvailable: product.isAvailable,
        sortOrder: product.sortOrder,
      }))}
      categories={categories.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
      }))}
      appBaseUrl={baseUrl}
      qrCode={qrCode}
      orderingSettings={orderingSettings ?? {
        orderSessionTtlSeconds: 600,
        unconfirmedOrderTimeoutSeconds: 600,
        maxItemQuantity: 20,
        maxUniqueProducts: 20,
        maxTotalQuantity: 40,
        maxNoteLength: 200,
        maxPendingOrdersPerDevice: 3,
        maxOrdersPerWindow: 5,
        orderWindowSeconds: 300,
      }}
      account={{ displayName: principal.user.displayName, role }}
    />
  );
}
