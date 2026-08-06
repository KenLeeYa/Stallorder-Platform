import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { initialFloorPosition } from "@/lib/dining-floor-layout";
import { prisma } from "@/lib/prisma";
import { hashClientIp, createOpaqueToken } from "@/lib/security";
import {
  getModuleDuplicateCodeFieldErrors,
  getStallModuleFieldErrors,
  getStallModuleFieldLabel,
  stallModuleCommandSchema,
} from "@/lib/stall-module-contract";
import { getStallModuleState } from "@/lib/stall-modules";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";
import {
  DiningFloorNotFoundError,
  materializeDefaultDiningFloorForFloorCreation,
  resolveDiningFloorIdForWrite,
} from "@/server/dining-floor-service";
import { invalidatePublicMenu, invalidatePublicQrToken } from "@/lib/public-menu";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_ORDERING");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = stallModuleCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getStallModuleFieldErrors(parsed.error);
    const operation = body.data && typeof body.data === "object" && "operation" in body.data
      ? body.data.operation
      : undefined;
    const invalidFields = [...new Set(
      Object.keys(fieldErrors).map((field) => getStallModuleFieldLabel(field, operation)),
    )];
    return NextResponse.json(
      {
        error: invalidFields.length
          ? `請檢查以下欄位：${invalidFields.join("、")}。`
          : "模組設定格式不正確。",
        fieldErrors,
      },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const organizationId = authorization.workspace.id;
  const command = parsed.data;
  try {
    if (command.operation === "CREATE_TABLE") {
      await entitlementService.assertLimitAvailable(organizationId, "QR_CODES", 1);
    } else if (command.operation === "ROTATE_TABLE_QR") {
      await entitlementService.assertLimitAvailable(organizationId, "QR_CODES", 0);
    } else if (command.operation === "UPDATE_MODULES" && command.deliveryModuleEnabled) {
      const existingDeliveryQr = await prisma.qrCode.findFirst({
        where: {
          stallId,
          organizationId,
          diningTableId: null,
          state: { in: ["ACTIVE", "PAUSED"] },
        },
        select: { id: true },
      });
      await entitlementService.assertLimitAvailable(
        organizationId,
        "QR_CODES",
        existingDeliveryQr ? 0 : 1,
      );
    }
    if (command.operation === "UPDATE_MODULES" && command.printModuleEnabled) {
      const existingSettings = await prisma.stallOrderingSettings.findUnique({
        where: { stallId },
        select: { printModuleEnabled: true },
      });
      if (!existingSettings?.printModuleEnabled) {
        await entitlementService.assertFeatureEnabled(organizationId, "PRINTER_INTEGRATION");
      }
    }
    const qrTokensBefore = await prisma.qrCode.findMany({
      where: { stallId, organizationId },
      select: { token: true },
    });
    const entityId = await prisma.$transaction(async (transaction) => {
      if (command.operation === "UPDATE_MODULES") {
        const lotteryDiscountChances = command.lotteryEnabled
          ? command.lotteryDiscountChances ?? (
              command.lotteryDiscountOptionId && command.lotteryDiscountWinRateBps > 0
                ? [{
                    discountOptionId: command.lotteryDiscountOptionId,
                    winRateBps: command.lotteryDiscountWinRateBps,
                  }]
                : []
            )
          : [];
        if (lotteryDiscountChances.length > 0) {
          const configuredDiscounts = await transaction.discountOption.findMany({
            where: {
              id: { in: lotteryDiscountChances.map((chance) => chance.discountOptionId) },
              organizationId,
              stallId,
              isEnabled: true,
            },
            select: { id: true },
          });
          if (configuredDiscounts.length !== lotteryDiscountChances.length) {
            throw new LotteryDiscountNotFoundError();
          }
        }
        const legacyLotteryDiscount = lotteryDiscountChances[0] ?? null;
        await transaction.stallOrderingSettings.update({
          where: { stallId, organizationId },
          data: {
            dineInEnabled: command.dineInEnabled,
            deliveryModuleEnabled: command.deliveryModuleEnabled,
            staffDeliveryEnabled: command.staffDeliveryEnabled,
            printModuleEnabled: command.printModuleEnabled,
            paymentModuleEnabled: command.paymentModuleEnabled,
            discountModuleEnabled: command.discountModuleEnabled,
            discountApprovalThresholdBps: command.discountApprovalThresholdBps,
            takeoutPreorderEnabled: command.takeoutPreorderEnabled,
            preorderMinLeadMinutes: command.preorderMinLeadMinutes,
            preorderMaxDays: command.preorderMaxDays,
            preorderSlotMinutes: command.preorderSlotMinutes,
            lotteryEnabled: command.lotteryEnabled,
            lotteryDiscountOptionId: legacyLotteryDiscount?.discountOptionId ?? null,
            lotteryDiscountWinRateBps: legacyLotteryDiscount?.winRateBps ?? 0,
          },
        });
        await transaction.$executeRaw(Prisma.sql`
          delete from public.stall_lottery_discount_chances
          where stall_id = ${stallId}::uuid
        `);
        if (lotteryDiscountChances.length > 0) {
          await transaction.$executeRaw(Prisma.sql`
            insert into public.stall_lottery_discount_chances (
              stall_id,
              discount_option_id,
              win_rate_bps
            )
            select
              ${stallId}::uuid,
              chance.discount_option_id,
              chance.win_rate_bps
            from jsonb_to_recordset(
              ${JSON.stringify(lotteryDiscountChances.map((chance) => ({
                discount_option_id: chance.discountOptionId,
                win_rate_bps: chance.winRateBps,
              })))}::jsonb
            ) as chance(discount_option_id uuid, win_rate_bps smallint)
          `);
        }
        if (!command.deliveryModuleEnabled) {
          await transaction.orderSession.updateMany({
            where: { stallId, organizationId, orderingMode: "DELIVERY", status: "ACTIVE" },
            data: { status: "REVOKED", revokedAt: new Date() },
          });
        }
        if (!command.takeoutPreorderEnabled) {
          await transaction.orderSession.updateMany({
            where: { stallId, organizationId, orderingMode: "PREORDER", status: "ACTIVE" },
            data: { status: "REVOKED", revokedAt: new Date() },
          });
        }
        if (command.deliveryModuleEnabled) {
          const deliveryQr = await transaction.qrCode.findFirst({
            where: {
              stallId,
              organizationId,
              diningTableId: null,
              state: { in: ["ACTIVE", "PAUSED"] },
            },
            select: { id: true },
          });
          if (!deliveryQr) {
            const latest = await transaction.qrCode.findFirst({
              where: { stallId, organizationId, diningTableId: null },
              orderBy: { tokenVersion: "desc" },
              select: { tokenVersion: true },
            });
            await transaction.qrCode.create({
              data: {
                organizationId,
                stallId,
                token: createOpaqueToken(),
                label: "主要點餐與外送連結",
                tokenVersion: (latest?.tokenVersion ?? 0) + 1,
              },
            });
          }
        }
        return stallId;
      }

      if (command.operation === "UPDATE_LOCALES") {
        await transaction.stallOrderingSettings.update({
          where: { stallId, organizationId },
          data: { enabledLocales: command.enabledLocales },
        });
        return stallId;
      }

      if (command.operation === "CREATE_FLOOR") {
        await materializeDefaultDiningFloorForFloorCreation(transaction, { organizationId, stallId });
        const floor = await transaction.diningFloor.create({
          data: { organizationId, stallId, name: command.name, sortOrder: command.sortOrder },
        });
        return floor.id;
      }

      if (command.operation === "UPDATE_FLOOR") {
        const existing = await transaction.diningFloor.findFirst({
          where: { id: command.floorId, stallId, organizationId },
          select: { id: true },
        });
        if (!existing) throw new DiningFloorNotFoundError();
        await transaction.diningFloor.update({
          where: { id: existing.id },
          data: { name: command.name, sortOrder: command.sortOrder },
        });
        return existing.id;
      }

      if (command.operation === "DELETE_FLOOR") {
        const existing = await transaction.diningFloor.findFirst({
          where: { id: command.floorId, stallId, organizationId },
          select: { id: true },
        });
        if (!existing) throw new DiningFloorNotFoundError();
        const tableCount = await transaction.diningTable.count({
          where: { floorId: existing.id, stallId, organizationId },
        });
        if (tableCount > 0) throw new DiningFloorInUseError();
        await transaction.diningFloor.delete({ where: { id: existing.id } });
        return existing.id;
      }

      if (command.operation === "CREATE_TABLE") {
        const floorId = await resolveDiningFloorIdForWrite(transaction, {
          organizationId,
          stallId,
          floorId: command.floorId,
        });
        const tableCount = await transaction.diningTable.count({ where: { stallId, organizationId, floorId } });
        const floorPosition = initialFloorPosition(tableCount);
        const table = await transaction.diningTable.create({
          data: {
            organizationId,
            stallId,
            floorId,
            code: command.code,
            label: command.label,
            isActive: command.isActive,
            sortOrder: command.sortOrder,
            shape: command.shape,
            rotationDegrees: command.rotationDegrees,
            ...floorPosition,
          },
        });
        await transaction.qrCode.create({
          data: {
            organizationId,
            stallId,
            diningTableId: table.id,
            token: createOpaqueToken(),
            label: `${table.label} 內用 QR`,
            tokenVersion: 1,
          },
        });
        return table.id;
      }

      if (command.operation === "UPDATE_TABLE") {
        const floorId = await resolveDiningFloorIdForWrite(transaction, {
          organizationId,
          stallId,
          floorId: command.floorId,
        });
        const existing = await transaction.diningTable.findFirst({ where: { id: command.tableId, stallId, organizationId } });
        if (!existing) throw new ModuleNotFoundError();
        await transaction.diningTable.update({
          where: { id: existing.id },
          data: {
            floorId,
            code: command.code,
            label: command.label,
            isActive: command.isActive,
            sortOrder: command.sortOrder,
            shape: command.shape,
            rotationDegrees: command.rotationDegrees,
          },
        });
        return existing.id;
      }

      if (command.operation === "UPDATE_TABLE_LAYOUT") {
        const floorId = await resolveDiningFloorIdForWrite(transaction, {
          organizationId,
          stallId,
          floorId: command.floorId,
        });
        const layouts = command.tables.map((table) => ({
          table_id: table.tableId,
          layout_x: table.layoutX,
          layout_y: table.layoutY,
        }));
        const updatedCount = await transaction.$executeRaw(Prisma.sql`
          update public.dining_tables as dining_table
          set
            layout_x = layout.layout_x,
            layout_y = layout.layout_y,
            updated_at = now()
          from jsonb_to_recordset(${JSON.stringify(layouts)}::jsonb) as layout(
            table_id uuid,
            layout_x smallint,
            layout_y smallint
          )
          where dining_table.id = layout.table_id
            and dining_table.stall_id = ${stallId}::uuid
            and dining_table.organization_id = ${organizationId}::uuid
            and dining_table.floor_id = ${floorId}::uuid
        `);
        if (updatedCount !== command.tables.length) throw new ModuleNotFoundError();
        return stallId;
      }

      if (command.operation === "DELETE_TABLE") {
        const existing = await transaction.diningTable.findFirst({ where: { id: command.tableId, stallId, organizationId } });
        if (!existing) throw new ModuleNotFoundError();
        const activeOrders = await transaction.order.count({
          where: { diningTableId: existing.id, status: { in: ["WAITING_CONFIRMATION", "CONFIRMED", "PREPARING", "PACKING", "READY"] } },
        });
        if (activeOrders > 0) throw new ActiveTableOrdersError();
        await transaction.diningTable.delete({ where: { id: existing.id } });
        return existing.id;
      }

      if (command.operation === "ROTATE_TABLE_QR") {
        const table = await transaction.diningTable.findFirst({ where: { id: command.tableId, stallId, organizationId } });
        if (!table) throw new ModuleNotFoundError();
        const latest = await transaction.qrCode.findFirst({
          where: { diningTableId: table.id },
          orderBy: { tokenVersion: "desc" },
          select: { tokenVersion: true },
        });
        await transaction.qrCode.updateMany({
          where: { diningTableId: table.id, state: { in: ["ACTIVE", "PAUSED"] } },
          data: { state: "REVOKED" },
        });
        await transaction.qrCode.create({
          data: {
            organizationId,
            stallId,
            diningTableId: table.id,
            token: createOpaqueToken(),
            label: `${table.label} 內用 QR`,
            tokenVersion: (latest?.tokenVersion ?? 0) + 1,
          },
        });
        return table.id;
      }

      if (command.operation === "CREATE_PAYMENT_OPTION") {
        const option = await transaction.paymentOption.create({ data: { organizationId, stallId, ...paymentFields(command) } });
        return option.id;
      }
      if (command.operation === "UPDATE_PAYMENT_OPTION") {
        const existing = await transaction.paymentOption.findFirst({ where: { id: command.paymentOptionId, stallId, organizationId } });
        if (!existing) throw new ModuleNotFoundError();
        await transaction.paymentOption.update({ where: { id: existing.id }, data: paymentFields(command) });
        return existing.id;
      }
      if (command.operation === "DELETE_PAYMENT_OPTION") {
        const existing = await transaction.paymentOption.findFirst({ where: { id: command.paymentOptionId, stallId, organizationId } });
        if (!existing) throw new ModuleNotFoundError();
        await transaction.paymentOption.delete({ where: { id: existing.id } });
        return existing.id;
      }

      if (command.operation === "CREATE_DISCOUNT") {
        const discount = await transaction.discountOption.create({ data: { organizationId, stallId, ...discountFields(command) } });
        return discount.id;
      }
      if (command.operation === "UPDATE_DISCOUNT") {
        const existing = await transaction.discountOption.findFirst({ where: { id: command.discountId, stallId, organizationId } });
        if (!existing) throw new ModuleNotFoundError();
        await transaction.discountOption.update({ where: { id: existing.id }, data: discountFields(command) });
        if (!command.isEnabled) {
          await transaction.$executeRaw(Prisma.sql`
            delete from public.stall_lottery_discount_chances
            where stall_id = ${stallId}::uuid
              and discount_option_id = ${existing.id}::uuid
          `);
          const legacyLotteryDiscount = await findLegacyLotteryDiscount(transaction, stallId);
          await transaction.stallOrderingSettings.update({
            where: { stallId, organizationId },
            data: {
              lotteryDiscountOptionId: legacyLotteryDiscount?.discountOptionId ?? null,
              lotteryDiscountWinRateBps: legacyLotteryDiscount?.winRateBps ?? 0,
            },
          });
        }
        return existing.id;
      }
      const existing = await transaction.discountOption.findFirst({ where: { id: command.discountId, stallId, organizationId } });
      if (!existing) throw new ModuleNotFoundError();
      await transaction.discountOption.delete({ where: { id: existing.id } });
      const legacyLotteryDiscount = await findLegacyLotteryDiscount(transaction, stallId);
      await transaction.stallOrderingSettings.update({
        where: { stallId, organizationId },
        data: {
          lotteryDiscountOptionId: legacyLotteryDiscount?.discountOptionId ?? null,
          lotteryDiscountWinRateBps: legacyLotteryDiscount?.winRateBps ?? 0,
        },
      });
      return existing.id;
    });

    await recordAuditEvent({
      organizationId,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: `STALL_MODULE_${command.operation}`,
      entityType: "STALL_MODULE",
      entityId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { operation: command.operation },
    });
    invalidatePublicMenu(stallId);
    for (const qrCode of qrTokensBefore) invalidatePublicQrToken(qrCode.token);
    return NextResponse.json(
      { state: await getStallModuleState(stallId, organizationId) },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    const duplicateError = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
      ? error
      : null;
    const duplicate = Boolean(duplicateError);
    const notFound = error instanceof ModuleNotFoundError || error instanceof DiningFloorNotFoundError;
    const invalidLotteryDiscount = error instanceof LotteryDiscountNotFoundError;
    const activeOrders = error instanceof ActiveTableOrdersError;
    const floorInUse = error instanceof DiningFloorInUseError;
    const duplicateFieldErrors = duplicate
      ? getModuleDuplicateCodeFieldErrors(command.operation, duplicateError?.meta?.target)
      : undefined;
    return NextResponse.json(
      {
        error: duplicateFieldErrors?.name ? "樓層名稱已存在。" : duplicateFieldErrors ? "代碼已存在。" : duplicate ? "資料與現有設定衝突，請重新整理後再試。" : invalidLotteryDiscount ? "抽抽樂折扣已停用或不存在，請重新選擇。" : notFound ? "找不到指定設定。" : activeOrders ? "桌位仍有未完成訂單，請先停用而不要刪除。" : floorInUse ? "樓層仍有桌位，請先移動或刪除桌位。" : "目前無法更新模組設定。",
        ...(duplicateFieldErrors ? { fieldErrors: duplicateFieldErrors } : invalidLotteryDiscount ? {
          fieldErrors: { lotteryDiscountChances: "抽抽樂折扣已停用或不存在，請重新選擇。" },
        } : {}),
      },
      { status: duplicate || activeOrders || floorInUse ? 409 : invalidLotteryDiscount ? 400 : notFound ? 404 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

function paymentFields(command: { code: string; name: string; kind: "CASH" | "LINE_PAY" | "JKO_PAY" | "CUSTOM"; isEnabled: boolean; sortOrder: number }) {
  return { code: command.code, name: command.name, kind: command.kind, isEnabled: command.isEnabled, sortOrder: command.sortOrder };
}

function discountFields(command: { name: string; rateBps: number; isEnabled: boolean; sortOrder: number }) {
  return { name: command.name, rateBps: command.rateBps, isEnabled: command.isEnabled, sortOrder: command.sortOrder };
}

async function findLegacyLotteryDiscount(transaction: Prisma.TransactionClient, stallId: string) {
  const [chance] = await transaction.$queryRaw<Array<{
    discountOptionId: string;
    winRateBps: number;
  }>>(Prisma.sql`
    select
      chance.discount_option_id as "discountOptionId",
      chance.win_rate_bps::integer as "winRateBps"
    from public.stall_lottery_discount_chances chance
    join public.discount_options discount
      on discount.id = chance.discount_option_id
     and discount.stall_id = chance.stall_id
     and discount.is_enabled
    where chance.stall_id = ${stallId}::uuid
    order by discount.sort_order, discount.id
    limit 1
  `);
  return chance ?? null;
}

class ModuleNotFoundError extends Error {}
class LotteryDiscountNotFoundError extends Error {}
class ActiveTableOrdersError extends Error {}
class DiningFloorInUseError extends Error {}
