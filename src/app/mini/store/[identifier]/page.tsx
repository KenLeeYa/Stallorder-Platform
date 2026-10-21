import { notFound } from "next/navigation";
import PublicStorefrontPage from "@/app/store/[identifier]/storefront-page";
import { prisma } from "@/lib/prisma";
import { getPagePrincipal } from "@/lib/auth";
import { resolvePublicStorefront, type PublicStorefrontSearchParams } from "@/lib/public-storefront";
import { getPlatformMember, hasPlatformIdentity } from "@/server/line-platform/member-service";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { LineMiniAppLogin } from "@/components/line-miniapp-login";
import { LinePlatformMemberForm } from "@/components/line-platform-member-form";
export const dynamic = "force-dynamic";
export default async function MiniStorePage(props: { params: Promise<{ identifier: string }>; searchParams: Promise<PublicStorefrontSearchParams> }) {
  const runtime = getLinePlatformRuntime();
  if (!runtime) notFound();
  const [{ identifier },query] = await Promise.all([props.params, props.searchParams]);
  const resolution = await resolvePublicStorefront(identifier);
  if (!resolution) notFound();
  const pilots = await prisma.$queryRaw<Array<{ stall_id: string }>>`select stall_id from public.line_platform_stalls
    where stall_id=${resolution.stall.id}::uuid and environment=${runtime.environment} and enabled`;
  if (!pilots.length) notFound();
  let platformCustomerId: string | undefined;
  if (query.view === "pickup" || query.view === "delivery") {
    const principal = await getPagePrincipal();
    const member = await getPlatformMember(principal);
    const lineIdentity = await hasPlatformIdentity(principal);
    if (!member || member.terms_version !== runtime.termsVersion) return <main className="mx-auto max-w-lg space-y-4 p-4"><h1 className="text-2xl font-bold">{resolution.stall.name}</h1>
      {lineIdentity ? <LinePlatformMemberForm termsVersion={runtime.termsVersion} /> : <LineMiniAppLogin liffId={runtime.liffId} endpointUrl={runtime.endpointUrl} />}</main>;
    platformCustomerId = member.profile_id;
  }
  return PublicStorefrontPage({ ...props, miniApp: true, platformCustomerId });
}
