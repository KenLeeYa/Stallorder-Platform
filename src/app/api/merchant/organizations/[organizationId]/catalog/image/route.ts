import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import {
  BoundedMultipartError,
  readBoundedMultipartFormData,
} from "@/lib/bounded-multipart-form-data";
import { validateCsrf } from "@/lib/csrf";
import { hasExpectedImageSignature, type SupportedImageMime } from "@/lib/image-upload";
import {
  optimizeProductImage,
  ProductImageProcessingBusyError,
  ProductImageProcessorUnavailableError,
  withProductImageProcessingSlot,
} from "@/lib/product-image-processing";
import { hashClientIp } from "@/lib/security";
import { enqueueStorageReplication } from "@/server/resilience/storage-replication-service";
import {
  CatalogImageQuotaError,
  expireCatalogImageUpload,
  reserveCatalogImageUpload,
} from "@/server/catalog/catalog-image-upload-service";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileSize = 5 * 1024 * 1024;
const maxMultipartSize = maxFileSize + 256 * 1024;
const cropSchema = z.object({
  positionX: z.coerce.number().min(0).max(100).default(50),
  positionY: z.coerce.number().min(0).max(100).default(50),
  zoom: z.coerce.number().min(100).max(200).default(100),
});

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_SHARED_PRODUCTS");
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
    return NextResponse.json({ error: "請上傳 5MB 以下的 JPG、PNG 或 WebP 圖片；系統會自動轉為適合 Menu 顯示的 WebP。" }, { status: 400 });
  }
  const crop = cropSchema.safeParse({
    positionX: form?.get("positionX") ?? undefined,
    positionY: form?.get("positionY") ?? undefined,
    zoom: form?.get("zoom") ?? undefined,
  });
  if (!crop.success) {
    return NextResponse.json({ error: "圖片裁切範圍不正確，請重新調整後再試。" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ error: "尚未設定商品圖片儲存服務。" }, { status: 503 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedImageSignature(bytes, file.type as SupportedImageMime)) {
    return NextResponse.json({ error: "圖片內容與檔案格式不符。" }, { status: 400 });
  }

  let optimizedBytes: Buffer;
  try {
    optimizedBytes = await withProductImageProcessingSlot(
      organizationId,
      () => optimizeProductImage(bytes, crop.data),
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
        organizationId,
      }));
      return NextResponse.json(
        { error: "圖片處理服務暫時無法使用，請稍後再試。" },
        { status: 503, headers: { "x-request-id": authorization.requestId } },
      );
    }
    return NextResponse.json({ error: "圖片無法解析或尺寸過大。" }, { status: 400 });
  }

  const objectPath = `${organizationId}/${randomUUID()}.webp`;
  try {
    await reserveCatalogImageUpload(organizationId, objectPath);
  } catch (error) {
    if (error instanceof CatalogImageQuotaError) {
      return NextResponse.json(
        { error: "尚有過多未儲存的暫存圖片，請先完成商品儲存或稍後再試。" },
        { status: 429, headers: { "retry-after": "300", "x-request-id": authorization.requestId } },
      );
    }
    return NextResponse.json(
      { error: "目前無法建立圖片上傳工作，請稍後再試。" },
      { status: 503, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const upload = await admin.storage.from("product-images").upload(objectPath, optimizedBytes, {
      contentType: "image/webp",
      upsert: false,
      cacheControl: "31536000",
    });
    if (upload.error) {
      await expireCatalogImageUpload(organizationId, objectPath).catch(() => undefined);
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "PRODUCT_IMAGE_STORAGE_UPLOAD_FAILED",
        requestId: authorization.requestId,
        organizationId,
      }));
      return NextResponse.json(
        { error: "圖片上傳失敗，請稍後再試。" },
        { status: 502, headers: { "x-request-id": authorization.requestId } },
      );
    }
  } catch (error) {
    await expireCatalogImageUpload(organizationId, objectPath).catch(() => undefined);
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "PRODUCT_IMAGE_STORAGE_UPLOAD_FAILED",
      requestId: authorization.requestId,
      organizationId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    return NextResponse.json(
      { error: "圖片上傳失敗，請稍後再試。" },
      { status: 502, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const primaryChecksum = createHash("sha256").update(optimizedBytes).digest("hex");
  try {
    await enqueueStorageReplication({
      organizationId,
      bucket: "product-images",
      objectPath,
      contentType: "image/webp",
      primaryChecksum,
      primaryUpdatedAt: new Date(),
    });
  } catch {
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "PRODUCT_IMAGE_REPLICATION_ENQUEUE_FAILED",
      entityType: "PRODUCT_IMAGE",
      outcome: "FAILURE",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { reason: "OUTBOX_WRITE_FAILED" },
    });
  }
  await recordAuditEvent({
    organizationId,
    actorProfileId: authorization.principal.user.id,
    action: "PRODUCT_IMAGE_UPLOADED",
    entityType: "PRODUCT_IMAGE",
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: {
      contentType: "image/webp",
      sourceContentType: file.type,
      originalSize: file.size,
      optimizedSize: optimizedBytes.byteLength,
      cropPositionX: crop.data.positionX,
      cropPositionY: crop.data.positionY,
      cropZoom: crop.data.zoom,
    },
  });
  const applicationOrigin = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
    : new URL(request.url).origin;
  const imageUrl = new URL(`/api/assets/product-images/${objectPath}`, applicationOrigin).toString();
  return NextResponse.json({
    imageUrl,
    originalSize: file.size,
    optimizedSize: optimizedBytes.byteLength,
  }, { status: 201, headers: { "x-request-id": authorization.requestId } });
}
