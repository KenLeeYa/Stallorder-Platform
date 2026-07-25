import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { merchantBusinessTypeOptionCommandSchema } from "@/lib/merchant-business-type-options";
import { hashClientIp } from "@/lib/security";
import {
  listMerchantBusinessTypeOptionsForAdmin,
  upsertMerchantBusinessTypeOption,
} from "@/server/merchant-applications/business-type-option-service";

export async function GET(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  const options = await listMerchantBusinessTypeOptionsForAdmin();
  return NextResponse.json({ options }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
}

export async function POST(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "CSRF 驗證失敗，請重新整理頁面後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = merchantBusinessTypeOptionCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "營業類型資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const option = await upsertMerchantBusinessTypeOption(parsed.data, {
    actorProfileId: authorization.principal.user.id,
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
  });
  return NextResponse.json({ option }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
}
