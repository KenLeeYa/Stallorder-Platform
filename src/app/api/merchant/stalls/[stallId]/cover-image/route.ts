import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { hasExpectedImageSignature, type SupportedImageMime } from "@/lib/image-upload";
import { optimizeProductImage } from "@/lib/product-image-processing";
import { invalidatePublicMenu, invalidatePublicQrToken } from "@/lib/public-menu";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { enqueueStorageReplication } from "@/server/resilience/storage-replication-service";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileSize = 5 * 1024 * 1024;
const cropSchema = z.object({
  positionX: z.number().int().min(0).max(100),
  positionY: z.number().int().min(0).max(100),
  zoom: z.number().int().min(100).max(200),
});

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File) || file.size === 0 || file.size > maxFileSize || !allowedTypes.has(file.type)) {
    return NextResponse.json({ error: "請上傳 5MB 以下的 JPG、PNG 或 WebP 圖片。" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ error: "尚未設定圖片儲存服務。" }, { status: 503 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedImageSignature(bytes, file.type as SupportedImageMime)) {
    return NextResponse.json({ error: "圖片內容與檔案格式不符。" }, { status: 400 });
  }

  let optimizedBytes: Buffer;
  try {
    optimizedBytes = await optimizeProductImage(bytes);
  } catch {
    return NextResponse.json({ error: "圖片無法解析或尺寸過大。" }, { status: 400 });
  }

  const organizationId = authorization.workspace.id;
  const objectPath = `${organizationId}/stall-banners/${stallId}/${randomUUID()}.webp`;
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const previous = await prisma.stall.findUnique({
    where: { id: stallId, organizationId },
    select: { coverImageUrl: true },
  });
  const upload = await admin.storage.from("product-images").upload(objectPath, optimizedBytes, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: "31536000",
  });
  if (upload.error) {
    return NextResponse.json({ error: "圖片上傳失敗，請稍後再試。" }, { status: 502 });
  }

  const imageUrl = `/api/assets/product-images/${objectPath}`;
  await prisma.stall.update({
    where: { id: stallId, organizationId },
    data: {
      coverImageUrl: imageUrl,
      coverImagePositionX: 50,
      coverImagePositionY: 50,
      coverImageZoom: 100,
    },
  });
  await invalidateCoverImage(stallId, organizationId);
  await removeManagedImage(admin, previous?.coverImageUrl ?? null, organizationId, stallId);

  try {
    await enqueueStorageReplication({
      organizationId,
      bucket: "product-images",
      objectPath,
      contentType: "image/webp",
      primaryChecksum: createHash("sha256").update(optimizedBytes).digest("hex"),
      primaryUpdatedAt: new Date(),
    });
  } catch {
    await recordAuditEvent({
      organizationId,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: "STALL_MENU_COVER_IMAGE_REPLICATION_ENQUEUE_FAILED",
      entityType: "STALL",
      entityId: stallId,
      outcome: "FAILURE",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { reason: "OUTBOX_WRITE_FAILED" },
    });
  }
  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: "STALL_MENU_COVER_IMAGE_UPDATED",
    entityType: "STALL",
    entityId: stallId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: {
      contentType: "image/webp",
      sourceContentType: file.type,
      originalSize: file.size,
      optimizedSize: optimizedBytes.byteLength,
    },
  });
  return NextResponse.json({
    imageUrl,
    positionX: 50,
    positionY: 50,
    zoom: 100,
    originalSize: file.size,
    optimizedSize: optimizedBytes.byteLength,
  }, { status: 201, headers: { "x-request-id": authorization.requestId } });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403 });
  }
  const parsed = cropSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "文宣圖片顯示範圍不正確。" }, { status: 400 });
  }

  const organizationId = authorization.workspace.id;
  const updated = await prisma.stall.update({
    where: { id: stallId, organizationId },
    data: {
      coverImagePositionX: parsed.data.positionX,
      coverImagePositionY: parsed.data.positionY,
      coverImageZoom: parsed.data.zoom,
    },
    select: {
      coverImageUrl: true,
      coverImagePositionX: true,
      coverImagePositionY: true,
      coverImageZoom: true,
    },
  });
  if (!updated.coverImageUrl) {
    return NextResponse.json({ error: "尚未上傳文宣圖片。" }, { status: 409 });
  }
  await invalidateCoverImage(stallId, organizationId);
  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: "STALL_MENU_COVER_IMAGE_CROP_UPDATED",
    entityType: "STALL",
    entityId: stallId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: parsed.data,
  });
  return NextResponse.json({
    imageUrl: updated.coverImageUrl,
    positionX: updated.coverImagePositionX,
    positionY: updated.coverImagePositionY,
    zoom: updated.coverImageZoom,
  }, { headers: { "x-request-id": authorization.requestId } });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403 });
  }

  const organizationId = authorization.workspace.id;
  const previous = await prisma.stall.findUnique({
    where: { id: stallId, organizationId },
    select: { coverImageUrl: true },
  });
  await prisma.stall.update({
    where: { id: stallId, organizationId },
    data: {
      coverImageUrl: null,
      coverImagePositionX: 50,
      coverImagePositionY: 50,
      coverImageZoom: 100,
    },
  });
  await invalidateCoverImage(stallId, organizationId);
  const admin = storageAdmin();
  const storageRemoved = admin
    ? await removeManagedImage(admin, previous?.coverImageUrl ?? null, organizationId, stallId)
    : false;
  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: "STALL_MENU_COVER_IMAGE_REMOVED",
    entityType: "STALL",
    entityId: stallId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: { storageRemoved },
  });
  return NextResponse.json({ ok: true }, { headers: { "x-request-id": authorization.requestId } });
}

async function invalidateCoverImage(stallId: string, organizationId: string) {
  const qrCodes = await prisma.qrCode.findMany({
    where: { stallId, organizationId },
    select: { token: true },
  });
  invalidatePublicMenu(stallId);
  for (const qrCode of qrCodes) invalidatePublicQrToken(qrCode.token);
}

function storageAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return supabaseUrl && secretKey
    ? createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
}

async function removeManagedImage(
  admin: {
    storage: {
      from: (bucket: string) => {
        remove: (paths: string[]) => Promise<{ error: unknown }>;
      };
    };
  },
  imageUrl: string | null,
  organizationId: string,
  stallId: string,
) {
  const objectPath = managedObjectPath(imageUrl, organizationId, stallId);
  if (!objectPath) return false;
  const removal = await admin.storage.from("product-images").remove([objectPath]);
  return !removal.error;
}

function managedObjectPath(imageUrl: string | null, organizationId: string, stallId: string) {
  if (!imageUrl) return null;
  try {
    const pathname = new URL(imageUrl, "http://stallorder.local").pathname;
    const prefix = "/api/assets/product-images/";
    if (!pathname.startsWith(prefix)) return null;
    const objectPath = decodeURIComponent(pathname.slice(prefix.length));
    const expectedPrefix = `${organizationId}/stall-banners/${stallId}/`;
    return objectPath.startsWith(expectedPrefix) && /^[0-9a-f-]{36}\.webp$/i.test(objectPath.slice(expectedPrefix.length))
      ? objectPath
      : null;
  } catch {
    return null;
  }
}
