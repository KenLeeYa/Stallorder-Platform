import { notFound } from "next/navigation";
import { CircleUserRound } from "lucide-react";
import { getPagePrincipal } from "@/lib/auth";
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
  return <main className="mx-auto max-w-lg space-y-5 p-4"><h1 className="text-2xl font-bold">平台會員中心</h1>
    {!lineIdentity ? <LineMiniAppLogin liffId={runtime.liffId} endpointUrl={runtime.endpointUrl} /> : <>
      <div className="mini-hero mini-member-hero"><span className="mini-store-icon"><CircleUserRound aria-hidden="true" /></span><div><p className="font-semibold">{member ? "歡迎回到攤點通" : "歡迎加入攤點通"}</p><p className="mini-muted">LINE 身分已登入{member ? "，平台會員已建立。" : "，請閱讀條款後加入平台會員。"}</p></div></div>
      <LinePlatformMemberForm termsVersion={runtime.termsVersion} enrolled={Boolean(member && member.terms_version === runtime.termsVersion)} />
      <div className="flex items-center gap-3"><LogoutButton destination="/mini" /><span className="mini-muted">登出平台會員<br />更換 LINE 帳號後須重新登入。</span></div></>}
  </main>;
}
