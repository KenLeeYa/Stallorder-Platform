import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { acceptPlatformMembership, getPlatformMember } from "@/server/line-platform/member-service";
import { requirePlatformRequest, platformErrorResponse, platformPrivateHeaders } from "@/server/line-platform/http";

export async function GET(request: Request) {
  try {
    const { principal, runtime } = await requirePlatformRequest(request);
    const member = await getPlatformMember(principal);
    const friendship = member ? await prisma.$queryRaw<Array<{ status: string; observed_at: Date }>>`
      select status,observed_at from public.line_platform_friendships where environment=${runtime.environment}
        and provider_id=${runtime.providerId} and subject_hash=${member.subject_hash} order by observed_at desc limit 1` : [];
    return NextResponse.json({ member: member ? { termsVersion: member.terms_version,
      termsAcceptedAt: member.terms_accepted_at, notificationConsent: member.notification_consent } : null,
      termsVersion: runtime.termsVersion, friendship: friendship[0]?.status ?? "UNKNOWN",
      addFriendUrl: runtime.addFriendUrl ?? null }, { headers: platformPrivateHeaders });
  } catch (error) { return platformErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const { principal } = await requirePlatformRequest(request, true);
    const input = z.object({ termsVersion: z.string().max(80), acceptTerms: z.literal(true), notificationConsent: z.boolean() }).strict()
      .parse(JSON.parse(await readBoundedText(request, 1024)));
    await acceptPlatformMembership(principal, input);
    return NextResponse.json({ ok: true }, { headers: platformPrivateHeaders });
  } catch (error) { return platformErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const { principal } = await requirePlatformRequest(request, true);
    const input = z.object({ notificationConsent: z.boolean() }).strict().parse(JSON.parse(await readBoundedText(request, 1024)));
    const member = await getPlatformMember(principal);
    if (!member) throw new Error("LINE_PLATFORM_LOGIN_REQUIRED");
    await prisma.$transaction(async db => {
      await db.$executeRaw`update public.line_platform_members set notification_consent=${input.notificationConsent},consent_updated_at=now()
        where profile_id=${principal.user.id}::uuid and revoked_at is null`;
      await db.$executeRaw`insert into public.line_platform_member_audit(profile_id,event_type)
        values (${principal.user.id}::uuid,${input.notificationConsent ? "TRANSACTION_NOTIFICATIONS_ENABLED" : "TRANSACTION_NOTIFICATIONS_REVOKED"})`;
    });
    return NextResponse.json({ ok: true }, { headers: platformPrivateHeaders });
  } catch (error) { return platformErrorResponse(error); }
}
