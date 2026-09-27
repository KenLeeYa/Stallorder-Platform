import { NextResponse } from "next/server";
import { z } from "zod";
import { getCookieValue } from "@/lib/security";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { claimGuestPlatformOrder, guestClaimCookieName } from "@/server/line-platform/guest-claim";
import { requirePlatformRequest, platformErrorResponse, platformPrivateHeaders } from "@/server/line-platform/http";

export async function POST(request: Request) {
  try {
    const { principal } = await requirePlatformRequest(request,true);
    const input = z.object({ trackingToken: z.string().max(100) }).strict().parse(JSON.parse(await readBoundedText(request,1024)));
    const orderId = await claimGuestPlatformOrder(principal,input.trackingToken,getCookieValue(request,"stallorder_device")??"",getCookieValue(request,guestClaimCookieName(input.trackingToken))??"");
    return NextResponse.json({ href:`/mini/orders/${orderId}` },{headers:platformPrivateHeaders});
  } catch(error) { return platformErrorResponse(error); }
}
