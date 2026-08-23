import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  alertSoundExtension,
  hasExpectedAlertSoundSignature,
  MAX_ALERT_SOUND_BYTES,
  type SupportedAlertSoundMime,
} from "@/lib/alert-sound-upload";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

const allowedTypes = new Set<SupportedAlertSoundMime>([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
]);

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ stallId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_ORDERING");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("sound");
  if (
    !(file instanceof File)
    || file.size === 0
    || file.size > MAX_ALERT_SOUND_BYTES
    || !allowedTypes.has(file.type as SupportedAlertSoundMime)
  ) {
    return NextResponse.json({ error: "請上傳 1MB 以下的 MP3、WAV 或 M4A 音效。" }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = file.type as SupportedAlertSoundMime;
  if (!hasExpectedAlertSoundSignature(bytes, mime)) {
    return NextResponse.json({ error: "音效內容與檔案格式不符。" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ error: "尚未設定音效儲存服務。" }, { status: 503 });
  }
  const organizationId = authorization.workspace.id;
  const extension = alertSoundExtension(mime);
  const objectPath = `${organizationId}/stall-alerts/${stallId}/${randomUUID()}.${extension}`;
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const previous = await prisma.stallOrderingSettings.findUnique({
    where: { stallId },
    select: { orderAlertSoundObjectPath: true },
  });
  const upload = await admin.storage.from("alert-sounds").upload(objectPath, bytes, {
    contentType: mime,
    cacheControl: "0",
    upsert: false,
  });
  if (upload.error) {
    return NextResponse.json({ error: "提示音上傳失敗，請稍後再試。" }, { status: 502 });
  }
  try {
    await prisma.stallOrderingSettings.upsert({
      where: { stallId },
      create: {
        stallId,
        organizationId,
        orderAlertSoundPreset: "CUSTOM",
        orderAlertSoundObjectPath: objectPath,
      },
      update: {
        orderAlertSoundPreset: "CUSTOM",
        orderAlertSoundObjectPath: objectPath,
      },
    });
  } catch (error) {
    await admin.storage.from("alert-sounds").remove([objectPath]);
    throw error;
  }
  if (previous?.orderAlertSoundObjectPath) {
    await admin.storage.from("alert-sounds").remove([previous.orderAlertSoundObjectPath]);
  }
  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: "STALL_ORDER_ALERT_SOUND_UPLOADED",
    entityType: "STALL_ORDERING_SETTINGS",
    entityId: stallId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: { mime, bytes: file.size },
  });
  return NextResponse.json({ ok: true, configured: true, preset: "CUSTOM" }, {
    headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_ORDERING");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403 });
  }
  const organizationId = authorization.workspace.id;
  const previous = await prisma.stallOrderingSettings.findUnique({
    where: { stallId },
    select: { orderAlertSoundObjectPath: true },
  });
  await prisma.stallOrderingSettings.upsert({
    where: { stallId },
    create: { stallId, organizationId, orderAlertSoundPreset: "URGENT" },
    update: { orderAlertSoundPreset: "URGENT", orderAlertSoundObjectPath: null },
  });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (previous?.orderAlertSoundObjectPath && supabaseUrl && secretKey) {
    const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await admin.storage.from("alert-sounds").remove([previous.orderAlertSoundObjectPath]);
  }
  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: "STALL_ORDER_ALERT_SOUND_REMOVED",
    entityType: "STALL_ORDERING_SETTINGS",
    entityId: stallId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
  });
  return NextResponse.json({ ok: true, configured: false, preset: "URGENT" }, {
    headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
  });
}
