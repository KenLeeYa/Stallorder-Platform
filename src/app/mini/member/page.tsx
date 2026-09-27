import { notFound } from "next/navigation";
import { getPagePrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { getPlatformMember, hasPlatformIdentity } from "@/server/line-platform/member-service";
import { LineMiniAppLogin } from "@/components/line-miniapp-login";
import { LinePlatformMemberForm } from "@/components/line-platform-member-form";
import { LogoutButton } from "@/components/logout-button";
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
      <p>LINE 身分已登入{member ? "，平台會員已建立。" : "，請閱讀條款後加入平台會員。"}</p>
      <LinePlatformMemberForm termsVersion={runtime.termsVersion} enrolled={Boolean(member && member.terms_version === runtime.termsVersion)} initialConsent={member?.notification_consent} />
      <section className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">攤點通官方帳號</h2>
        <p>{status === "FRIEND" ? "已確認好友狀態" : status === "NOT_FRIEND_OR_BLOCKED" ? "尚未加入好友或已封鎖" : "尚未確認好友狀態"}</p>
        <p>若沒有收到 LINE 通知，仍可從「我的訂單」查看進度及出示取餐碼。</p>
        {runtime.addFriendUrl && <a href={runtime.addFriendUrl} className="inline-flex min-h-11 items-center rounded-lg border px-4 font-semibold">加入攤點通好友</a>}
      </section><div className="flex items-center gap-3"><LogoutButton destination="/mini" /><span>登出平台會員；更換 LINE 帳號後須重新登入。</span></div></>}
  </main>;
}
