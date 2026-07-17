import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { hasExpectedImageSignature, type SupportedImageMime } from "@/lib/image-upload";
import { hashClientIp } from "@/lib/security";

const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const maxFileSize = 5 * 1024 * 1024;

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

  const extension = allowedTypes.get(file.type)!;
  const objectPath = `${organizationId}/${randomUUID()}.${extension}`;
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const upload = await admin.storage.from("product-images").upload(objectPath, bytes, {
    contentType: file.type,
    upsert: false,
    cacheControl: "31536000",
  });
  if (upload.error) {
    return NextResponse.json({ error: "圖片上傳失敗，請稍後再試。" }, { status: 502 });
  }
  const { data } = admin.storage.from("product-images").getPublicUrl(objectPath);
  await recordAuditEvent({
    organizationId,
    actorProfileId: authorization.principal.user.id,
    action: "PRODUCT_IMAGE_UPLOADED",
    entityType: "PRODUCT_IMAGE",
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: { contentType: file.type, size: file.size },
  });
  return NextResponse.json({ imageUrl: data.publicUrl }, { status: 201, headers: { "x-request-id": authorization.requestId } });
}
