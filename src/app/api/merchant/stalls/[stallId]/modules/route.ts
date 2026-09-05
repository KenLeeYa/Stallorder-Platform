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

function updatesModuleView(view: string, target: string) {
  return view === "all"
    || view === target
    || (view === "online-ordering" && (target === "delivery" || target === "preorder"));
}

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
    const existingSettings = command.operation === "UPDATE_MODULES"
      && (updatesModuleView(command.view, "printing") || updatesModuleView(command.view, "kds"))
      ? await prisma.stallOrderingSettings.findUnique({
          where: { stallId },
          select: { printModuleEnabled: true, kdsModuleEnabled: true },
        })
      : null;
    if (command.operation === "CREATE_TABLE") {
      await entitlementService.assertLimitAvailable(organizationId, "QR_CODES", 1);
    } else if (command.operation === "ROTATE_TABLE_QR") {
      await entitlementService.assertLimitAvailable(organizationId, "QR_CODES", 0);
    } else if (
      command.operation === "UPDATE_MODULES"
      && updatesModuleView(command.view, "delivery")
      && command.deliveryModuleEnabled
    ) {
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
    if (command.operation === "UPDATE_MODULES" && (
      (updatesModuleView(command.view, "printing") && command.printModuleEnabled)
      || (updatesModuleView(command.view, "kds") && command.kdsModuleEnabled)
    )) {
      if (
        updatesModuleView(command.view, "printing")
        && command.printModuleEnabled
        && !existingSettings?.printModuleEnabled
      ) {
        await entitlementService.assertFeatureEnabled(organizationId, "PRINTER_INTEGRATION");
      }
      if (
        updatesModuleView(command.view, "kds")
        && command.kdsModuleEnabled
        && !existingSettings?.kdsModuleEnabled
      ) {
        await entitlementService.assertFeatureEnabled(organizationId, "KDS");
      }
    }
    const qrTokensBefore = await prisma.qrCode.findMany({
      where: { stallId, organizationId },
      select: { token: true },
    });
    const entityId = await prisma.$transaction(async (transaction) => {
      if (command.operation === "UPDATE_MODULES") {
        const updatesLottery = updatesModuleView(command.view, "lottery");
        const updatesCheckoutUpsell = command.view === "all" || command.view === "online-ordering";
        if (updatesCheckoutUpsell && command.checkoutUpsellEnabled) {
          if (command.checkoutUpsellProductIds.length === 0) {
            throw new CheckoutUpsellConfigurationError("請至少選擇 1 個推薦商品。");
          }
          const availableAssignments = await transaction.stallProduct.count({
            where: {
              stallId,
              organizationId,
              productId: { in: command.checkoutUpsellProductIds },
              isEnabled: true,
              product: { isActive: true },
            },
          });
          if (availableAssignments !== command.checkoutUpsellProductIds.length) {
            throw new CheckoutUpsellConfigurationError("推薦商品已停用或不屬於此攤位，請重新選擇。");
          }
        }
        if (updatesLottery && command.lotteryEnabled && command.lotteryProductIds.length === 0) {
          throw new LotteryProductConfigurationError("請至少選擇 1 個可抽商品。");
        }
        if (updatesLottery && command.lotteryProductIds.length > 0) {
          const eligibleAssignments = await transaction.stallProduct.count({
            where: {
              stallId,
              organizationId,
              productId: { in: command.lotteryProductIds },
              isEnabled: true,
              product: { isActive: true, kind: "SINGLE" },
            },
          });
          if (eligibleAssignments !== command.lotteryProductIds.length) {
            throw new LotteryProductConfigurationError("抽抽樂商品已停用、不是一般商品或不屬於此攤位，請重新選擇。");
          }
        }
        const festivalProductIds = command.lotteryFestivalCampaigns
          ? [...new Set(command.lotteryFestivalCampaigns.flatMap((campaign) => campaign.productIds))]
          : [];
        if (updatesLottery && festivalProductIds.length > 0) {
          const eligibleAssignments = await transaction.stallProduct.count({
            where: {
              stallId,
              organizationId,
              productId: { in: festivalProductIds },
              isEnabled: true,
              product: { isActive: true, kind: "SINGLE" },
            },
          });
          if (eligibleAssignments !== festivalProductIds.length) {
            throw new LotteryProductConfigurationError("節慶活動商品已停用、不是一般商品或不屬於此攤位，請重新選擇。");
          }
        }
        if (updatesLottery && command.lotteryFestivalRewardEnabled) {
          if (!command.lotteryFestivalStartsOn || !command.lotteryFestivalEndsOn) {
            throw new LotteryCampaignConfigurationError({
              lotteryFestivalStartsOn: "請選擇活動開始日期。",
              lotteryFestivalEndsOn: "請選擇活動結束日期。",
            });
          }
          if (command.lotteryFestivalEndsOn < command.lotteryFestivalStartsOn) {
            throw new LotteryCampaignConfigurationError({
              lotteryFestivalEndsOn: "活動結束日期不可早於開始日期。",
            });
          }
        }
        const lotteryDiscountChances = updatesLottery && command.lotteryEnabled
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
        const firstEnabledFestival = command.lotteryFestivalCampaigns
          ?.filter((campaign) => campaign.isEnabled)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.startsOn.localeCompare(right.startsOn))[0]
          ?? null;
        await transaction.stallOrderingSettings.update({
          where: { stallId, organizationId },
          data: {
            ...(updatesModuleView(command.view, "dine-in")
              ? { dineInEnabled: command.dineInEnabled }
              : {}),
            ...(updatesModuleView(command.view, "delivery")
              ? {
                  deliveryModuleEnabled: command.deliveryModuleEnabled,
                  deliveryCustomerNotice: command.deliveryCustomerNotice,
                }
              : {}),
            ...(updatesModuleView(command.view, "staff-delivery")
              ? { staffDeliveryEnabled: command.staffDeliveryEnabled }
              : {}),
            ...(updatesModuleView(command.view, "printing")
              ? { printModuleEnabled: command.printModuleEnabled }
              : {}),
            ...(updatesModuleView(command.view, "kds")
              ? { kdsModuleEnabled: command.kdsModuleEnabled }
              : {}),
            ...(updatesModuleView(command.view, "payments")
              ? { paymentModuleEnabled: command.paymentModuleEnabled }
              : {}),
            ...(updatesModuleView(command.view, "discounts") ? {
              discountModuleEnabled: command.discountModuleEnabled,
              discountApprovalThresholdBps: command.discountApprovalThresholdBps,
            } : {}),
            ...(updatesModuleView(command.view, "preorder") ? {
              takeoutPreorderEnabled: command.takeoutPreorderEnabled,
              preorderMinLeadMinutes: command.preorderMinLeadMinutes,
              preorderMaxDays: command.preorderMaxDays,
              preorderSlotMinutes: command.preorderSlotMinutes,
            } : {}),
            ...(updatesCheckoutUpsell ? {
              checkoutUpsellEnabled: command.checkoutUpsellEnabled,
              checkoutUpsellProductIds: command.checkoutUpsellEnabled
                ? command.checkoutUpsellProductIds
                : [],
            } : {}),
            ...(updatesLottery ? {
              lotteryEnabled: command.lotteryEnabled,
              lotteryCampaignName: command.lotteryCampaignName,
              lotteryProductIds: command.lotteryProductIds,
              lotteryDiscountOptionId: legacyLotteryDiscount?.discountOptionId ?? null,
              lotteryDiscountWinRateBps: legacyLotteryDiscount?.winRateBps ?? 0,
              lotterySpendRewardEnabled: command.lotterySpendRewardEnabled,
              lotterySpendThresholdAmount: command.lotterySpendThresholdAmount,
              lotteryFestivalRewardEnabled: command.lotteryFestivalCampaigns
                ? Boolean(firstEnabledFestival)
                : command.lotteryFestivalRewardEnabled,
              lotteryFestivalStartsOn: (command.lotteryFestivalCampaigns
                ? firstEnabledFestival?.startsOn
                : command.lotteryFestivalStartsOn)
                ? new Date(`${command.lotteryFestivalCampaigns ? firstEnabledFestival?.startsOn : command.lotteryFestivalStartsOn}T00:00:00.000Z`)
                : null,
              lotteryFestivalEndsOn: (command.lotteryFestivalCampaigns
                ? firstEnabledFestival?.endsOn
                : command.lotteryFestivalEndsOn)
                ? new Date(`${command.lotteryFestivalCampaigns ? firstEnabledFestival?.endsOn : command.lotteryFestivalEndsOn}T00:00:00.000Z`)
                : null,
              lotteryBirthdayRewardEnabled: false,
            } : {}),
          },
        });
        if (updatesLottery && command.lotteryFestivalCampaigns) {
          const submittedCampaignIds = command.lotteryFestivalCampaigns.map((campaign) => campaign.id);
          await transaction.stallLotteryCampaign.updateMany({
            where: {
              organizationId,
              stallId,
              deletedAt: null,
              ...(submittedCampaignIds.length > 0 ? { id: { notIn: submittedCampaignIds } } : {}),
            },
            data: { isEnabled: false, deletedAt: new Date() },
          });
          for (const campaign of command.lotteryFestivalCampaigns) {
            const campaignData = {
              name: campaign.name,
              isEnabled: campaign.isEnabled,
              startsOn: new Date(`${campaign.startsOn}T00:00:00.000Z`),
              endsOn: new Date(`${campaign.endsOn}T00:00:00.000Z`),
              productIds: campaign.productIds,
              sortOrder: campaign.sortOrder,
              deletedAt: null,
            };
            const updated = await transaction.stallLotteryCampaign.updateMany({
              where: { id: campaign.id, organizationId, stallId },
              data: campaignData,
            });
            if (updated.count === 0) {
              await transaction.stallLotteryCampaign.create({
                data: { id: campaign.id, organizationId, stallId, ...campaignData },
              });
            }
          }
        }
        const lotteryEligibleProductIds = [...new Set([
          ...command.lotteryProductIds,
          ...festivalProductIds,
        ])];
        if (updatesLottery && lotteryEligibleProductIds.length > 0) {
          await transaction.product.updateMany({
            where: {
              organizationId,
              id: { in: lotteryEligibleProductIds },
            },
            data: { isLotteryEligible: true },
          });
        }
        const nextKdsModuleEnabled = updatesModuleView(command.view, "kds")
          ? command.kdsModuleEnabled
          : existingSettings?.kdsModuleEnabled ?? false;
        const nextPrintModuleEnabled = updatesModuleView(command.view, "printing")
          ? command.printModuleEnabled
          : existingSettings?.printModuleEnabled ?? false;
        const moduleChangedAt = new Date();
        if (updatesModuleView(command.view, "kds") && !command.kdsModuleEnabled) {
          await transaction.orderProductionTask.updateMany({
            where: {
              organizationId,
              stallId,
              status: { in: ["PENDING", "PREPARING"] },
            },
            data: { status: "CANCELLED", completedAt: moduleChangedAt },
          });
        }
        if (updatesModuleView(command.view, "printing") && !command.printModuleEnabled) {
          await transaction.printJob.updateMany({
            where: {
              organizationId,
              stallId,
              status: { in: ["PENDING", "PRINTING"] },
            },
            data: {
              status: "CANCELLED",
              lastError: "列印模組已停用。",
              nextRetryAt: null,
            },
          });
        }
        if (
          (updatesModuleView(command.view, "kds") || updatesModuleView(command.view, "printing"))
          && !nextKdsModuleEnabled
          && !nextPrintModuleEnabled
        ) {
          const completableOrders = await transaction.order.findMany({
            where: {
              organizationId,
              stallId,
              status: "READY",
              paymentStatus: "PAID",
              externalProvider: null,
              OR: [
                { source: { not: "QR_MENU" } },
                { fulfillmentType: { not: "TAKEOUT" } },
                { pickupVerifiedAt: { not: null } },
              ],
            },
            select: { id: true },
          });
          for (const order of completableOrders) {
            const completed = await transaction.order.updateMany({
              where: {
                id: order.id,
                organizationId,
                stallId,
                status: "READY",
                paymentStatus: "PAID",
              },
              data: { status: "COMPLETED", completedAt: moduleChangedAt },
            });
            if (completed.count !== 1) continue;
            await transaction.orderEvent.create({
              data: {
                organizationId,
                stallId,
                orderId: order.id,
                eventType: "ORDER_AUTO_COMPLETED_AFTER_MODULE_CHANGE",
                previousStatus: "READY",
                newStatus: "COMPLETED",
                createdBy: authorization.principal.user.id,
              },
            });
          }
        }
        if (updatesLottery) {
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
        }
        if (updatesModuleView(command.view, "delivery") && !command.deliveryModuleEnabled) {
          await transaction.orderSession.updateMany({
            where: { stallId, organizationId, orderingMode: "DELIVERY", status: "ACTIVE" },
            data: { status: "REVOKED", revokedAt: new Date() },
          });
        }
        if (updatesModuleView(command.view, "preorder") && !command.takeoutPreorderEnabled) {
          await transaction.orderSession.updateMany({
            where: { stallId, organizationId, orderingMode: "PREORDER", status: "ACTIVE" },
            data: { status: "REVOKED", revokedAt: new Date() },
          });
        }
        if (updatesModuleView(command.view, "delivery") && command.deliveryModuleEnabled) {
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
    const invalidLotteryCampaign = error instanceof LotteryCampaignConfigurationError
      ? error
      : null;
    const invalidCheckoutUpsell = error instanceof CheckoutUpsellConfigurationError
      ? error
      : null;
    const invalidLotteryProduct = error instanceof LotteryProductConfigurationError
      ? error
      : null;
    const activeOrders = error instanceof ActiveTableOrdersError;
    const floorInUse = error instanceof DiningFloorInUseError;
    const duplicateFieldErrors = duplicate
      ? getModuleDuplicateCodeFieldErrors(command.operation, duplicateError?.meta?.target)
      : undefined;
    return NextResponse.json(
      {
        error: duplicateFieldErrors?.name ? "樓層名稱已存在。" : duplicateFieldErrors ? "代碼已存在。" : duplicate ? "資料與現有設定衝突，請重新整理後再試。" : invalidLotteryDiscount ? "抽抽樂折扣已停用或不存在，請重新選擇。" : invalidLotteryCampaign ? "請檢查免費抽獎活動日期。" : invalidCheckoutUpsell ? invalidCheckoutUpsell.message : invalidLotteryProduct ? invalidLotteryProduct.message : notFound ? "找不到指定設定。" : activeOrders ? "桌位仍有未完成訂單，請先停用而不要刪除。" : floorInUse ? "樓層仍有桌位，請先移動或刪除桌位。" : "目前無法更新模組設定。",
        ...(duplicateFieldErrors ? { fieldErrors: duplicateFieldErrors } : invalidLotteryDiscount ? {
          fieldErrors: { lotteryDiscountChances: "抽抽樂折扣已停用或不存在，請重新選擇。" },
        } : invalidLotteryCampaign ? {
          fieldErrors: invalidLotteryCampaign.fieldErrors,
        } : invalidCheckoutUpsell ? {
          fieldErrors: { checkoutUpsellProductIds: invalidCheckoutUpsell.message },
        } : invalidLotteryProduct ? {
          fieldErrors: { lotteryProductIds: invalidLotteryProduct.message },
        } : {}),
      },
      { status: duplicate || activeOrders || floorInUse ? 409 : invalidLotteryDiscount || invalidLotteryCampaign || invalidCheckoutUpsell || invalidLotteryProduct ? 400 : notFound ? 404 : 500, headers: { "x-request-id": authorization.requestId } },
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
class LotteryCampaignConfigurationError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super("LOTTERY_CAMPAIGN_CONFIGURATION_INVALID");
  }
}
class CheckoutUpsellConfigurationError extends Error {}
class LotteryProductConfigurationError extends Error {}
class ActiveTableOrdersError extends Error {}
class DiningFloorInUseError extends Error {}
