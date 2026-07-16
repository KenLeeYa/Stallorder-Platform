import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getOrganizationProductNotes } from "@/lib/product-note-data";
import { productNoteCommandSchema } from "@/lib/product-note-validation";
import { hashClientIp } from "@/lib/security";

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
      entityType: "PRODUCT_NOTE",
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
  const parsed = productNoteCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "註記群組資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const command = parsed.data;
  let before: Prisma.InputJsonObject | undefined;
  if (command.operation === "UPDATE_NOTE_GROUP" || command.operation === "DELETE_NOTE_GROUP") {
    const current = await prisma.productNoteGroup.findFirst({
      where: { id: command.noteGroupId, organizationId },
      select: {
        name: true,
        selectionMode: true,
        isRequired: true,
        minSelections: true,
        maxSelections: true,
        sortOrder: true,
        isActive: true,
        assignments: { select: { productId: true } },
      },
    });
    before = current ? toAuditJson(current) : undefined;
  } else if (command.operation === "UPDATE_NOTE_OPTION" || command.operation === "DELETE_NOTE_OPTION") {
    const current = await prisma.productNoteOption.findFirst({
      where: { id: command.noteOptionId, organizationId },
      select: { noteGroupId: true, name: true, priceDelta: true, sortOrder: true, isActive: true },
    });
    before = current ? toAuditJson(current) : undefined;
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      if (command.operation === "CREATE_NOTE_GROUP" || command.operation === "UPDATE_NOTE_GROUP") {
        const productCount = command.productIds.length === 0
          ? 0
          : await transaction.product.count({
            where: { organizationId, id: { in: command.productIds } },
          });
        if (productCount !== command.productIds.length) throw new ProductNoteNotFoundError();

        const groupData = {
          name: command.name,
          selectionMode: command.selectionMode,
          isRequired: command.isRequired,
          minSelections: command.minSelections,
          maxSelections: command.selectionMode === "SINGLE" ? 1 : command.maxSelections,
          sortOrder: command.sortOrder,
          isActive: command.isActive,
        } as const;
        const group = command.operation === "CREATE_NOTE_GROUP"
          ? await transaction.productNoteGroup.create({ data: { organizationId, ...groupData }, select: { id: true } })
          : await updateNoteGroup(transaction, organizationId, command.noteGroupId, groupData);

        await transaction.productNoteGroupAssignment.deleteMany({
          where: { organizationId, noteGroupId: group.id },
        });
        if (command.productIds.length > 0) {
          await transaction.productNoteGroupAssignment.createMany({
            data: command.productIds.map((productId, index) => ({
              organizationId,
              productId,
              noteGroupId: group.id,
              sortOrder: index,
            })),
          });
        }
        await transaction.productNoteGroupTranslation.deleteMany({
          where: {
            organizationId,
            noteGroupId: group.id,
            locale: { notIn: command.translations.map((translation) => translation.locale) },
          },
        });
        await Promise.all(command.translations.map((translation) => transaction.productNoteGroupTranslation.upsert({
          where: { noteGroupId_locale: { noteGroupId: group.id, locale: translation.locale } },
          create: { organizationId, noteGroupId: group.id, ...translation },
          update: { name: translation.name },
        })));
        return { id: group.id, entityType: "PRODUCT_NOTE_GROUP" } as const;
      }

      if (command.operation === "DELETE_NOTE_GROUP") {
        const group = await transaction.productNoteGroup.findFirst({
          where: { id: command.noteGroupId, organizationId },
          select: { id: true },
        });
        if (!group) throw new ProductNoteNotFoundError();
        await transaction.productNoteGroup.delete({ where: { id: group.id } });
        return { id: group.id, entityType: "PRODUCT_NOTE_GROUP" } as const;
      }

      if (command.operation === "CREATE_NOTE_OPTION") {
        const group = await transaction.productNoteGroup.findFirst({
          where: { id: command.noteGroupId, organizationId },
          select: { id: true },
        });
        if (!group) throw new ProductNoteNotFoundError();
        const option = await transaction.productNoteOption.create({
          data: {
            organizationId,
            noteGroupId: group.id,
            name: command.name,
            priceDelta: command.priceDelta,
            sortOrder: command.sortOrder,
            isActive: command.isActive,
          },
          select: { id: true },
        });
        if (command.translations.length > 0) {
          await transaction.productNoteOptionTranslation.createMany({
            data: command.translations.map((translation) => ({ organizationId, noteOptionId: option.id, ...translation })),
          });
        }
        return { id: option.id, entityType: "PRODUCT_NOTE_OPTION" } as const;
      }

      if (command.operation === "UPDATE_NOTE_OPTION") {
        const option = await transaction.productNoteOption.findFirst({
          where: { id: command.noteOptionId, organizationId },
          select: { id: true },
        });
        if (!option) throw new ProductNoteNotFoundError();
        await transaction.productNoteOption.update({
          where: { id: option.id },
          data: {
            name: command.name,
            priceDelta: command.priceDelta,
            sortOrder: command.sortOrder,
            isActive: command.isActive,
          },
        });
        await transaction.productNoteOptionTranslation.deleteMany({
          where: {
            organizationId,
            noteOptionId: option.id,
            locale: { notIn: command.translations.map((translation) => translation.locale) },
          },
        });
        await Promise.all(command.translations.map((translation) => transaction.productNoteOptionTranslation.upsert({
          where: { noteOptionId_locale: { noteOptionId: option.id, locale: translation.locale } },
          create: { organizationId, noteOptionId: option.id, ...translation },
          update: { name: translation.name },
        })));
        return { id: option.id, entityType: "PRODUCT_NOTE_OPTION" } as const;
      }

      const option = await transaction.productNoteOption.findFirst({
        where: { id: command.noteOptionId, organizationId },
        select: { id: true },
      });
      if (!option) throw new ProductNoteNotFoundError();
      await transaction.productNoteOption.delete({ where: { id: option.id } });
      return { id: option.id, entityType: "PRODUCT_NOTE_OPTION" } as const;
    });

    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: auditAction(command.operation),
      entityType: result.entityType,
      entityId: result.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      before,
      after: toAuditJson(command),
      metadata: "productIds" in command ? { assignedProductCount: command.productIds.length } : undefined,
    });

    return NextResponse.json(
      { noteGroups: await getOrganizationProductNotes(organizationId) },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const notFound = error instanceof ProductNoteNotFoundError;
    return NextResponse.json(
      { error: duplicate ? "同一群組內已有相同名稱。" : notFound ? "找不到指定的商品或註記資料。" : "目前無法更新註記群組。" },
      { status: duplicate ? 409 : notFound ? 404 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

async function updateNoteGroup(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  noteGroupId: string,
  data: {
    name: string;
    selectionMode: "SINGLE" | "MULTIPLE";
    isRequired: boolean;
    minSelections: number;
    maxSelections: number | null;
    sortOrder: number;
    isActive: boolean;
  },
) {
  const group = await transaction.productNoteGroup.findFirst({
    where: { id: noteGroupId, organizationId },
    select: { id: true },
  });
  if (!group) throw new ProductNoteNotFoundError();
  return transaction.productNoteGroup.update({ where: { id: group.id }, data, select: { id: true } });
}

function toAuditJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function auditAction(operation: string) {
  const actions: Record<string, string> = {
    CREATE_NOTE_GROUP: "PRODUCT_NOTE_GROUP_CREATED",
    UPDATE_NOTE_GROUP: "PRODUCT_NOTE_GROUP_UPDATED",
    DELETE_NOTE_GROUP: "PRODUCT_NOTE_GROUP_DELETED",
    CREATE_NOTE_OPTION: "PRODUCT_NOTE_OPTION_CREATED",
    UPDATE_NOTE_OPTION: "PRODUCT_NOTE_OPTION_UPDATED",
    DELETE_NOTE_OPTION: "PRODUCT_NOTE_OPTION_DELETED",
  };
  return actions[operation] ?? "PRODUCT_NOTES_UPDATED";
}

class ProductNoteNotFoundError extends Error {}
