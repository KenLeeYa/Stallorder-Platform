import Link from "next/link";
import { Store, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getPagePrincipal } from "@/lib/auth";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { getPlatformMember, hasPlatformIdentity } from "@/server/line-platform/member-service";
import { LineMiniAppLogin } from "@/components/line-miniapp-login";
import { LinePlatformMemberForm } from "@/components/line-platform-member-form";
import { LineMiniAppEntry } from "@/components/line-miniapp-entry";
export const dynamic = "force-dynamic";
export default async function MiniAppPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  let runtime;
  try { runtime = getLinePlatformRuntime(); } catch { runtime = null; }
  if (!runtime) return <main className="mx-auto max-w-lg p-6"><h1 className="text-xl font-semibold">LINE 點餐</h1><p role="status" className="mt-4">店家正在準備 LINE 連線設定，請稍後再試。</p></main>;
  const principal = await getPagePrincipal();
  const member = await getPlatformMember(principal);
  const lineIdentity = await hasPlatformIdentity(principal);
  const stores = await prisma.$queryRaw<Array<{ id: string; name: string; code: string }>>`
    select s.id,s.name,s.code from public.line_platform_stalls p join public.stalls s on s.id=p.stall_id
      where p.environment=${runtime.environment} and p.enabled and s.is_active order by s.name,s.id limit 100`;
  const content = <main className="mx-auto max-w-3xl space-y-6 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
    <div className="mini-hero"><p className="mini-eyebrow">每一餐，都有好照應</p><h1 className="font-bold">今天，想吃點什麼？</h1><p className="mini-muted mt-2">選擇合作店家，開始點餐。</p></div>
    {!lineIdentity ? <LineMiniAppLogin liffId={runtime.liffId} endpointUrl={runtime.endpointUrl} />
      : !member || member.terms_version !== runtime.termsVersion ? <LinePlatformMemberForm termsVersion={runtime.termsVersion} />
        : <p role="status" className="mini-status"><CheckCircle2 aria-hidden="true" />已登入平台會員</p>}
    <div className="mini-section-heading"><h2 className="font-bold">合作店家</h2><span className="mini-muted">{stores.length} 間店家</span></div>
    <div className="grid gap-3 sm:grid-cols-2">{stores.map(store => <Link key={store.id} href={`/mini/store/${encodeURIComponent(store.code)}?view=menu`}
      className="mini-card mini-store"><span className="mini-store-icon"><Store aria-hidden="true" /></span><span><strong>{store.name}</strong><small>查看菜單與店家資訊</small></span><ArrowUpRight aria-hidden="true" /></Link>)}</div>
    {!stores.length && <p role="status">目前尚未開放合作店家，請稍後再試。</p>}
  </main>;
  const query = await searchParams;
  return query && Object.hasOwn(query, "liff.state") ? <LineMiniAppEntry liffId={runtime.liffId}>{content}</LineMiniAppEntry> : content;
}
