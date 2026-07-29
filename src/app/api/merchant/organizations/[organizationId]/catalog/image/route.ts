import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { hasExpectedImageSignature, type SupportedImageMime } from "@/lib/image-upload";
import { optimizeProductImage } from "@/lib/product-image-processing";
import { hashClientIp } from "@/lib/security";
import { enqueueStorageReplication } from "@/server/resilience/storage-replication-service";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileSize = 5 * 1024 * 1024;

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_SHARED_PRODUCTS");
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
    return NextResponse.json({ error: "尚未設定商品圖片儲存服務。" }, { status: 503 });
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

  const objectPath = `${organizationId}/${randomUUID()}.webp`;
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const upload = await admin.storage.from("product-images").upload(objectPath, optimizedBytes, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: "31536000",
  });
  if (upload.error) {
    return NextResponse.json({ error: "圖片上傳失敗，請稍後再試。" }, { status: 502 });
  }
  const primaryChecksum = createHash("sha256").update(optimizedBytes).digest("hex");
  try {
    await enqueueStorageReplication({
      organizationId,
      bucket: "product-images",
      objectPath,
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
    },
  });
  const applicationOrigin = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
    : new URL(request.url).origin;
  const imageUrl = new URL(`/api/assets/product-images/${objectPath}`, applicationOrigin).toString();
  return NextResponse.json({ imageUrl }, { status: 201, headers: { "x-request-id": authorization.requestId } });
}
