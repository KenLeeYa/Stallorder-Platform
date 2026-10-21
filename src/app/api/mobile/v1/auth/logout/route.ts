import { NextResponse } from "next/server";
import { getMobileBearerToken, getMobileSessionDeviceId, getMobileRefreshProfileId, revokeSessionToken } from "@/lib/auth";
import { createRequestId } from "@/lib/security";
import { productAnalytics } from "@/server/analytics/product-analytics";
export async function POST(request: Request) {
  const requestId = createRequestId();
  const deviceId = getMobileSessionDeviceId(request);
  const profileId = await getMobileRefreshProfileId(request).catch(() => null);
  const ok = deviceId && await revokeSessionToken(getMobileBearerToken(request), "MOBILE_LOGOUT", "NATIVE", deviceId);
  if (ok && profileId) productAnalytics.invalidate(profileId);
  return NextResponse.json(ok ? {ok:true} : {code:"AUTHENTICATION_REQUIRED",message:"請先登入。",requestId}, {status:ok?200:401,headers:{"cache-control":"private, no-store","x-request-id":requestId}});
}
