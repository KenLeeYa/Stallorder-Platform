import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { catalogCsvHeaders, catalogCsvTranslationColumns } from "@/lib/catalog-csv";
import { createCsv } from "@/lib/csv";
import { prisma } from "@/lib/prisma";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_SHARED_PRODUCTS");
  if (!authorization.ok) return authorization.response;
  try {
    await entitlementService.assertFeatureEnabled(organizationId, "CSV_EXPORT");
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }

  const products = await prisma.product.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      category: { select: { name: true } },
      group: { select: { name: true } },
      translations: { select: { locale: true, name: true, description: true } },
      stallProducts: { include: { stall: { select: { code: true } } }, orderBy: { stallId: "asc" } },
    },
  });
  const rows: Array<Array<string | number>> = [
    [...catalogCsvHeaders],
    ...products.map((product) => {
      const translations = new Map(product.translations.map((translation) => [translation.locale, translation]));
      return [
        product.id,
        product.category.name,
        product.group?.name ?? "",
        product.name,
        product.description,
        product.defaultPrice,
        product.imageUrl ?? "",
        product.sortOrder,
        String(product.isActive),
        product.stallProducts.map((assignment) => assignment.stall.code).join(";"),
        ...catalogCsvTranslationColumns.flatMap((columns) => {
          const translation = translations.get(columns.locale);
          return [translation?.name ?? "", translation?.description ?? ""];
        }),
        String(product.isOrderDiscountEligible),
        String(product.isLotteryEligible),
      ];
    }),
  ];
  const fileName = `stallorder-products-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(`\uFEFF${createCsv(rows)}`, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-type": "text/csv; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-request-id": authorization.requestId,
    },
  });
}
