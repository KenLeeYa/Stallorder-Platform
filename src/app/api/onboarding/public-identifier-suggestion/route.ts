import { NextResponse } from "next/server";
import { getRequestPrincipal } from "@/lib/auth";
import { singleLineText } from "@/lib/input-validation";
import { generatePublicIdentifierSuggestion } from "@/lib/public-identifier-suggestion";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId } from "@/lib/security";
import { hasActiveOAuthIdentity } from "@/server/auth/oauth/profile-identity";

const merchantNameSchema = singleLineText({
  minimum: 2,
  maximum: 120,
  requiredMessage: "商家或品牌名稱至少需要 2 個字元。",
});

export async function GET(request: Request) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  const hasOAuthIdentity = principal
    ? await hasActiveOAuthIdentity(principal.user.id)
    : false;
  if (!principal || (!principal.user.authUserId && !hasOAuthIdentity)) {
    return NextResponse.json(
      { error: "請先使用已驗證的帳號登入。" },
      { status: 401, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }

  const limit = await checkRateLimit({
    scope: "merchant-public-identifier-suggestion",
    identifier: principal.user.id,
    limit: 60,
    windowMs: 60 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "產生建議的次數過多，請稍後再試。" },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }

  const parsed = merchantNameSchema.safeParse(new URL(request.url).searchParams.get("merchantName"));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "商家或品牌名稱格式不正確。" },
      { status: 400, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }

  return NextResponse.json(
    { suggestion: generatePublicIdentifierSuggestion(parsed.data) },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
