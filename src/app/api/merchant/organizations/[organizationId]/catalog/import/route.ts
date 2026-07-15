import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { getCatalogCsvTranslations, parseCatalogCsv } from "@/lib/catalog-csv";
import { getOrganizationCatalog } from "@/lib/catalog-data";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

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
  if (!(file instanceof File) || file.size === 0 || file.size > maxCsvSize || !file.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json({ error: "請選擇 2MB 以下的 CSV 檔案。" }, { status: 400 });
  }
  const parsed = parseCatalogCsv(await file.text());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const authorizedStalls = authorization.workspace.stalls;
  const stallsByCode = new Map(authorizedStalls.map((stall) => [stall.code, stall]));
  const unknownCode = parsed.rows.flatMap((row) => row.stallCodes).find((code) => !stallsByCode.has(code));
  if (unknownCode) return NextResponse.json({ error: `找不到或無權管理攤位代碼 ${unknownCode}。` }, { status: 403 });

  try {
    await prisma.$transaction(async (transaction) => {
      const categoryCache = new Map<string, string>();
      const groupCache = new Map<string, string>();
      for (const row of parsed.rows) {
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
      metadata: { rowCount: parsed.rows.length },
    });
    return NextResponse.json({
      importedCount: parsed.rows.length,
      catalog: await getOrganizationCatalog(organizationId, authorizedStalls.map((stall) => stall.id)),
    }, { headers: { "x-request-id": authorization.requestId } });
  } catch (error) {
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
