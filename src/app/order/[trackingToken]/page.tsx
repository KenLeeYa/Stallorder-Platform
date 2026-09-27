import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getPagePrincipal } from "@/lib/auth";
import { getPlatformMember } from "@/server/line-platform/member-service";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { guestClaimCookieName, readGuestClaimProof } from "@/server/line-platform/guest-claim";
import { PublicOrderTracker } from "@/components/public-order-tracker";

type PageProps = {
  params: Promise<{ trackingToken: string }>;
  searchParams?: Promise<{ qr?: string | string[] }>;
};

export default async function PublicOrderPage({ params, searchParams }: PageProps) {
  const [{ trackingToken }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ qr?: string | string[] }>({}),
  ]);
  const rawQrToken = Array.isArray(query.qr) ? query.qr[0] : query.qr;
  const qrToken = rawQrToken
    && rawQrToken.trim().length >= 24
    && rawQrToken.length <= 200
    ? rawQrToken
    : null;
  let platformClaim: { member: boolean } | undefined;
  try {
  const runtime = getLinePlatformRuntime();
  const cookieStore = runtime ? await cookies() : null;
  const proof = cookieStore?.get(guestClaimCookieName(trackingToken))?.value ?? "";
  if (runtime && readGuestClaimProof(trackingToken,cookieStore?.get("stallorder_device")?.value ?? "",proof,runtime)) {
    const hash=createHash("sha256").update(trackingToken).digest("hex");
    const eligible=await prisma.$queryRaw<Array<{id:string}>>`select o.id from public.orders o
      join public.line_platform_stalls s on s.stall_id=o.stall_id and s.environment=${runtime.environment} and s.enabled and o.created_at>=s.cutover_at
      where o.tracking_token_hash=${hash} and o.status::text not in ('COMPLETED','CANCELLED','EXPIRED')
        and not exists(select 1 from public.customer_contact_links l join public.notification_integrations i on i.id=l.integration_id
          where l.customer_reference_id=o.id and i.sender_scope<>'PLATFORM_OA')`;
    if (eligible.length) {
      const member=await getPlatformMember(await getPagePrincipal());
      platformClaim={member:Boolean(member && member.terms_version===runtime.termsVersion)};
    }
  }
  } catch {
    // Optional membership presentation must not interrupt the original tracker.
  }
  return <PublicOrderTracker trackingToken={trackingToken} qrToken={qrToken} platformClaim={platformClaim} />;
}
