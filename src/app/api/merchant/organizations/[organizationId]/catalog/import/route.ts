import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { getCatalogCsvTranslations, parseCatalogCsvPreview, type CatalogCsvRowError } from "@/lib/catalog-csv";
import { getOrganizationCatalog } from "@/lib/catalog-data";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

const maxCsvSize = 2 * 1024 * 1024;
type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_SHARED_PRODUCTS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("catalog");
  const mode = form?.get("mode");
  if (mode !== "PREVIEW" && mode !== "APPLY") {
    return NextResponse.json({ error: "請指定匯入預覽或套用模式。" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0 || file.size > maxCsvSize || !file.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json({ error: "請選擇 2MB 以下的 CSV 檔案。" }, { status: 400 });
  }
  const parsed = parseCatalogCsvPreview(await file.text());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const authorizedStalls = authorization.workspace.stalls;
  const stallsByCode = new Map(authorizedStalls.map((stall) => [stall.code, stall]));
  const requestedProductIds = [...new Set(parsed.rows.map((item) => item.row.id).filter(Boolean))];
  const existingProducts = requestedProductIds.length > 0 ? await prisma.product.findMany({
    where: { organizationId, id: { in: requestedProductIds } },
    select: { id: true, isActive: true },
  }) : [];
  const existingProductIds = new Set(existingProducts.map((product) => product.id));
  const existingProductActivity = new Map(existingProducts.map((product) => [product.id, product.isActive]));
  const seenProductIds = new Set<string>();
  const errors: CatalogCsvRowError[] = [...parsed.errors];
  const validRows = parsed.rows.flatMap((item) => {
    const unknownCode = item.row.stallCodes.find((code) => !stallsByCode.has(code));
    const duplicateId = item.row.id && seenProductIds.has(item.row.id);
    if (item.row.id) seenProductIds.add(item.row.id);
    const missingId = item.row.id && !existingProductIds.has(item.row.id);
    if (!unknownCode && !duplicateId && !missingId) return [item.row];
    errors.push({
      line: item.line,
      error: unknownCode
        ? `CSV 第 ${item.line} 列的攤位代碼 ${unknownCode} 不存在或無權管理。`
        : duplicateId ? `CSV 第 ${item.line} 列重複使用商品 ID ${item.row.id}。`
          : `CSV 第 ${item.line} 列找不到商品 ${item.row.id}。`,
      values: item.values,
    });
    return [];
  });

  if (mode === "PREVIEW") {
    return NextResponse.json({
      totalCount: parsed.totalRows,
      validCount: validRows.length,
      invalidCount: errors.length,
      previewRows: validRows.slice(0, 20).map((row) => ({
        id: row.id || null,
        category: row.category,
        group: row.group || null,
        name: row.name,
        price: row.price,
        stallCodes: row.stallCodes,
      })),
      errors,
    }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
  }

  if (validRows.length === 0) {
    return NextResponse.json({ error: "沒有可套用的有效商品列。", errors }, { status: 400 });
  }

  try {
    const activeProductDelta = validRows.filter((row) => (
      row.isActive && (!row.id || existingProductActivity.get(row.id) === false)
    )).length;
    await entitlementService.assertLimitAvailable(organizationId, "PRODUCTS", activeProductDelta);
    await prisma.$transaction(async (transaction) => {
      const categoryCache = new Map<string, string>();
      const groupCache = new Map<string, string>();
      for (const row of validRows) {
        let categoryId = categoryCache.get(row.category);
        if (!categoryId) {
          const existing = await transaction.productCategory.findFirst({ where: { organizationId, name: row.category } });
          const category = existing ?? await transaction.productCategory.create({ data: { organizationId, name: row.category, sortOrder: 0 } });
          categoryId = category.id;
          categoryCache.set(row.category, categoryId);
        }
        let groupId: string | null = null;
        if (row.group) {
          const groupKey = `${categoryId}:${row.group}`;
          groupId = groupCache.get(groupKey) ?? null;
          if (!groupId) {
            const existing = await transaction.productGroup.findFirst({ where: { organizationId, categoryId, name: row.group } });
            const group = existing ?? await transaction.productGroup.create({ data: { organizationId, categoryId, name: row.group, sortOrder: 0 } });
            groupId = group.id;
            groupCache.set(groupKey, groupId);
          }
        }

        const productData = {
          categoryId,
          groupId,
          name: row.name,
          description: row.description,
          defaultPrice: row.price,
          imageUrl: row.imageUrl || null,
          sortOrder: row.sortOrder,
          isActive: row.isActive,
        };
        let productId = row.id;
        if (productId) {
          const existing = await transaction.product.findFirst({ where: { id: productId, organizationId }, select: { id: true } });
          if (!existing) throw new CatalogImportNotFoundError(productId);
          await transaction.product.update({ where: { id: productId }, data: productData });
        } else {
          productId = (await transaction.product.create({ data: { organizationId, ...productData }, select: { id: true } })).id;
        }

        for (const translation of getCatalogCsvTranslations(row)) {
          if (translation.name) {
            await transaction.productTranslation.upsert({
              where: { productId_locale: { productId, locale: translation.locale } },
              update: { organizationId, name: translation.name, description: translation.description },
              create: { organizationId, productId, ...translation },
            });
          } else {
            await transaction.productTranslation.deleteMany({
              where: { organizationId, productId, locale: translation.locale },
            });
          }
        }

        const stallIds = row.stallCodes.map((code) => stallsByCode.get(code)!.id);
        await transaction.stallProduct.deleteMany({ where: { organizationId, productId, stallId: { in: authorizedStalls.map((stall) => stall.id), notIn: stallIds } } });
        for (const stallId of stallIds) {
          await transaction.stallProduct.upsert({
            where: { stallId_productId: { stallId, productId } },
            create: { organizationId, stallId, productId, sortOrder: row.sortOrder },
            update: { sortOrder: row.sortOrder },
          });
        }
      }
    }, { timeout: 30_000 });

    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "PRODUCT_CATALOG_IMPORTED",
      entityType: "PRODUCT_CATALOG",
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { rowCount: validRows.length, skippedCount: errors.length },
    });
    return NextResponse.json({
      importedCount: validRows.length,
      skippedCount: errors.length,
      errors,
      catalog: await getOrganizationCatalog(organizationId, authorizedStalls.map((stall) => stall.id)),
    }, { headers: { "x-request-id": authorization.requestId } });
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    const missing = error instanceof CatalogImportNotFoundError;
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return NextResponse.json({
      error: missing ? `找不到商品 ${error.productId}。` : duplicate ? "匯入內容包含重複資料。" : "商品匯入失敗，沒有寫入任何資料。",
    }, { status: missing ? 404 : duplicate ? 409 : 500 });
  }
}

class CatalogImportNotFoundError extends Error {
  constructor(readonly productId: string) { super(productId); }
}
