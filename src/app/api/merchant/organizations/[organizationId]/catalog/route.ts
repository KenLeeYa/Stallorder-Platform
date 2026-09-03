import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { getOrganizationCatalog } from "@/lib/catalog-data";
import { getSharedCatalogFieldErrors, sharedCatalogCommandSchema } from "@/lib/catalog-validation";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { MAX_BUNDLE_CHOICES_PER_ORDER_ITEM } from "@/lib/product-bundle-types";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";
import { invalidatePublicMenus } from "@/lib/public-menu";
import {
  attachCatalogImageUpload,
  CatalogImageLeaseError,
  enqueueUnreferencedCatalogImageDeletion,
} from "@/server/catalog/catalog-image-upload-service";

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
    const fieldErrors = getSharedCatalogFieldErrors(parsed.error);
    return NextResponse.json(
      { error: Object.values(fieldErrors)[0] ?? "商品主檔資料格式不正確。", fieldErrors },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const authorizedStallIds = authorization.workspace.stalls.map((stall) => stall.id);
  const authorizedStallSet = new Set(authorizedStallIds);
  const activeAuthorizedStallSet = new Set(
    authorization.workspace.stalls
      .filter((stall) => stall.isActive)
      .map((stall) => stall.id),
  );
  const command = parsed.data;
  const singleStallMode = authorization.workspace.operatingMode === "SINGLE_STALL";
  const singleActiveStallId = singleStallMode
    ? authorization.workspace.stalls.find((stall) => stall.isActive)?.id
    : undefined;
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
  if (
    "checkoutUpsellStallIds" in command
    && command.checkoutUpsellStallIds?.some((stallId) => !authorizedStallSet.has(stallId))
  ) {
    return NextResponse.json(
      { error: "推薦加點清單包含未授權攤位。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (singleStallMode && command.operation === "SET_ASSIGNMENTS") {
    return NextResponse.json(
      { error: "單攤位營運會自動套用目前攤位，不需要設定商品分派。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  let before: Prisma.InputJsonObject | undefined;
  if (command.operation === "UPDATE_CATEGORY") {
    const category = await prisma.productCategory.findFirst({
      where: { id: command.categoryId, organizationId },
      select: { name: true, sortOrder: true, isActive: true, translations: { select: { locale: true, name: true } } },
    });
    before = category ?? undefined;
  } else if (command.operation === "UPDATE_GROUP") {
    const group = await prisma.productGroup.findFirst({
      where: { id: command.groupId, organizationId },
      select: { categoryId: true, name: true, sortOrder: true, isActive: true, translations: { select: { locale: true, name: true } } },
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
        kind: true,
        imageUrl: true,
        isOrderDiscountEligible: true,
        isLotteryEligible: true,
        sortOrder: true,
        isActive: true,
        stallProducts: {
          where: { stallId: { in: authorizedStallIds } },
          select: { stallId: true, isEnabled: true, isSoldOut: true },
          orderBy: { stallId: "asc" },
        },
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
  } else if (
    command.operation === "UPDATE_BUNDLE_CHOICE_GROUP"
    || command.operation === "DELETE_BUNDLE_CHOICE_GROUP"
  ) {
    const choiceGroup = await prisma.productBundleChoiceGroup.findFirst({
      where: { id: command.choiceGroupId, organizationId },
      select: {
        bundleProductId: true,
        name: true,
        minSelections: true,
        maxSelections: true,
        sortOrder: true,
      },
    });
    before = choiceGroup ?? undefined;
  } else if (
    command.operation === "UPDATE_BUNDLE_CHOICE"
    || command.operation === "DELETE_BUNDLE_CHOICE"
  ) {
    const choice = await prisma.productBundleChoice.findFirst({
      where: { id: command.choiceId, organizationId },
      select: {
        choiceGroupId: true,
        componentProductId: true,
        quantity: true,
        priceDelta: true,
        isEnabled: true,
        sortOrder: true,
      },
    });
    before = choice ?? undefined;
  }

  try {
    if (command.operation === "CREATE_PRODUCT" || command.operation === "CLONE_PRODUCT") {
      await entitlementService.assertLimitAvailable(organizationId, "PRODUCTS", 1);
    } else {
      await entitlementService.assertSubscriptionUsable(organizationId);
    }
    const result = await prisma.$transaction(async (transaction) => {
      if (command.operation === "REORDER_CATEGORIES") {
        const categories = await transaction.productCategory.findMany({
          where: { organizationId },
          select: { id: true },
        });
        if (!sameIdSet(categories.map((category) => category.id), command.categoryIds)) {
          throw new CatalogConflictError("分類排序清單與目前商品目錄不一致，請重新整理後再試。");
        }
        const reordered = command.categoryIds.map((id, sortOrder) => ({ id, sort_order: sortOrder }));
        const updatedCount = await transaction.$executeRaw(Prisma.sql`
          update public.product_categories as category
          set sort_order = reordered.sort_order, updated_at = now()
          from jsonb_to_recordset(${JSON.stringify(reordered)}::jsonb) as reordered(
            id uuid,
            sort_order integer
          )
          where category.id = reordered.id
            and category.organization_id = ${organizationId}::uuid
        `);
        if (updatedCount !== command.categoryIds.length) {
          throw new CatalogConflictError("分類排序期間目錄已變更，請重新整理後再試。");
        }
        return { id: organizationId };
      }
      if (command.operation === "REORDER_GROUPS") {
        const groups = await transaction.productGroup.findMany({
          where: { organizationId, categoryId: command.categoryId },
          select: { id: true },
        });
        if (!sameIdSet(groups.map((group) => group.id), command.groupIds)) {
          throw new CatalogConflictError("群組排序清單與目前商品目錄不一致，請重新整理後再試。");
        }
        const reordered = command.groupIds.map((id, sortOrder) => ({ id, sort_order: sortOrder }));
        const updatedCount = await transaction.$executeRaw(Prisma.sql`
          update public.product_groups as product_group
          set sort_order = reordered.sort_order, updated_at = now()
          from jsonb_to_recordset(${JSON.stringify(reordered)}::jsonb) as reordered(
            id uuid,
            sort_order integer
          )
          where product_group.id = reordered.id
            and product_group.organization_id = ${organizationId}::uuid
            and product_group.category_id = ${command.categoryId}::uuid
        `);
        if (updatedCount !== command.groupIds.length) {
          throw new CatalogConflictError("群組排序期間目錄已變更，請重新整理後再試。");
        }
        return { id: command.categoryId };
      }
      if (command.operation === "REORDER_PRODUCTS") {
        const products = await transaction.product.findMany({
          where: {
            organizationId,
            categoryId: command.categoryId,
            groupId: command.groupId,
          },
          select: { id: true },
        });
        if (!sameIdSet(products.map((product) => product.id), command.productIds)) {
          throw new CatalogConflictError("商品排序清單與目前商品目錄不一致，請重新整理後再試。");
        }
        const reordered = command.productIds.map((id, sortOrder) => ({ id, sort_order: sortOrder }));
        const updatedCount = await transaction.$executeRaw(Prisma.sql`
          update public.products as product
          set sort_order = reordered.sort_order, updated_at = now()
          from jsonb_to_recordset(${JSON.stringify(reordered)}::jsonb) as reordered(
            id uuid,
            sort_order integer
          )
          where product.id = reordered.id
            and product.organization_id = ${organizationId}::uuid
            and product.category_id = ${command.categoryId}::uuid
            and product.group_id is not distinct from ${command.groupId}::uuid
        `);
        if (updatedCount !== command.productIds.length) {
          throw new CatalogConflictError("商品排序期間目錄已變更，請重新整理後再試。");
        }
        await transaction.$executeRaw(Prisma.sql`
          update public.stall_products as assignment
          set sort_order = reordered.sort_order, updated_at = now()
          from jsonb_to_recordset(${JSON.stringify(reordered)}::jsonb) as reordered(
            id uuid,
            sort_order integer
          )
          where assignment.product_id = reordered.id
            and assignment.organization_id = ${organizationId}::uuid
        `);
        return { id: command.groupId ?? command.categoryId };
      }
      if (command.operation === "CREATE_CATEGORY") {
        return transaction.productCategory.create({
          data: {
            organizationId,
            name: command.name,
            sortOrder: command.sortOrder,
            translations: {
              create: command.translations.map((translation) => ({ organizationId, ...translation })),
            },
          },
          select: { id: true },
        });
      }
      if (command.operation === "UPDATE_CATEGORY") {
        const existing = await transaction.productCategory.findFirst({
          where: { id: command.categoryId, organizationId },
          select: { id: true },
        });
        if (!existing) throw new CatalogNotFoundError();
        const updated = await transaction.productCategory.update({
          where: { id: existing.id },
          data: { name: command.name, sortOrder: command.sortOrder, isActive: command.isActive },
          select: { id: true },
        });
        if (command.translations) {
          await transaction.productCategoryTranslation.deleteMany({
            where: { categoryId: existing.id, organizationId, locale: { notIn: command.translations.map((translation) => translation.locale) } },
          });
          await Promise.all(command.translations.map((translation) => transaction.productCategoryTranslation.upsert({
            where: { categoryId_locale: { categoryId: existing.id, locale: translation.locale } },
            create: { organizationId, categoryId: existing.id, ...translation },
            update: { name: translation.name },
          })));
        }
        return updated;
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
              translations: {
                create: command.translations.map((translation) => ({ organizationId, ...translation })),
              },
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
        if (command.translations) {
          await transaction.productGroupTranslation.deleteMany({
            where: { groupId: existing.id, organizationId, locale: { notIn: command.translations.map((translation) => translation.locale) } },
          });
          await Promise.all(command.translations.map((translation) => transaction.productGroupTranslation.upsert({
            where: { groupId_locale: { groupId: existing.id, locale: translation.locale } },
            create: { organizationId, groupId: existing.id, ...translation },
            update: { name: translation.name },
          })));
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
          kind: command.kind,
          imageUrl: command.imageUrl,
          ...(command.isOrderDiscountEligible === undefined
            ? {}
            : { isOrderDiscountEligible: command.isOrderDiscountEligible }),
          ...(command.isLotteryEligible === undefined
            ? {}
            : { isLotteryEligible: command.isLotteryEligible }),
          sortOrder: command.sortOrder,
        };
        if (command.operation === "CREATE_PRODUCT") {
          const product = await transaction.product.create({
            data: { organizationId, ...productData },
            select: { id: true },
          });
          await attachCatalogImageUpload(transaction, organizationId, command.imageUrl);
          if (command.translations.length > 0) {
            await transaction.productTranslation.createMany({
              data: command.translations.map((translation) => ({ organizationId, productId: product.id, ...translation })),
            });
          }
          const assignmentStallIds = singleStallMode
            ? (singleActiveStallId ? [singleActiveStallId] : [])
            : command.stallIds;
          if (assignmentStallIds.length > 0) {
            await transaction.stallProduct.createMany({
              data: assignmentStallIds.map((stallId) => ({
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
          select: {
            id: true,
            categoryId: true,
            groupId: true,
            kind: true,
            imageUrl: true,
            isActive: true,
            sortOrder: true,
            stallProducts: {
              where: { stallId: { in: authorizedStallIds } },
              select: { stallId: true, isEnabled: true, isSoldOut: true },
            },
            _count: { select: { bundleChoiceGroups: true, componentChoices: true } },
          },
        });
        if (!existing) throw new CatalogNotFoundError();
        if (command.kind === "BUNDLE" && existing._count.componentChoices > 0) {
          throw new CatalogConflictError("此商品已被其他套餐使用，不能改成套餐。");
        }
        if (command.kind === "SINGLE" && existing._count.bundleChoiceGroups > 0) {
          throw new CatalogConflictError("請先移除套餐選擇群組，再改成一般商品。");
        }
        await shiftProductSortOrder(
          transaction,
          organizationId,
          existing.id,
          { categoryId: existing.categoryId, groupId: existing.groupId, sortOrder: existing.sortOrder },
          { categoryId: category.id, groupId: group?.id ?? null, sortOrder: command.sortOrder },
        );
        const product = await transaction.product.update({
          where: { id: existing.id },
          data: { ...productData, isActive: true },
          select: { id: true },
        });
        if (command.imageUrl !== existing.imageUrl) {
          await attachCatalogImageUpload(transaction, organizationId, command.imageUrl);
          await enqueueUnreferencedCatalogImageDeletion(
            transaction,
            organizationId,
            existing.imageUrl,
          );
        }
        await transaction.productTranslation.deleteMany({
          where: { productId: product.id, organizationId, locale: { notIn: command.translations.map((translation) => translation.locale) } },
        });
        await Promise.all(command.translations.map((translation) => transaction.productTranslation.upsert({
          where: { productId_locale: { productId: product.id, locale: translation.locale } },
          create: { organizationId, productId: product.id, ...translation },
          update: { name: translation.name, description: translation.description },
        })));
        await transaction.stallProduct.updateMany({
          where: { organizationId, productId: product.id },
          data: {
            isSoldOut: command.isSoldOut,
            sortOrder: command.sortOrder,
            ...(!existing.isActive ? { isEnabled: true } : {}),
          },
        });
        if (command.checkoutUpsellStallIds !== undefined) {
          const selectedStallIds = new Set(command.checkoutUpsellStallIds);
          const assignedStallIds = new Set(
            existing.stallProducts.map((assignment) => assignment.stallId),
          );
          if ([...selectedStallIds].some((stallId) => !assignedStallIds.has(stallId))) {
            throw new CatalogConflictError("推薦加點只能套用到已分派此商品的攤位。");
          }
          if ([...selectedStallIds].some((stallId) => !activeAuthorizedStallSet.has(stallId))) {
            throw new CatalogConflictError("已停用攤位不能開啟推薦加點。");
          }
          if (command.kind !== "SINGLE" && selectedStallIds.size > 0) {
            throw new CatalogConflictError("套餐目前不支援結帳前推薦加點。");
          }
          if (command.isSoldOut && selectedStallIds.size > 0) {
            throw new CatalogConflictError("請先恢復供應商品，再設為結帳推薦。");
          }
          const unavailableSelection = existing.stallProducts.some((assignment) => (
            selectedStallIds.has(assignment.stallId) && !assignment.isEnabled
          ));
          if (unavailableSelection) {
            throw new CatalogConflictError("請先啟用攤位商品，再設為結帳推薦。");
          }

          const settingsRows = await transaction.stallOrderingSettings.findMany({
            where: { stallId: { in: authorizedStallIds } },
            select: { stallId: true, checkoutUpsellProductIds: true },
          });
          const settingsStallIds = new Set(settingsRows.map((settings) => settings.stallId));
          if ([...selectedStallIds].some((stallId) => !settingsStallIds.has(stallId))) {
            throw new CatalogConflictError("找不到所選攤位的線上點餐設定。");
          }
          await Promise.all(settingsRows.map((settings) => {
            const otherProductIds = settings.checkoutUpsellProductIds.filter(
              (productId) => productId !== product.id,
            );
            if (selectedStallIds.has(settings.stallId) && otherProductIds.length >= 6) {
              throw new CatalogConflictError("每個攤位最多可設定 6 項結帳推薦商品。");
            }
            return transaction.stallOrderingSettings.update({
              where: { stallId: settings.stallId },
              data: {
                checkoutUpsellProductIds: selectedStallIds.has(settings.stallId)
                  ? [...otherProductIds, product.id]
                  : otherProductIds,
              },
              select: { stallId: true },
            });
          }));
        }
        return product;
      }

      if (command.operation === "DELETE_PRODUCT") {
        const existing = await transaction.product.findFirst({
          where: { id: command.productId, organizationId },
          select: { id: true, imageUrl: true },
        });
        if (!existing) throw new CatalogNotFoundError();
        await transaction.product.delete({ where: { id: existing.id } });
        await enqueueUnreferencedCatalogImageDeletion(
          transaction,
          organizationId,
          existing.imageUrl,
        );
        return existing;
      }

      if (command.operation === "CLONE_PRODUCT") {
        const source = await transaction.product.findFirst({
          where: { id: command.productId, organizationId },
          include: {
            translations: true,
            noteGroupAssignments: true,
            stallProducts: true,
            bundleChoiceGroups: { include: { choices: true } },
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
            kind: source.kind,
            imageUrl: source.imageUrl,
            isOrderDiscountEligible: source.isOrderDiscountEligible,
            isLotteryEligible: source.isLotteryEligible,
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
        for (const sourceGroup of source.bundleChoiceGroups) {
          const choiceGroup = await transaction.productBundleChoiceGroup.create({
            data: {
              organizationId,
              bundleProductId: product.id,
              name: sourceGroup.name,
              minSelections: sourceGroup.minSelections,
              maxSelections: sourceGroup.maxSelections,
              sortOrder: sourceGroup.sortOrder,
            },
            select: { id: true },
          });
          if (sourceGroup.choices.length > 0) {
            await transaction.productBundleChoice.createMany({
              data: sourceGroup.choices.map((choice) => ({
                organizationId,
                choiceGroupId: choiceGroup.id,
                componentProductId: choice.componentProductId,
                quantity: choice.quantity,
                priceDelta: choice.priceDelta,
                isEnabled: choice.isEnabled,
                sortOrder: choice.sortOrder,
              })),
            });
          }
        }
        return product;
      }

      if (command.operation === "CREATE_BUNDLE_CHOICE_GROUP") {
        const bundle = await transaction.product.findFirst({
          where: { id: command.bundleProductId, organizationId },
          select: { id: true, kind: true },
        });
        if (!bundle) throw new CatalogNotFoundError();
        if (bundle.kind !== "BUNDLE") {
          throw new CatalogConflictError("只有套餐商品可以建立選擇群組。");
        }
        await assertBundleChoiceSelectionLimit(
          transaction,
          organizationId,
          bundle.id,
          command.maxSelections,
        );
        return transaction.productBundleChoiceGroup.create({
          data: {
            organizationId,
            bundleProductId: bundle.id,
            name: command.name,
            minSelections: command.minSelections,
            maxSelections: command.maxSelections,
            sortOrder: command.sortOrder,
          },
          select: { id: true },
        });
      }

      if (command.operation === "UPDATE_BUNDLE_CHOICE_GROUP") {
        const existing = await transaction.productBundleChoiceGroup.findFirst({
          where: { id: command.choiceGroupId, organizationId },
          select: { id: true, bundleProductId: true },
        });
        if (!existing) throw new CatalogNotFoundError();
        await assertBundleChoiceSelectionLimit(
          transaction,
          organizationId,
          existing.bundleProductId,
          command.maxSelections,
          existing.id,
        );
        return transaction.productBundleChoiceGroup.update({
          where: { id: existing.id },
          data: {
            name: command.name,
            minSelections: command.minSelections,
            maxSelections: command.maxSelections,
            sortOrder: command.sortOrder,
          },
          select: { id: true },
        });
      }

      if (command.operation === "DELETE_BUNDLE_CHOICE_GROUP") {
        const existing = await transaction.productBundleChoiceGroup.findFirst({
          where: { id: command.choiceGroupId, organizationId },
          select: { id: true },
        });
        if (!existing) throw new CatalogNotFoundError();
        await transaction.productBundleChoiceGroup.delete({ where: { id: existing.id } });
        return existing;
      }

      if (command.operation === "CREATE_BUNDLE_CHOICE") {
        await validateBundleChoiceReferences(
          transaction,
          organizationId,
          command.choiceGroupId,
          command.componentProductId,
        );
        return transaction.productBundleChoice.create({
          data: {
            organizationId,
            choiceGroupId: command.choiceGroupId,
            componentProductId: command.componentProductId,
            quantity: command.quantity,
            priceDelta: command.priceDelta,
            isEnabled: command.isEnabled,
            sortOrder: command.sortOrder,
          },
          select: { id: true },
        });
      }

      if (command.operation === "UPDATE_BUNDLE_CHOICE") {
        const existing = await transaction.productBundleChoice.findFirst({
          where: { id: command.choiceId, organizationId },
          select: { id: true },
        });
        if (!existing) throw new CatalogNotFoundError();
        await validateBundleChoiceReferences(
          transaction,
          organizationId,
          command.choiceGroupId,
          command.componentProductId,
        );
        return transaction.productBundleChoice.update({
          where: { id: existing.id },
          data: {
            choiceGroupId: command.choiceGroupId,
            componentProductId: command.componentProductId,
            quantity: command.quantity,
            priceDelta: command.priceDelta,
            isEnabled: command.isEnabled,
            sortOrder: command.sortOrder,
          },
          select: { id: true },
        });
      }

      if (command.operation === "DELETE_BUNDLE_CHOICE") {
        const existing = await transaction.productBundleChoice.findFirst({
          where: { id: command.choiceId, organizationId },
          select: { id: true },
        });
        if (!existing) throw new CatalogNotFoundError();
        await transaction.productBundleChoice.delete({ where: { id: existing.id } });
        return existing;
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
    if ("kind" in command && command.kind) after.kind = command.kind;
    if ("imageUrl" in command) after.imageUrl = command.imageUrl;
    if ("isOrderDiscountEligible" in command && command.isOrderDiscountEligible !== undefined) {
      after.isOrderDiscountEligible = command.isOrderDiscountEligible;
    }
    if ("isLotteryEligible" in command && command.isLotteryEligible !== undefined) {
      after.isLotteryEligible = command.isLotteryEligible;
    }
    if ("checkoutUpsellStallIds" in command && command.checkoutUpsellStallIds !== undefined) {
      after.checkoutUpsellStallIds = [...command.checkoutUpsellStallIds].sort();
    }
    if ("translations" in command && command.translations) after.translations = command.translations;
    if ("isActive" in command) after.isActive = command.isActive;
    if ("isSoldOut" in command) after.isSoldOut = command.isSoldOut;
    if ("stallIds" in command) after.stallIds = [...command.stallIds].sort();
    if ("bundleProductId" in command) after.bundleProductId = command.bundleProductId;
    if ("choiceGroupId" in command) after.choiceGroupId = command.choiceGroupId;
    if ("componentProductId" in command) after.componentProductId = command.componentProductId;
    if ("minSelections" in command) after.minSelections = command.minSelections;
    if ("maxSelections" in command) after.maxSelections = command.maxSelections;
    if ("quantity" in command) after.quantity = command.quantity;
    if ("priceDelta" in command) after.priceDelta = command.priceDelta;
    if ("isEnabled" in command) after.isEnabled = command.isEnabled;
    if ("categoryIds" in command) after.categoryIds = command.categoryIds;
    if ("groupIds" in command) after.groupIds = command.groupIds;
    if ("productIds" in command) after.productIds = command.productIds;
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action,
      entityType: catalogEntityType(command.operation),
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
    const foreignKeyConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
    const conflict = error instanceof CatalogConflictError || foreignKeyConflict;
    const notFound = error instanceof CatalogNotFoundError;
    const invalidImageLease = error instanceof CatalogImageLeaseError;
    const fieldErrors = catalogCommandFieldErrors(command, { duplicate, conflictError: error });
    return NextResponse.json(
      {
        error: duplicate
          ? Object.values(fieldErrors)[0] ?? "名稱或套餐選項已存在。"
          : invalidImageLease
            ? "圖片暫存已逾時或不屬於此組織，請重新上傳圖片。"
          : conflict
            ? error instanceof CatalogConflictError
              ? error.message
              : "此商品仍被套餐使用，請先移除套餐選項。"
            : notFound
              ? "找不到指定的商品主檔資料。"
              : "目前無法更新商品主檔。",
        ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
      },
      {
        status: duplicate || conflict || invalidImageLease ? 409 : notFound ? 404 : 500,
        headers: { "x-request-id": authorization.requestId },
      },
    );
  }
}

class CatalogNotFoundError extends Error {}

class CatalogConflictError extends Error {}

type ProductSortPosition = {
  categoryId: string;
  groupId: string | null;
  sortOrder: number;
};

async function shiftProductSortOrder(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  previous: ProductSortPosition,
  next: ProductSortPosition,
) {
  const sameScope = previous.categoryId === next.categoryId && previous.groupId === next.groupId;
  if (sameScope && previous.sortOrder === next.sortOrder) return;

  if (sameScope) {
    if (next.sortOrder < previous.sortOrder) {
      await transaction.product.updateMany({
        where: {
          organizationId,
          categoryId: next.categoryId,
          groupId: next.groupId,
          id: { not: productId },
          sortOrder: { gte: next.sortOrder, lt: previous.sortOrder },
        },
        data: { sortOrder: { increment: 1 } },
      });
    } else {
      await transaction.product.updateMany({
        where: {
          organizationId,
          categoryId: next.categoryId,
          groupId: next.groupId,
          id: { not: productId },
          sortOrder: { gt: previous.sortOrder, lte: next.sortOrder },
        },
        data: { sortOrder: { decrement: 1 } },
      });
    }
    await synchronizeStallProductSortOrder(transaction, organizationId, next);
    return;
  }

  await transaction.product.updateMany({
    where: {
      organizationId,
      categoryId: previous.categoryId,
      groupId: previous.groupId,
      id: { not: productId },
      sortOrder: { gt: previous.sortOrder },
    },
    data: { sortOrder: { decrement: 1 } },
  });
  await transaction.product.updateMany({
    where: {
      organizationId,
      categoryId: next.categoryId,
      groupId: next.groupId,
      id: { not: productId },
      sortOrder: { gte: next.sortOrder },
    },
    data: { sortOrder: { increment: 1 } },
  });
  await synchronizeStallProductSortOrder(transaction, organizationId, previous);
  await synchronizeStallProductSortOrder(transaction, organizationId, next);
}

async function synchronizeStallProductSortOrder(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  scope: Pick<ProductSortPosition, "categoryId" | "groupId">,
) {
  await transaction.$executeRaw(Prisma.sql`
    update public.stall_products as assignment
    set sort_order = product.sort_order, updated_at = now()
    from public.products as product
    where assignment.product_id = product.id
      and assignment.organization_id = ${organizationId}::uuid
      and product.organization_id = ${organizationId}::uuid
      and product.category_id = ${scope.categoryId}::uuid
      and product.group_id is not distinct from ${scope.groupId}::uuid
  `);
}

function catalogCommandFieldErrors(
  command: { operation: string },
  result: { duplicate: boolean; conflictError: unknown },
) {
  if (result.duplicate) {
    if (command.operation === "CREATE_BUNDLE_CHOICE" || command.operation === "UPDATE_BUNDLE_CHOICE") {
      return { componentProductId: "此套餐商品已加入目前群組。" };
    }
    if ("name" in command) return { name: "此名稱已存在，請使用其他名稱。" };
  }
  if (
    result.conflictError instanceof CatalogConflictError
    && (command.operation === "CREATE_BUNDLE_CHOICE_GROUP"
      || command.operation === "UPDATE_BUNDLE_CHOICE_GROUP")
  ) {
    return { maxSelections: result.conflictError.message };
  }
  return {};
}

async function assertBundleChoiceSelectionLimit(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  bundleProductId: string,
  nextMaxSelections: number,
  excludedChoiceGroupId?: string,
) {
  const aggregate = await transaction.productBundleChoiceGroup.aggregate({
    where: {
      organizationId,
      bundleProductId,
      ...(excludedChoiceGroupId ? { id: { not: excludedChoiceGroupId } } : {}),
    },
    _sum: { maxSelections: true },
  });
  if ((aggregate._sum.maxSelections ?? 0) + nextMaxSelections > MAX_BUNDLE_CHOICES_PER_ORDER_ITEM) {
    throw new CatalogConflictError(
      `每個套餐最多可設定 ${MAX_BUNDLE_CHOICES_PER_ORDER_ITEM} 個選項上限，請降低群組的最多選擇數。`,
    );
  }
}

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
    REORDER_CATEGORIES: "PRODUCT_CATEGORIES_REORDERED",
    REORDER_GROUPS: "PRODUCT_GROUPS_REORDERED",
    REORDER_PRODUCTS: "PRODUCTS_REORDERED",
    CREATE_BUNDLE_CHOICE_GROUP: "PRODUCT_BUNDLE_CHOICE_GROUP_CREATED",
    UPDATE_BUNDLE_CHOICE_GROUP: "PRODUCT_BUNDLE_CHOICE_GROUP_UPDATED",
    DELETE_BUNDLE_CHOICE_GROUP: "PRODUCT_BUNDLE_CHOICE_GROUP_DELETED",
    CREATE_BUNDLE_CHOICE: "PRODUCT_BUNDLE_CHOICE_CREATED",
    UPDATE_BUNDLE_CHOICE: "PRODUCT_BUNDLE_CHOICE_UPDATED",
    DELETE_BUNDLE_CHOICE: "PRODUCT_BUNDLE_CHOICE_DELETED",
  };
  return actions[operation] ?? "CATALOG_UPDATED";
}

function catalogEntityType(operation: string) {
  if (operation.includes("BUNDLE_CHOICE_GROUP")) return "PRODUCT_BUNDLE_CHOICE_GROUP";
  if (operation.includes("BUNDLE_CHOICE")) return "PRODUCT_BUNDLE_CHOICE";
  if (operation.includes("CATEGORY")) return "PRODUCT_CATEGORY";
  if (operation === "CREATE_GROUP" || operation === "UPDATE_GROUP" || operation === "REORDER_GROUPS") return "PRODUCT_GROUP";
  return "PRODUCT";
}

function sameIdSet(currentIds: readonly string[], requestedIds: readonly string[]) {
  if (currentIds.length !== requestedIds.length) return false;
  const requested = new Set(requestedIds);
  return currentIds.every((id) => requested.has(id));
}

async function validateBundleChoiceReferences(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  choiceGroupId: string,
  componentProductId: string,
) {
  const [choiceGroup, component] = await Promise.all([
    transaction.productBundleChoiceGroup.findFirst({
      where: { id: choiceGroupId, organizationId },
      select: { id: true, bundleProduct: { select: { kind: true } } },
    }),
    transaction.product.findFirst({
      where: { id: componentProductId, organizationId },
      select: { id: true, kind: true },
    }),
  ]);
  if (!choiceGroup || !component) throw new CatalogNotFoundError();
  if (choiceGroup.bundleProduct.kind !== "BUNDLE" || component.kind !== "SINGLE") {
    throw new CatalogConflictError("套餐選項只能使用同一組織的一般商品，不能巢狀加入另一個套餐。");
  }
}

function copyProductName(name: string) {
  const suffix = "（副本）";
  return `${name.slice(0, 80 - suffix.length)}${suffix}`;
}
