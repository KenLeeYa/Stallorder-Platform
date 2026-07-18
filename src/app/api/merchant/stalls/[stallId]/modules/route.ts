import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { initialFloorPosition } from "@/lib/dining-floor-layout";
import { prisma } from "@/lib/prisma";
import { hashClientIp, createOpaqueToken } from "@/lib/security";
import { getStallModuleState, stallModuleCommandSchema } from "@/lib/stall-modules";
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
    return NextResponse.json(
      { error: "模組設定格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const organizationId = authorization.workspace.id;
  const command = parsed.data;
  try {
    const qrTokensBefore = await prisma.qrCode.findMany({
      where: { stallId, organizationId },
      select: { token: true },
    });
    const entityId = await prisma.$transaction(async (transaction) => {
      if (command.operation === "UPDATE_MODULES") {
        await transaction.stallOrderingSettings.update({
          where: { stallId, organizationId },
          data: {
            dineInEnabled: command.dineInEnabled,
            deliveryModuleEnabled: command.deliveryModuleEnabled,
            printModuleEnabled: command.printModuleEnabled,
            paymentModuleEnabled: command.paymentModuleEnabled,
            discountModuleEnabled: command.discountModuleEnabled,
            discountApprovalThresholdBps: command.discountApprovalThresholdBps,
          },
        });
        if (!command.deliveryModuleEnabled) {
          await transaction.orderSession.updateMany({
            where: { stallId, organizationId, orderingMode: "DELIVERY", status: "ACTIVE" },
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

      if (command.operation === "CREATE_TABLE") {
        const tableCount = await transaction.diningTable.count({ where: { stallId, organizationId } });
        const floorPosition = initialFloorPosition(tableCount);
        const table = await transaction.diningTable.create({
          data: {
            organizationId,
            stallId,
            code: command.code,
            label: command.label,
            isActive: command.isActive,
            sortOrder: command.sortOrder,
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
        const existing = await transaction.diningTable.findFirst({ where: { id: command.tableId, stallId, organizationId } });
        if (!existing) throw new ModuleNotFoundError();
        await transaction.diningTable.update({
          where: { id: existing.id },
          data: { code: command.code, label: command.label, isActive: command.isActive, sortOrder: command.sortOrder },
        });
        return existing.id;
      }

      if (command.operation === "UPDATE_TABLE_LAYOUT") {
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
        `);
        if (updatedCount !== command.tables.length) throw new ModuleNotFoundError();
        return stallId;
      }

      if (command.operation === "DELETE_TABLE") {
        const existing = await transaction.diningTable.findFirst({ where: { id: command.tableId, stallId, organizationId } });
        if (!existing) throw new ModuleNotFoundError();
        const activeOrders = await transaction.order.count({
          where: { diningTableId: existing.id, status: { in: ["WAITING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY"] } },
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
        return existing.id;
      }
      const existing = await transaction.discountOption.findFirst({ where: { id: command.discountId, stallId, organizationId } });
      if (!existing) throw new ModuleNotFoundError();
      await transaction.discountOption.delete({ where: { id: existing.id } });
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
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const notFound = error instanceof ModuleNotFoundError;
    const activeOrders = error instanceof ActiveTableOrdersError;
    return NextResponse.json(
      { error: duplicate ? "代碼已存在。" : notFound ? "找不到指定設定。" : activeOrders ? "桌位仍有未完成訂單，請先停用而不要刪除。" : "目前無法更新模組設定。" },
      { status: duplicate || activeOrders ? 409 : notFound ? 404 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

function paymentFields(command: { code: string; name: string; kind: "CASH" | "LINE_PAY" | "JKO_PAY" | "CUSTOM"; isEnabled: boolean; sortOrder: number }) {
  return { code: command.code, name: command.name, kind: command.kind, isEnabled: command.isEnabled, sortOrder: command.sortOrder };
}

function discountFields(command: { name: string; rateBps: number; isEnabled: boolean; sortOrder: number }) {
  return { name: command.name, rateBps: command.rateBps, isEnabled: command.isEnabled, sortOrder: command.sortOrder };
}

class ModuleNotFoundError extends Error {}
class ActiveTableOrdersError extends Error {}
