import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import {
  BoundedMultipartError,
  readBoundedMultipartFormData,
} from "@/lib/bounded-multipart-form-data";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hasExpectedImageSignature, type SupportedImageMime } from "@/lib/image-upload";
import {
  optimizeProductImage,
  ProductImageProcessingBusyError,
  ProductImageProcessorUnavailableError,
  withProductImageProcessingSlot,
} from "@/lib/product-image-processing";
import { invalidatePublicMenu, invalidatePublicQrToken } from "@/lib/public-menu";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import {
  enqueueStorageDeletion,
  enqueueStorageReplication,
} from "@/server/resilience/storage-replication-service";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileSize = 5 * 1024 * 1024;
const maxMultipartSize = maxFileSize + 256 * 1024;
const cropSchema = z.object({
  positionX: z.number().int().min(0).max(100),
  positionY: z.number().int().min(0).max(100),
  zoom: z.number().int().min(100).max(200),
});

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ stallId: string }> };
type StallImageSlot = "cover" | "location-guide";

function resolveImageSlot(request: Request): StallImageSlot {
  return new URL(request.url).searchParams.get("slot") === "location-guide"
    ? "location-guide"
    : "cover";
}

export async function POST(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const slot = resolveImageSlot(request);
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403 });
  }

  let form: FormData | null = null;
  try {
    form = await readBoundedMultipartFormData(request, maxMultipartSize);
  } catch (error) {
    if (error instanceof BoundedMultipartError) {
      const status = error.reason === "BODY_TOO_LARGE" || error.reason === "INVALID_CONTENT_LENGTH"
        ? 413
        : error.reason === "INVALID_CONTENT_TYPE"
          ? 415
          : error.reason === "READ_TIMEOUT"
            ? 408
            : 400;
      return NextResponse.json({ error: status === 413 ? "圖片上傳資料超過允許大小。" : status === 408 ? "圖片上傳逾時，請重試。" : "圖片上傳格式不正確。" }, { status });
    }
  }
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
    optimizedBytes = await withProductImageProcessingSlot(
      authorization.workspace.id,
      () => optimizeProductImage(bytes),
    );
  } catch (error) {
    if (error instanceof ProductImageProcessingBusyError) {
      return NextResponse.json(
        { error: "圖片處理中，請稍候再試。" },
        { status: 429, headers: { "retry-after": "2", "x-request-id": authorization.requestId } },
      );
    }
    if (error instanceof ProductImageProcessorUnavailableError) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "PRODUCT_IMAGE_PROCESSOR_UNAVAILABLE",
        requestId: authorization.requestId,
        organizationId: authorization.workspace.id,
        stallId,
      }));
      return NextResponse.json(
        { error: "圖片處理服務暫時無法使用，請稍後再試。" },
        { status: 503, headers: { "x-request-id": authorization.requestId } },
      );
    }
    return NextResponse.json({ error: "圖片無法解析或尺寸過大。" }, { status: 400 });
  }

  const organizationId = authorization.workspace.id;
  const objectPath = `${organizationId}/${slot === "cover" ? "stall-banners" : "stall-location-guides"}/${stallId}/${randomUUID()}.webp`;
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const previous = await prisma.stall.findUnique({
    where: { id: stallId, organizationId },
    select: { coverImageUrl: true, locationGuideImageUrl: true },
  });
  let upload: { error: unknown };
  try {
    upload = await admin.storage.from("product-images").upload(objectPath, optimizedBytes, {
      contentType: "image/webp",
      upsert: false,
      cacheControl: "31536000",
    });
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
        event: slot === "cover"
          ? "STALL_MENU_COVER_IMAGE_STORAGE_UPLOAD_FAILED"
          : "STALL_LOCATION_GUIDE_IMAGE_STORAGE_UPLOAD_FAILED",
      requestId: authorization.requestId,
      organizationId,
      stallId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    return NextResponse.json(
      { error: "圖片上傳失敗，請稍後再試。" },
      { status: 502, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (upload.error) {
    return NextResponse.json(
      { error: "圖片上傳失敗，請稍後再試。" },
      { status: 502, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const imageUrl = `/api/assets/product-images/${objectPath}`;
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
    await admin.storage.from("product-images").remove([objectPath]).catch(() => undefined);
    await recordAuditEvent({
      organizationId,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: slot === "cover"
        ? "STALL_MENU_COVER_IMAGE_REPLICATION_ENQUEUE_FAILED"
        : "STALL_LOCATION_GUIDE_IMAGE_REPLICATION_ENQUEUE_FAILED",
      entityType: "STALL",
      entityId: stallId,
      outcome: "FAILURE",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { reason: "OUTBOX_WRITE_FAILED" },
    });
    return NextResponse.json(
      { error: "圖片已接收，但目前無法建立安全複寫工作，請稍後再試。" },
      { status: 503, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const previousObjectPath = managedObjectPath(
    slot === "cover"
      ? previous?.coverImageUrl ?? null
      : previous?.locationGuideImageUrl ?? null,
    organizationId,
    stallId,
    slot,
  );
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.stall.update({
        where: { id: stallId, organizationId },
        data: slot === "cover"
          ? {
              coverImageUrl: imageUrl,
              coverImagePositionX: 50,
              coverImagePositionY: 50,
              coverImageZoom: 100,
            }
          : { locationGuideImageUrl: imageUrl },
      });
      if (previousObjectPath && previousObjectPath !== objectPath) {
        await enqueueStorageDeletion({
          organizationId,
          bucket: "product-images",
          objectPath: previousObjectPath,
          contentType: "image/webp",
        }, transaction);
      }
    });
  } catch {
    await enqueueStorageDeletion({
      organizationId,
      bucket: "product-images",
      objectPath,
      contentType: "image/webp",
    }).catch(() => undefined);
    return NextResponse.json(
      { error: "圖片更新失敗，請稍後再試。" },
      { status: 503, headers: { "x-request-id": authorization.requestId } },
    );
  }
  await invalidateCoverImage(stallId, organizationId);
  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
      action: slot === "cover"
        ? "STALL_MENU_COVER_IMAGE_UPDATED"
        : "STALL_LOCATION_GUIDE_IMAGE_UPDATED",
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
  if (resolveImageSlot(request) !== "cover") {
    return NextResponse.json({ error: "地點指引圖不需要設定裁切範圍。" }, { status: 400 });
  }
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403 });
  }
  const body = await readJson(request, authorization.requestId, { maxBytes: 1_024 });
  if (body.error) return body.error;
  const parsed = cropSchema.safeParse(body.data);
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
  const slot = resolveImageSlot(request);
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403 });
  }

  const organizationId = authorization.workspace.id;
  const previous = await prisma.stall.findUnique({
    where: { id: stallId, organizationId },
    select: { coverImageUrl: true, locationGuideImageUrl: true },
  });
  const previousObjectPath = managedObjectPath(
    slot === "cover"
      ? previous?.coverImageUrl ?? null
      : previous?.locationGuideImageUrl ?? null,
    organizationId,
    stallId,
    slot,
  );
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.stall.update({
        where: { id: stallId, organizationId },
        data: slot === "cover"
          ? {
              coverImageUrl: null,
              coverImagePositionX: 50,
              coverImagePositionY: 50,
              coverImageZoom: 100,
            }
          : { locationGuideImageUrl: null },
      });
      if (previousObjectPath) {
        await enqueueStorageDeletion({
          organizationId,
          bucket: "product-images",
          objectPath: previousObjectPath,
          contentType: "image/webp",
        }, transaction);
      }
    });
  } catch {
    return NextResponse.json(
      { error: "目前無法建立安全刪除工作，圖片尚未移除，請稍後再試。" },
      { status: 503, headers: { "x-request-id": authorization.requestId } },
    );
  }
  await invalidateCoverImage(stallId, organizationId);
  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: slot === "cover"
      ? "STALL_MENU_COVER_IMAGE_REMOVED"
      : "STALL_LOCATION_GUIDE_IMAGE_REMOVED",
    entityType: "STALL",
    entityId: stallId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: { storageDeletionQueued: Boolean(previousObjectPath) },
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

function managedObjectPath(
  imageUrl: string | null,
  organizationId: string,
  stallId: string,
  slot: StallImageSlot,
) {
  if (!imageUrl) return null;
  try {
    const pathname = new URL(imageUrl, "http://stallorder.local").pathname;
    const prefix = "/api/assets/product-images/";
    if (!pathname.startsWith(prefix)) return null;
    const objectPath = decodeURIComponent(pathname.slice(prefix.length));
    const expectedPrefix = `${organizationId}/${slot === "cover" ? "stall-banners" : "stall-location-guides"}/${stallId}/`;
    return objectPath.startsWith(expectedPrefix) && /^[0-9a-f-]{36}\.webp$/i.test(objectPath.slice(expectedPrefix.length))
      ? objectPath
      : null;
  } catch {
    return null;
  }
}
