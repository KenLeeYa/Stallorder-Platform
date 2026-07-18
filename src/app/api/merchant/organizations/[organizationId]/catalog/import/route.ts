import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import {
  getCatalogCsvTranslations,
  parseCatalogCsvPreview,
  type CatalogCsvRow,
  type CatalogCsvRowError,
} from "@/lib/catalog-csv";
import { getOrganizationCatalog } from "@/lib/catalog-data";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { invalidatePublicMenus } from "@/lib/public-menu";

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
    select: { id: true },
  }) : [];
  const existingProductIds = new Set(existingProducts.map((product) => product.id));
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
    const importRows = validRows.map((row) => ({
      productId: row.id || randomUUID(),
      row,
    }));
    await prisma.$transaction(async (transaction) => {
      const importedExistingIds = importRows.flatMap(({ row }) => row.id ? [row.id] : []);
      if (importedExistingIds.length > 0) {
        const ownedProductCount = await transaction.product.count({
          where: { organizationId, id: { in: importedExistingIds } },
        });
        if (ownedProductCount !== importedExistingIds.length) {
          throw new CatalogImportNotFoundError(importedExistingIds[0]);
        }
      }

      const categoryNames = [...new Set(validRows.map((row) => row.category))];
      await transaction.productCategory.createMany({
        data: categoryNames.map((name) => ({ organizationId, name, sortOrder: 0 })),
        skipDuplicates: true,
      });
      const categories = await transaction.productCategory.findMany({
        where: { organizationId },
        select: { id: true, name: true },
      });
      const categoriesByName = new Map(categories.map((category) => [catalogKey(category.name), category.id]));
      const missingCategory = categoryNames.find((name) => !categoriesByName.has(catalogKey(name)));
      if (missingCategory) throw new CatalogImportReferenceError("CATEGORY", missingCategory);

      const requestedGroups = uniqueGroups(validRows, categoriesByName);
      if (requestedGroups.length > 0) {
        await transaction.productGroup.createMany({
          data: requestedGroups.map((group) => ({
            organizationId,
            categoryId: group.categoryId,
            name: group.name,
            sortOrder: 0,
          })),
          skipDuplicates: true,
        });
      }
      const groups = await transaction.productGroup.findMany({
        where: { organizationId, categoryId: { in: [...new Set(requestedGroups.map((group) => group.categoryId))] } },
        select: { id: true, categoryId: true, name: true },
      });
      const groupsByName = new Map(groups.map((group) => [groupKey(group.categoryId, group.name), group.id]));
      const missingGroup = requestedGroups.find((group) => !groupsByName.has(groupKey(group.categoryId, group.name)));
      if (missingGroup) throw new CatalogImportReferenceError("GROUP", missingGroup.name);

      await upsertImportedProducts(
        transaction,
        organizationId,
        importRows,
        categoriesByName,
        groupsByName,
      );
      await updateImportedTranslations(transaction, organizationId, importRows);
      await updateImportedStallAssignments(
        transaction,
        organizationId,
        importRows,
        authorizedStalls.map((stall) => stall.id),
        stallsByCode,
      );
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
    invalidatePublicMenus(authorizedStalls.map((stall) => stall.id));
    return NextResponse.json({
      importedCount: validRows.length,
      skippedCount: errors.length,
      errors,
      catalog: await getOrganizationCatalog(organizationId, authorizedStalls.map((stall) => stall.id)),
    }, { headers: { "x-request-id": authorization.requestId } });
  } catch (error) {
    const missing = error instanceof CatalogImportNotFoundError;
    const reference = error instanceof CatalogImportReferenceError;
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return NextResponse.json({
      error: missing
        ? `找不到商品 ${error.productId}。`
        : reference
          ? `無法建立匯入所需的${error.kind === "CATEGORY" ? "分類" : "群組"} ${error.value}。`
          : duplicate ? "匯入內容包含重複資料。" : "商品匯入失敗，沒有寫入任何資料。",
    }, { status: missing ? 404 : reference || duplicate ? 409 : 500 });
  }
}

class CatalogImportNotFoundError extends Error {
  constructor(readonly productId: string) { super(productId); }
}

class CatalogImportReferenceError extends Error {
  constructor(readonly kind: "CATEGORY" | "GROUP", readonly value: string) { super(value); }
}

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type ImportRow = { productId: string; row: CatalogCsvRow };

function catalogKey(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function groupKey(categoryId: string, name: string) {
  return `${categoryId}:${catalogKey(name)}`;
}

function uniqueGroups(rows: CatalogCsvRow[], categoriesByName: ReadonlyMap<string, string>) {
  const groups = new Map<string, { categoryId: string; name: string }>();
  for (const row of rows) {
    if (!row.group) continue;
    const categoryId = categoriesByName.get(catalogKey(row.category));
    if (!categoryId) throw new CatalogImportReferenceError("CATEGORY", row.category);
    groups.set(groupKey(categoryId, row.group), { categoryId, name: row.group });
  }
  return [...groups.values()];
}

async function upsertImportedProducts(
  transaction: TransactionClient,
  organizationId: string,
  rows: ImportRow[],
  categoriesByName: ReadonlyMap<string, string>,
  groupsByName: ReadonlyMap<string, string>,
) {
  const records = rows.map(({ productId, row }) => {
    const categoryId = categoriesByName.get(catalogKey(row.category));
    if (!categoryId) throw new CatalogImportReferenceError("CATEGORY", row.category);
    const groupId = row.group ? groupsByName.get(groupKey(categoryId, row.group)) : null;
    if (row.group && !groupId) throw new CatalogImportReferenceError("GROUP", row.group);
    return {
      id: productId,
      category_id: categoryId,
      group_id: groupId,
      name: row.name,
      description: row.description,
      default_price: row.price,
      image_url: row.imageUrl || null,
      sort_order: row.sortOrder,
      is_active: row.isActive,
    };
  });

  await transaction.$executeRaw(Prisma.sql`
    insert into public.products (
      id, organization_id, category_id, group_id, name, description,
      default_price, image_url, sort_order, is_active, created_at, updated_at
    )
    select
      imported.id,
      ${organizationId}::uuid,
      imported.category_id,
      imported.group_id,
      imported.name,
      imported.description,
      imported.default_price,
      imported.image_url,
      imported.sort_order,
      imported.is_active,
      now(),
      now()
    from jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as imported(
      id uuid,
      category_id uuid,
      group_id uuid,
      name text,
      description text,
      default_price integer,
      image_url text,
      sort_order integer,
      is_active boolean
    )
    on conflict (id) do update set
      category_id = excluded.category_id,
      group_id = excluded.group_id,
      name = excluded.name,
      description = excluded.description,
      default_price = excluded.default_price,
      image_url = excluded.image_url,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      updated_at = now()
    where products.organization_id = excluded.organization_id
  `);
}

async function updateImportedTranslations(
  transaction: TransactionClient,
  organizationId: string,
  rows: ImportRow[],
) {
  const translations = rows.flatMap(({ productId, row }) => (
    getCatalogCsvTranslations(row).flatMap((translation) => translation.name ? [{
      id: randomUUID(),
      product_id: productId,
      locale: translation.locale,
      name: translation.name,
      description: translation.description,
    }] : [])
  ));
  const removals = rows.flatMap(({ productId, row }) => (
    getCatalogCsvTranslations(row).flatMap((translation) => translation.name ? [] : [{
      product_id: productId,
      locale: translation.locale,
    }])
  ));

  if (translations.length > 0) {
    await transaction.$executeRaw(Prisma.sql`
      insert into public.product_translations (
        id, organization_id, product_id, locale, name, description, created_at, updated_at
      )
      select
        imported.id,
        ${organizationId}::uuid,
        imported.product_id,
        imported.locale,
        imported.name,
        imported.description,
        now(),
        now()
      from jsonb_to_recordset(${JSON.stringify(translations)}::jsonb) as imported(
        id uuid, product_id uuid, locale text, name text, description text
      )
      on conflict (product_id, locale) do update set
        name = excluded.name,
        description = excluded.description,
        updated_at = now()
      where product_translations.organization_id = excluded.organization_id
    `);
  }

  if (removals.length > 0) {
    await transaction.$executeRaw(Prisma.sql`
      delete from public.product_translations translation
      using jsonb_to_recordset(${JSON.stringify(removals)}::jsonb) as removed(
        product_id uuid, locale text
      )
      where translation.organization_id = ${organizationId}::uuid
        and translation.product_id = removed.product_id
        and translation.locale = removed.locale
    `);
  }
}

async function updateImportedStallAssignments(
  transaction: TransactionClient,
  organizationId: string,
  rows: ImportRow[],
  authorizedStallIds: string[],
  stallsByCode: ReadonlyMap<string, { id: string }>,
) {
  if (authorizedStallIds.length === 0) return;

  const desiredStalls = rows.map(({ productId, row }) => ({
    product_id: productId,
    stall_ids: row.stallCodes.map((code) => stallsByCode.get(code)!.id),
  }));
  const assignments = rows.flatMap(({ productId, row }) => (
    row.stallCodes.map((code) => ({
      id: randomUUID(),
      product_id: productId,
      stall_id: stallsByCode.get(code)!.id,
      sort_order: row.sortOrder,
    }))
  ));

  const authorizedSql = Prisma.join(authorizedStallIds.map((stallId) => Prisma.sql`${stallId}::uuid`));
  await transaction.$executeRaw(Prisma.sql`
    delete from public.stall_products assignment
    using jsonb_to_recordset(${JSON.stringify(desiredStalls)}::jsonb) as imported(
      product_id uuid, stall_ids jsonb
    )
    where assignment.organization_id = ${organizationId}::uuid
      and assignment.product_id = imported.product_id
      and assignment.stall_id in (${authorizedSql})
      and not exists (
        select 1
        from jsonb_array_elements_text(imported.stall_ids) selected
        where selected.value::uuid = assignment.stall_id
      )
  `);

  if (assignments.length > 0) {
    await transaction.$executeRaw(Prisma.sql`
      insert into public.stall_products (
        id, organization_id, stall_id, product_id, sort_order, created_at, updated_at
      )
      select
        imported.id,
        ${organizationId}::uuid,
        imported.stall_id,
        imported.product_id,
        imported.sort_order,
        now(),
        now()
      from jsonb_to_recordset(${JSON.stringify(assignments)}::jsonb) as imported(
        id uuid, product_id uuid, stall_id uuid, sort_order integer
      )
      on conflict (stall_id, product_id) do update set
        sort_order = excluded.sort_order,
        updated_at = now()
      where stall_products.organization_id = excluded.organization_id
    `);
  }
}
