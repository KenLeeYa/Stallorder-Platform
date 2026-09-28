import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { requirePlatformRequest, platformErrorResponse, platformPrivateHeaders } from "@/server/line-platform/http";
import { refreshPlatformFriendship } from "@/server/line-platform/friendship";

export async function POST(request: Request) {
  try {
    const { principal, runtime } = await requirePlatformRequest(request, true);
    const rate = await checkRateLimit({ scope: "line-platform-friendship", identifier: principal.user.id, limit: 10, windowMs: 60_000 });
    if (!rate.allowed) throw new Error("LINE_PLATFORM_RATE_LIMITED");
    const input = z.object({ accessToken: z.string().min(1).max(4096) }).strict()
      .parse(JSON.parse(await readBoundedText(request, 8192)));
    const friendship = await refreshPlatformFriendship(principal, runtime, input.accessToken);
    return NextResponse.json({ friendship }, { headers: platformPrivateHeaders });
  } catch (error) { return platformErrorResponse(error); }
}
