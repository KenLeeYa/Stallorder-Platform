import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { createAndSealPaygPlanVersion, createPaygContractSchema } from "@/server/billing/payg-contract-admin";

const errors: Record<string, string> = {
  PAYG_SOURCE_VERSION_INVALID: "來源 PAYG 方案版本不存在或不符合目前計價契約。",
  PAYG_TAX_POLICY_MISMATCH: "稅務契約欄位不一致，請重新確認。",
  PAYG_BILLING_TIMEZONE_INVALID: "計費時區不是有效的 IANA 時區。",
};

export async function POST(request: Request) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403 });
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = createPaygContractSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "PAYG 契約格式不正確。" }, { status: 400 });
  }
  try {
    const version = await createAndSealPaygPlanVersion(parsed.data, {
      profileId: authorization.principal.user.id,
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json({ version: { id: version.id, version: version.version, contractHash: version.contractHash } }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: errors[code] ?? "目前無法建立 PAYG 契約版本。" }, { status: errors[code] ? 409 : 500 });
  }
}
