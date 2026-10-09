import { NextResponse } from "next/server";
import { z } from "zod";
import { setSessionCookies } from "@/lib/auth";
import { getRequestDeviceLabel } from "@/lib/device-label";
import { createRequestId, getCookieValue, hashClientUserAgent, resolveSessionDeviceId } from "@/lib/security";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { exchangeMiniAppLogin, MINI_APP_CHALLENGE_COOKIE } from "@/server/line-miniapp/login-service";
import { guardMiniAppRequest, miniAppErrorResponse, miniAppResponseHeaders } from "@/server/line-miniapp/http";

const inputSchema = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), idToken: z.string().min(1).max(16_384) }).strict();
export async function POST(request: Request) {
  try {
    const guard = await guardMiniAppRequest(request);
    if (guard.response) return guard.response;
    const input = inputSchema.parse(JSON.parse(await readBoundedText(request, 18_432)));
    const result = await exchangeMiniAppLogin({
      binding: guard.binding, challenge: input.challenge, rawIdToken: input.idToken,
      browserSecret: getCookieValue(request, MINI_APP_CHALLENGE_COOKIE) ?? "", requestId: createRequestId(),
      sessionEvidence: { deviceId: resolveSessionDeviceId(request), deviceLabel: getRequestDeviceLabel(request),
        ipHash: guard.ipHash, userAgentHash: hashClientUserAgent(request) },
    });
    const response = NextResponse.json({ returnTo: result.returnTo }, { headers: miniAppResponseHeaders });
    setSessionCookies(response, result.session);
    for (const cookie of response.cookies.getAll()) response.cookies.set({ ...cookie, secure: true });
    response.cookies.set(MINI_APP_CHALLENGE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/api/mini/auth", maxAge: 0 });
    return response;
  } catch (error) { return miniAppErrorResponse(error); }
}
