import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { hashClientIp } from "@/lib/security";
import { archiveMerchantBusinessTypeOption } from "@/server/merchant-applications/business-type-option-service";

type RouteContext = { params: Promise<{ optionId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const { optionId } = await context.params;
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "CSRF 驗證失敗，請重新整理頁面後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const option = await archiveMerchantBusinessTypeOption(optionId, {
    actorProfileId: authorization.principal.user.id,
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
  });
  if (!option) {
    return NextResponse.json(
      { error: "找不到營業類型。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }
  return NextResponse.json({ option }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
}
