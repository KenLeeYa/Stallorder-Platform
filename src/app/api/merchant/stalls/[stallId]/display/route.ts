import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import {
  cdsVoiceAvailable,
  pickupDisplayCommandSchema,
} from "@/lib/pickup-display-contract";
import { getPickupDisplayManagerSettings } from "@/lib/pickup-display";
import { prisma } from "@/lib/prisma";
import { createOpaqueToken, hashClientIp, hashToken } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_CDS");
  if (!authorization.ok) return authorization.response;
  try {
    const settings = await getPickupDisplayManagerSettings(authorization.workspace.id, stallId);
    return NextResponse.json(
      { settings },
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    throw error;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_CDS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證失敗，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    return NextResponse.json(
      { error: "Content-Type 必須是 application/json。" },
      { status: 415, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = pickupDisplayCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "取餐顯示設定格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const organizationId = authorization.workspace.id;
  const command = parsed.data;
  let displayToken: string | undefined;
  let action: string;
  let metadata: Record<string, string | number | boolean | null> = {};
  try {
    const entitlement = await entitlementService.assertFeatureEnabled(organizationId, "CDS");
    const voiceAvailable = cdsVoiceAvailable(entitlement.configuration);
    if (command.operation === "UPDATE_SETTINGS" && command.enableVoice && !voiceAvailable) {
      return NextResponse.json(
        { error: "目前方案未包含 CDS 語音播報。" },
        { status: 403, headers: { "x-request-id": authorization.requestId } },
      );
    }

    if (command.operation === "ROTATE_TOKEN") {
      displayToken = createOpaqueToken();
      await prisma.pickupDisplaySettings.update({
        where: { stallId, organizationId },
        data: { displayTokenHash: hashToken(displayToken) },
      });
      action = "PICKUP_DISPLAY_TOKEN_ROTATED";
    } else if (command.operation === "REVOKE_TOKEN") {
      await prisma.pickupDisplaySettings.update({
        where: { stallId, organizationId },
        data: { displayTokenHash: null },
      });
      action = "PICKUP_DISPLAY_TOKEN_REVOKED";
    } else {
      await prisma.pickupDisplaySettings.upsert({
        where: { stallId },
        create: {
          organizationId,
          stallId,
          showCustomerName: command.showCustomerName,
          showPickupCode: command.showPickupCode,
          maskPickupCode: command.maskPickupCode,
          readyRetentionMinutes: command.readyRetentionMinutes,
          preparingRetentionMinutes: command.preparingRetentionMinutes,
          enableVoice: command.enableVoice,
          voiceLocale: command.voiceLocale,
          announcementText: command.announcementText || null,
          themeJson: command.theme as Prisma.InputJsonValue,
          isActive: command.isActive,
        },
        update: {
          showCustomerName: command.showCustomerName,
          showPickupCode: command.showPickupCode,
          maskPickupCode: command.maskPickupCode,
          readyRetentionMinutes: command.readyRetentionMinutes,
          preparingRetentionMinutes: command.preparingRetentionMinutes,
          enableVoice: command.enableVoice,
          voiceLocale: command.voiceLocale,
          announcementText: command.announcementText || null,
          themeJson: command.theme as Prisma.InputJsonValue,
          isActive: command.isActive,
        },
      });
      action = "PICKUP_DISPLAY_SETTINGS_UPDATED";
      metadata = {
        isActive: command.isActive,
        showCustomerName: command.showCustomerName,
        showPickupCode: command.showPickupCode,
        maskPickupCode: command.maskPickupCode,
        readyRetentionMinutes: command.readyRetentionMinutes,
        preparingRetentionMinutes: command.preparingRetentionMinutes,
        enableVoice: command.enableVoice,
        voiceLocale: command.voiceLocale,
      };
    }

    await recordAuditEvent({
      organizationId,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action,
      entityType: "PICKUP_DISPLAY_SETTINGS",
      entityId: stallId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata,
    });
    const settings = await getPickupDisplayManagerSettings(organizationId, stallId);
    return NextResponse.json(
      { settings, ...(displayToken ? { displayToken } : {}) },
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    throw error;
  }
}

function noStoreHeaders(requestId: string) {
  return { "cache-control": "private, no-store", "x-request-id": requestId };
}
