import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { invalidatePublicMenu, invalidatePublicQrToken } from "@/lib/public-menu";
import { newManagerAuthorizationCodeSchema } from "@/lib/manager-authorization";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

const settingsSchema = z.object({
  orderSessionTtlSeconds: z.number().int().min(60).max(1800),
  unconfirmedOrderTimeoutSeconds: z.number().int().min(60).max(3600),
  maxItemQuantity: z.number().int().min(1).max(100),
  maxUniqueProducts: z.number().int().min(1).max(100),
  maxTotalQuantity: z.number().int().min(1).max(500),
  maxNoteLength: z.number().int().min(0).max(2000),
  maxPendingOrdersPerDevice: z.number().int().min(1).max(20),
  maxOrdersPerWindow: z.number().int().min(1).max(100),
  orderWindowSeconds: z.number().int().min(60).max(3600),
  estimatedWaitMinutes: z.number().int().min(0).max(240),
  businessDayCutoffHour: z.number().int().min(0).max(23),
  preorderReminderMinutes: z.number().int().min(0).max(1440),
}).refine((value) => value.maxTotalQuantity >= value.maxItemQuantity, {
  message: "總數量上限不得低於單品上限。",
  path: ["maxTotalQuantity"],
});

const alertSettingsSchema = z.object({
  preset: z.enum(["URGENT", "BELL", "CHIME", "CUSTOM"]),
  volume: z.number().int().min(10).max(100),
  repeatCount: z.number().int().min(1).max(3),
});

const controlSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["PAUSE", "RESUME", "REVOKE_QR", "ROTATE_QR", "MARK_SOLD_OUT", "MARK_AVAILABLE", "CLOSE", "OPEN"]) }),
  z.object({ action: z.literal("UPDATE_LIMITS"), settings: settingsSchema }),
  z.object({ action: z.literal("UPDATE_ALERT_SETTINGS"), settings: alertSettingsSchema }),
  z.object({ action: z.literal("UPDATE_MANAGER_AUTHORIZATION_CODE"), authorizationCode: newManagerAuthorizationCodeSchema }),
]);

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "MANAGE_ORDERING");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理頁面後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = controlSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "控制指令格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  if (parsed.data.action === "ROTATE_QR") {
    try {
      await entitlementService.assertLimitAvailable(authorization.stall.organizationId, "QR_CODES", 0);
    } catch (error) {
      const response = entitlementErrorResponse(error, authorization.requestId);
      if (response) return response;
      throw error;
    }
  }

  const managerAuthorizationCodeHash = parsed.data.action === "UPDATE_MANAGER_AUTHORIZATION_CODE"
    ? await hash(parsed.data.authorizationCode, 12)
    : null;

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const previousState = await prisma.stall.findFirstOrThrow({
    where: { id: authorization.stall.id, organizationId: authorization.stall.organizationId },
    select: {
      orderingState: true,
      isSoldOut: true,
      qrCodes: {
        orderBy: { tokenVersion: "desc" },
        take: 1,
        select: { state: true, tokenVersion: true },
      },
      orderingSettings: {
        select: {
          managerAuthorizationCodeHash: true,
          orderAlertSoundPreset: true,
          orderAlertSoundObjectPath: true,
          orderAlertVolume: true,
          orderAlertRepeatCount: true,
        },
      },
    },
  });
  if (
    parsed.data.action === "UPDATE_ALERT_SETTINGS"
    && parsed.data.settings.preset === "CUSTOM"
    && !previousState.orderingSettings?.orderAlertSoundObjectPath
  ) {
    return NextResponse.json(
      { error: "請先上傳自訂提示音。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const qrTokensBefore = await prisma.qrCode.findMany({
    where: {
      stallId: authorization.stall.id,
      organizationId: authorization.stall.organizationId,
    },
    select: { token: true },
  });
  const state = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select id
      from public.stalls
      where id = ${authorization.stall.id}::uuid
      for update
    `;
    const stall = await transaction.stall.findUniqueOrThrow({
      where: { id: authorization.stall.id },
      include: {
        qrCodes: { orderBy: { tokenVersion: "desc" }, take: 1 },
        orderingSettings: true,
      },
    });

    switch (parsed.data.action) {
      case "PAUSE":
        await transaction.stall.update({ where: { id: stall.id }, data: { orderingState: "PAUSED" } });
        await transaction.stallCapacitySettings.updateMany({
          where: { organizationId: stall.organizationId, stallId: stall.id },
          data: { pauseSource: "MANUAL" },
        });
        await transaction.qrCode.updateMany({ where: { stallId: stall.id, state: "ACTIVE" }, data: { state: "PAUSED" } });
        await transaction.orderSession.updateMany({ where: { stallId: stall.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now } });
        break;
      case "RESUME":
        await transaction.stall.update({ where: { id: stall.id }, data: { orderingState: "OPEN" } });
        await transaction.stallCapacitySettings.updateMany({
          where: { organizationId: stall.organizationId, stallId: stall.id },
          data: { pauseSource: "NONE" },
        });
        await transaction.qrCode.updateMany({
          where: { stallId: stall.id, state: "PAUSED", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          data: { state: "ACTIVE" },
        });
        break;
      case "CLOSE":
        await transaction.stall.update({ where: { id: stall.id }, data: { orderingState: "CLOSED" } });
        await transaction.stallCapacitySettings.updateMany({
          where: { organizationId: stall.organizationId, stallId: stall.id },
          data: { pauseSource: "MANUAL" },
        });
        await transaction.orderSession.updateMany({ where: { stallId: stall.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now } });
        break;
      case "OPEN":
        await transaction.stall.update({ where: { id: stall.id }, data: { orderingState: "OPEN" } });
        await transaction.stallCapacitySettings.updateMany({
          where: { organizationId: stall.organizationId, stallId: stall.id },
          data: { pauseSource: "NONE" },
        });
        break;
      case "MARK_SOLD_OUT":
        await transaction.stall.update({ where: { id: stall.id }, data: { isSoldOut: true } });
        await transaction.orderSession.updateMany({ where: { stallId: stall.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now } });
        break;
      case "MARK_AVAILABLE":
        await transaction.stall.update({ where: { id: stall.id }, data: { isSoldOut: false } });
        break;
      case "REVOKE_QR": {
        const currentQr = stall.qrCodes[0];
        if (currentQr) {
          await transaction.qrCode.update({ where: { id: currentQr.id }, data: { state: "REVOKED" } });
          await transaction.orderSession.updateMany({ where: { qrCodeId: currentQr.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now } });
        }
        break;
      }
      case "ROTATE_QR": {
        await transaction.qrCode.updateMany({ where: { stallId: stall.id, state: { in: ["ACTIVE", "PAUSED"] } }, data: { state: "REVOKED" } });
        await transaction.orderSession.updateMany({ where: { stallId: stall.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now } });
        const nextVersion = (stall.qrCodes[0]?.tokenVersion ?? 0) + 1;
        await transaction.qrCode.create({
          data: {
            organizationId: stall.organizationId,
            stallId: stall.id,
            token,
            label: `主要點餐 QR v${nextVersion}`,
            tokenVersion: nextVersion,
            state: stall.orderingState === "PAUSED" ? "PAUSED" : "ACTIVE",
          },
        });
        break;
      }
      case "UPDATE_LIMITS":
        await transaction.stallOrderingSettings.upsert({
          where: { stallId: stall.id },
          create: { stallId: stall.id, organizationId: stall.organizationId, ...parsed.data.settings },
          update: parsed.data.settings,
        });
        break;
      case "UPDATE_ALERT_SETTINGS":
        await transaction.stallOrderingSettings.upsert({
          where: { stallId: stall.id },
          create: {
            stallId: stall.id,
            organizationId: stall.organizationId,
            orderAlertSoundPreset: parsed.data.settings.preset,
            orderAlertVolume: parsed.data.settings.volume,
            orderAlertRepeatCount: parsed.data.settings.repeatCount,
          },
          update: {
            orderAlertSoundPreset: parsed.data.settings.preset,
            orderAlertVolume: parsed.data.settings.volume,
            orderAlertRepeatCount: parsed.data.settings.repeatCount,
          },
        });
        break;
      case "UPDATE_MANAGER_AUTHORIZATION_CODE":
        await transaction.stallOrderingSettings.upsert({
          where: { stallId: stall.id },
          create: {
            stallId: stall.id,
            organizationId: stall.organizationId,
            managerAuthorizationCodeHash,
            managerAuthorizationCodeUpdatedAt: now,
          },
          update: {
            managerAuthorizationCodeHash,
            managerAuthorizationCodeUpdatedAt: now,
          },
        });
        break;
    }

    return transaction.stall.findUniqueOrThrow({
      where: { id: stall.id },
      select: {
        orderingState: true,
        isSoldOut: true,
        qrCodes: { orderBy: { tokenVersion: "desc" }, take: 1, select: { token: true, state: true, tokenVersion: true } },
        orderingSettings: true,
      },
    });
  });

  await recordAuditEvent({
    organizationId: authorization.stall.organizationId,
    action: `ORDERING_${parsed.data.action}`,
    entityType: "STALL",
    entityId: authorization.stall.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    stallId: authorization.stall.id,
    actorProfileId: authorization.principal.user.id,
    ipHash: hashClientIp(request),
    before: {
      orderingState: previousState.orderingState,
      isSoldOut: previousState.isSoldOut,
      qrCode: previousState.qrCodes[0] ?? null,
      managerAuthorizationCodeConfigured: Boolean(previousState.orderingSettings?.managerAuthorizationCodeHash),
      orderAlertSoundPreset: previousState.orderingSettings?.orderAlertSoundPreset ?? "URGENT",
      orderAlertSoundConfigured: Boolean(previousState.orderingSettings?.orderAlertSoundObjectPath),
      orderAlertVolume: previousState.orderingSettings?.orderAlertVolume ?? 100,
      orderAlertRepeatCount: previousState.orderingSettings?.orderAlertRepeatCount ?? 2,
    },
    after: {
      orderingState: state.orderingState,
      isSoldOut: state.isSoldOut,
      qrCode: state.qrCodes[0]
        ? { state: state.qrCodes[0].state, tokenVersion: state.qrCodes[0].tokenVersion }
        : null,
      managerAuthorizationCodeConfigured: Boolean(state.orderingSettings?.managerAuthorizationCodeHash),
      orderAlertSoundPreset: state.orderingSettings?.orderAlertSoundPreset ?? "URGENT",
      orderAlertSoundConfigured: Boolean(state.orderingSettings?.orderAlertSoundObjectPath),
      orderAlertVolume: state.orderingSettings?.orderAlertVolume ?? 100,
      orderAlertRepeatCount: state.orderingSettings?.orderAlertRepeatCount ?? 2,
    },
  });
  invalidatePublicMenu(authorization.stall.id);
  for (const qrCode of qrTokensBefore) invalidatePublicQrToken(qrCode.token);
  if (state.qrCodes[0]) invalidatePublicQrToken(state.qrCodes[0].token);

  const publicOrderingSettings = state.orderingSettings
    ? (() => {
        const {
          managerAuthorizationCodeHash,
          managerAuthorizationCodeUpdatedAt: _managerAuthorizationCodeUpdatedAt,
          orderAlertSoundObjectPath,
          ...settings
        } = state.orderingSettings;
        void _managerAuthorizationCodeUpdatedAt;
        return {
          ...settings,
          managerAuthorizationCodeConfigured: Boolean(managerAuthorizationCodeHash),
          orderAlertSoundConfigured: Boolean(orderAlertSoundObjectPath),
        };
      })()
    : null;

  return NextResponse.json(
    {
      state: {
        ...state,
        orderingSettings: publicOrderingSettings,
        qrCode: state.qrCodes[0] ?? null,
        qrCodes: undefined,
      },
    },
    { headers: { "x-request-id": authorization.requestId } },
  );
}
