import { notFound } from "next/navigation";
import { CircleUserRound, MessageCircle } from "lucide-react";
import { getPagePrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { getPlatformMember, hasPlatformIdentity } from "@/server/line-platform/member-service";
import { LineMiniAppLogin } from "@/components/line-miniapp-login";
import { LinePlatformMemberForm } from "@/components/line-platform-member-form";
import { LogoutButton } from "@/components/logout-button";
import { LinePlatformFriendship } from "@/components/line-platform-friendship";
export const dynamic = "force-dynamic";
export default async function MemberPage() {
  const runtime = getLinePlatformRuntime();
  if (!runtime) notFound();
  const principal = await getPagePrincipal();
  const member = await getPlatformMember(principal);
  const lineIdentity = await hasPlatformIdentity(principal);
  const friendships = member ? await prisma.$queryRaw<Array<{ status: string }>>`
    select status from public.line_platform_friendships where environment=${runtime.environment}
      and provider_id=${runtime.providerId} and subject_hash=${member.subject_hash} order by observed_at desc limit 1` : [];
  const status = friendships[0]?.status ?? "UNKNOWN";
  return <main className="mx-auto max-w-lg space-y-5 p-4"><h1 className="text-2xl font-bold">平台會員中心</h1>
    {!lineIdentity ? <LineMiniAppLogin liffId={runtime.liffId} endpointUrl={runtime.endpointUrl} /> : <>
      <div className="mini-hero mini-member-hero"><span className="mini-store-icon"><CircleUserRound aria-hidden="true" /></span><div><p className="font-semibold">{member ? "歡迎回到攤點通" : "歡迎加入攤點通"}</p><p className="mini-muted">LINE 身分已登入{member ? "，平台會員已建立。" : "，請閱讀條款後加入平台會員。"}</p></div></div>
      <LinePlatformMemberForm termsVersion={runtime.termsVersion} enrolled={Boolean(member && member.terms_version === runtime.termsVersion)} initialConsent={member?.notification_consent} />
      <section className="mini-card space-y-4"><h2 className="flex items-center gap-2 font-semibold"><MessageCircle className="size-5" aria-hidden="true" />攤點通官方帳號</h2>
        {member ? <LinePlatformFriendship liffId={runtime.liffId} initialStatus={status} /> : <p>加入平台會員後可確認好友狀態。</p>}
        <p className="mini-muted">所有合作店家的訂單與取餐通知，都由攤點通發送。未收到通知時，可至「我的訂單」查看進度。</p>
        {runtime.addFriendUrl && <a href={runtime.addFriendUrl} className="mini-secondary w-full">加入攤點通好友</a>}
      </section><div className="flex items-center gap-3"><LogoutButton destination="/mini" /><span className="mini-muted">登出平台會員<br />更換 LINE 帳號後須重新登入。</span></div></>}
  </main>;
}
