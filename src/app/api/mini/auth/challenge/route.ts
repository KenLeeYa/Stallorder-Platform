import { NextResponse } from "next/server";
import { z } from "zod";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { createMiniAppLoginChallenge, MINI_APP_CHALLENGE_COOKIE, MINI_APP_CHALLENGE_TTL_SECONDS } from "@/server/line-miniapp/login-service";
import { guardMiniAppRequest, miniAppErrorResponse, miniAppResponseHeaders } from "@/server/line-miniapp/http";

const inputSchema = z.object({ returnTo: z.string().max(500).default("/mini") }).strict();
export async function POST(request: Request) {
  try {
    const guard = await guardMiniAppRequest(request);
    if (guard.response) return guard.response;
    const input = inputSchema.parse(JSON.parse(await readBoundedText(request, 2048)));
    const challenge = await createMiniAppLoginChallenge(guard.binding, input.returnTo);
    const response = NextResponse.json({ challenge: challenge.challenge }, { headers: miniAppResponseHeaders });
    response.cookies.set(MINI_APP_CHALLENGE_COOKIE, challenge.browserSecret, {
      httpOnly: true, secure: true, sameSite: "strict", path: "/api/mini/auth", maxAge: MINI_APP_CHALLENGE_TTL_SECONDS,
    });
    return response;
  } catch (error) { return miniAppErrorResponse(error); }
}
