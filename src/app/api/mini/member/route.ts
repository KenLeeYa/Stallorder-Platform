import { NextResponse } from "next/server";
import { z } from "zod";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { acceptPlatformMembership, getPlatformMember } from "@/server/line-platform/member-service";
import { requirePlatformRequest, platformErrorResponse, platformPrivateHeaders } from "@/server/line-platform/http";

export async function GET(request: Request) {
  try {
    const { principal, runtime } = await requirePlatformRequest(request);
    const member = await getPlatformMember(principal);
    return NextResponse.json({ member: member ? { termsVersion: member.terms_version,
      termsAcceptedAt: member.terms_accepted_at } : null,
      termsVersion: runtime.termsVersion }, { headers: platformPrivateHeaders });
  } catch (error) { return platformErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const { principal } = await requirePlatformRequest(request, true);
    const input = z.object({ termsVersion: z.string().max(80), acceptTerms: z.literal(true) }).strict()
      .parse(JSON.parse(await readBoundedText(request, 1024)));
    await acceptPlatformMembership(principal, input);
    return NextResponse.json({ ok: true }, { headers: platformPrivateHeaders });
  } catch (error) { return platformErrorResponse(error); }
}
