import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { kitchenSettingsSchema } from "@/lib/kitchen-contract";
import { hashClientIp } from "@/lib/security";
import { getKitchenSettings, updateKitchenSettings } from "@/lib/kitchen";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "MANAGE_KDS");
  if (!authorization.ok) return authorization.response;
  const settings = await getKitchenSettings(
    authorization.stall.organizationId,
    authorization.stall.id,
  );
  return NextResponse.json(settings, {
    headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "MANAGE_KDS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = kitchenSettingsSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "KDS 設定內容不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }
  await updateKitchenSettings(
    authorization.stall.organizationId,
    authorization.stall.id,
    parsed.data,
  );
  await recordAuditEvent({
    organizationId: authorization.stall.organizationId,
    stallId: authorization.stall.id,
    actorProfileId: authorization.principal.user.id,
    action: "KITCHEN_SETTINGS_UPDATED",
    entityType: "STALL_ORDERING_SETTINGS",
    entityId: authorization.stall.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: {
      warningMinutes: parsed.data.warningMinutes,
      criticalMinutes: parsed.data.criticalMinutes,
      defaultView: parsed.data.defaultView,
    },
  });
  return NextResponse.json({ ok: true }, { headers: { "x-request-id": authorization.requestId } });
}
