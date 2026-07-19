import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { getOrganizationCatalog } from "@/lib/catalog-data";
import { sharedCatalogCommandSchema } from "@/lib/catalog-validation";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";
import { invalidatePublicMenus } from "@/lib/public-menu";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_SHARED_PRODUCTS",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "CSRF_VALIDATION_FAILED",
      entityType: "SHARED_CATALOG",
      outcome: "DENIED",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = sharedCatalogCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "商品主檔資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const authorizedStallIds = authorization.workspace.stalls.map((stall) => stall.id);
  const authorizedStallSet = new Set(authorizedStallIds);
  const command = parsed.data;
  if ("stallIds" in command && command.stallIds.some((stallId) => !authorizedStallSet.has(stallId))) {
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "CATALOG_ASSIGNMENT_DENIED",
      entityType: "PRODUCT",
      outcome: "DENIED",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "分派清單包含未授權攤位。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  let before: Prisma.InputJsonObject | undefined;
  if (command.operation === "UPDATE_CATEGORY") {
    const category = await prisma.productCategory.findFirst({
      where: { id: command.categoryId, organizationId },
      select: { name: true, sortOrder: true, isActive: true },
    });
    before = category ?? undefined;
  } else if (command.operation === "UPDATE_GROUP") {
    const group = await prisma.productGroup.findFirst({
      where: { id: command.groupId, organizationId },
      select: { categoryId: true, name: true, sortOrder: true, isActive: true },
    });
    before = group ?? undefined;
  } else if (command.operation === "UPDATE_PRODUCT" || command.operation === "DELETE_PRODUCT" || command.operation === "CLONE_PRODUCT") {
    const product = await prisma.product.findFirst({
      where: { id: command.productId, organizationId },
      select: {
        categoryId: true,
        groupId: true,
        name: true,
        description: true,
        defaultPrice: true,
        imageUrl: true,
        sortOrder: true,
        isActive: true,
      },
    });
    before = product ?? undefined;
  } else if (command.operation === "SET_ASSIGNMENTS") {
    const assignments = await prisma.stallProduct.findMany({
      where: { organizationId, productId: command.productId, stallId: { in: authorizedStallIds } },
      select: { stallId: true },
      orderBy: { stallId: "asc" },
    });
    before = { stallIds: assignments.map((assignment) => assignment.stallId) };
  }

  try {
    if (command.operation === "CREATE_PRODUCT" || command.operation === "CLONE_PRODUCT") {
      await entitlementService.assertLimitAvailable(organizationId, "PRODUCTS", 1);
    } else {
      await entitlementService.assertSubscriptionUsable(organizationId);
    }
    const result = await prisma.$transaction(async (transaction) => {
      if (command.operation === "CREATE_CATEGORY") {
        return transaction.productCategory.create({
          data: { organizationId, name: command.name, sortOrder: command.sortOrder },
          select: { id: true },
        });
      }
      if (command.operation === "UPDATE_CATEGORY") {
        const existing = await transaction.productCategory.findFirst({
          where: { id: command.categoryId, organizationId },
          select: { id: true },
        });
        if (!existing) throw new CatalogNotFoundError();
        return transaction.productCategory.update({
          where: { id: existing.id },
          data: { name: command.name, sortOrder: command.sortOrder, isActive: command.isActive },
          select: { id: true },
        });
      }
      if (command.operation === "CREATE_GROUP" || command.operation === "UPDATE_GROUP") {
        const category = await transaction.productCategory.findFirst({
          where: { id: command.categoryId, organizationId },
          select: { id: true },
        });
        if (!category) throw new CatalogNotFoundError();
        if (command.operation === "CREATE_GROUP") {
          return transaction.productGroup.create({
            data: {
              organizationId,
              categoryId: category.id,
              name: command.name,
              sortOrder: command.sortOrder,
            },
            select: { id: true },
          });
        }
        const existing = await transaction.productGroup.findFirst({
          where: { id: command.groupId, organizationId },
          select: { id: true, categoryId: true },
        });
        if (!existing) throw new CatalogNotFoundError();
        const updated = await transaction.productGroup.update({
          where: { id: existing.id },
          data: {
            categoryId: category.id,
            name: command.name,
            sortOrder: command.sortOrder,
            isActive: command.isActive,
          },
          select: { id: true },
        });
        if (existing.categoryId !== category.id) {
          await transaction.product.updateMany({
            where: { organizationId, groupId: existing.id },
            data: { categoryId: category.id },
          });
        }
        return updated;
      }
      if (command.operation === "CREATE_PRODUCT" || command.operation === "UPDATE_PRODUCT") {
        const [category, group] = await Promise.all([
          transaction.productCategory.findFirst({
            where: { id: command.categoryId, organizationId },
            select: { id: true },
          }),
          command.groupId
            ? transaction.productGroup.findFirst({
              where: { id: command.groupId, organizationId, categoryId: command.categoryId },
              select: { id: true },
            })
            : Promise.resolve(null),
        ]);
        if (!category || (command.groupId && !group)) throw new CatalogNotFoundError();
        const productData = {
          categoryId: category.id,
          groupId: group?.id ?? null,
          name: command.name,
          description: command.description,
          defaultPrice: command.defaultPrice,
          imageUrl: command.imageUrl,
          sortOrder: command.sortOrder,
        };
        if (command.operation === "CREATE_PRODUCT") {
          const product = await transaction.product.create({
            data: { organizationId, ...productData },
            select: { id: true },
          });
          if (command.translations.length > 0) {
            await transaction.productTranslation.createMany({
              data: command.translations.map((translation) => ({ organizationId, productId: product.id, ...translation })),
            });
          }
          if (command.stallIds.length > 0) {
            await transaction.stallProduct.createMany({
              data: command.stallIds.map((stallId) => ({
                organizationId,
                stallId,
                productId: product.id,
                sortOrder: command.sortOrder,
              })),
            });
          }
          return product;
        }
        const existing = await transaction.product.findFirst({
          where: { id: command.productId, organizationId },
          select: { id: true },
        });
        if (!existing) throw new CatalogNotFoundError();
        const product = await transaction.product.update({
          where: { id: existing.id },
          data: { ...productData, isActive: command.isActive },
          select: { id: true },
        });
        await transaction.productTranslation.deleteMany({
          where: { productId: product.id, organizationId, locale: { notIn: command.translations.map((translation) => translation.locale) } },
        });
        await Promise.all(command.translations.map((translation) => transaction.productTranslation.upsert({
          where: { productId_locale: { productId: product.id, locale: translation.locale } },
          create: { organizationId, productId: product.id, ...translation },
          update: { name: translation.name, description: translation.description },
        })));
        if (!command.isActive) {
          await transaction.stallProduct.updateMany({
            where: { organizationId, productId: product.id },
            data: { isEnabled: false },
          });
        }
        return product;
      }

      if (command.operation === "DELETE_PRODUCT") {
        const existing = await transaction.product.findFirst({
          where: { id: command.productId, organizationId },
          select: { id: true },
        });
        if (!existing) throw new CatalogNotFoundError();
        await transaction.product.delete({ where: { id: existing.id } });
        return existing;
      }

      if (command.operation === "CLONE_PRODUCT") {
        const source = await transaction.product.findFirst({
          where: { id: command.productId, organizationId },
          include: {
            translations: true,
            noteGroupAssignments: true,
            stallProducts: true,
          },
        });
        if (!source) throw new CatalogNotFoundError();
        const product = await transaction.product.create({
          data: {
            organizationId,
            categoryId: source.categoryId,
            groupId: source.groupId,
            name: copyProductName(source.name),
            description: source.description,
            defaultPrice: source.defaultPrice,
            imageUrl: source.imageUrl,
            isActive: source.isActive,
            sortOrder: Math.min(10_000, source.sortOrder + 1),
          },
          select: { id: true },
        });
        if (source.translations.length > 0) {
          await transaction.productTranslation.createMany({
            data: source.translations.map((translation) => ({
              organizationId,
              productId: product.id,
              locale: translation.locale,
              name: translation.name,
              description: translation.description,
            })),
          });
        }
        if (source.noteGroupAssignments.length > 0) {
          await transaction.productNoteGroupAssignment.createMany({
            data: source.noteGroupAssignments.map((assignment) => ({
              organizationId,
              productId: product.id,
              noteGroupId: assignment.noteGroupId,
              sortOrder: assignment.sortOrder,
              isActive: assignment.isActive,
            })),
          });
        }
        if (source.stallProducts.length > 0) {
          await transaction.stallProduct.createMany({
            data: source.stallProducts.map((assignment) => ({
              organizationId,
              stallId: assignment.stallId,
              productId: product.id,
              priceOverride: assignment.priceOverride,
              isEnabled: assignment.isEnabled,
              isSoldOut: assignment.isSoldOut,
              sortOrder: Math.min(10_000, assignment.sortOrder + 1),
              availableFrom: assignment.availableFrom,
              availableUntil: assignment.availableUntil,
            })),
          });
        }
        return product;
      }

      const product = await transaction.product.findFirst({
        where: { id: command.productId, organizationId },
        select: { id: true, sortOrder: true },
      });
      if (!product) throw new CatalogNotFoundError();
      await transaction.stallProduct.deleteMany({
        where: {
          organizationId,
          productId: product.id,
          stallId: { in: authorizedStallIds, notIn: command.stallIds },
        },
      });
      if (command.stallIds.length > 0) {
        await Promise.all(command.stallIds.map((stallId) => transaction.stallProduct.upsert({
          where: { stallId_productId: { stallId, productId: product.id } },
          create: { organizationId, stallId, productId: product.id, sortOrder: product.sortOrder },
          update: {},
          select: { id: true },
        })));
      }
      return product;
    });

    const action = catalogAuditAction(command.operation);
    const after: Record<string, Prisma.InputJsonValue | null> = {
      operation: command.operation,
      entityId: result.id,
    };
    if ("name" in command) after.name = command.name;
    if ("sortOrder" in command) after.sortOrder = command.sortOrder;
    if ("categoryId" in command) after.categoryId = command.categoryId;
    if ("groupId" in command) after.groupId = command.groupId;
    if ("description" in command) after.description = command.description;
    if ("defaultPrice" in command) after.defaultPrice = command.defaultPrice;
    if ("imageUrl" in command) after.imageUrl = command.imageUrl;
    if ("translations" in command) after.translations = command.translations;
    if ("isActive" in command) after.isActive = command.isActive;
    if ("stallIds" in command) after.stallIds = [...command.stallIds].sort();
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action,
      entityType: command.operation.includes("CATEGORY")
        ? "PRODUCT_CATEGORY"
        : command.operation.includes("GROUP") ? "PRODUCT_GROUP" : "PRODUCT",
      entityId: result.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      before,
      after,
      metadata: "stallIds" in command ? { assignedStallCount: command.stallIds.length } : undefined,
    });
    invalidatePublicMenus(authorizedStallIds);

    return NextResponse.json(
      { catalog: await getOrganizationCatalog(organizationId, authorizedStallIds) },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const notFound = error instanceof CatalogNotFoundError;
    return NextResponse.json(
      { error: duplicate ? "名稱已存在。" : notFound ? "找不到指定的商品主檔資料。" : "目前無法更新商品主檔。" },
      { status: duplicate ? 409 : notFound ? 404 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

class CatalogNotFoundError extends Error {}

function catalogAuditAction(operation: string) {
  const actions: Record<string, string> = {
    CREATE_CATEGORY: "PRODUCT_CATEGORY_CREATED",
    UPDATE_CATEGORY: "PRODUCT_CATEGORY_UPDATED",
    CREATE_GROUP: "PRODUCT_GROUP_CREATED",
    UPDATE_GROUP: "PRODUCT_GROUP_UPDATED",
    CREATE_PRODUCT: "PRODUCT_CREATED",
    UPDATE_PRODUCT: "PRODUCT_UPDATED",
    DELETE_PRODUCT: "PRODUCT_DELETED",
    CLONE_PRODUCT: "PRODUCT_CLONED",
    SET_ASSIGNMENTS: "PRODUCT_STALL_ASSIGNMENTS_CHANGED",
  };
  return actions[operation] ?? "CATALOG_UPDATED";
}

function copyProductName(name: string) {
  const suffix = "（副本）";
  return `${name.slice(0, 80 - suffix.length)}${suffix}`;
}
