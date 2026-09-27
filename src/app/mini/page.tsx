import Link from "next/link";
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
    <h1 className="text-2xl font-bold">攤點通・合作店家</h1>
    {!lineIdentity ? <LineMiniAppLogin liffId={runtime.liffId} endpointUrl={runtime.endpointUrl} />
      : !member || member.terms_version !== runtime.termsVersion ? <LinePlatformMemberForm termsVersion={runtime.termsVersion} />
        : <p role="status">已登入平台會員。訂單與取餐通知由攤點通官方帳號提供。</p>}
    <div className="grid gap-3 sm:grid-cols-2">{stores.map(store => <Link key={store.id} href={`/mini/store/${encodeURIComponent(store.code)}?view=menu`}
      className="flex min-h-20 items-center justify-between gap-4 rounded-xl border border-stone-300 p-4 font-semibold"><span className="break-words">{store.name}</span><span aria-hidden>→</span></Link>)}</div>
    {!stores.length && <p role="status">目前尚未開放合作店家，請稍後再試。</p>}
  </main>;
  const query = await searchParams;
  return query && Object.hasOwn(query, "liff.state") ? <LineMiniAppEntry liffId={runtime.liffId}>{content}</LineMiniAppEntry> : content;
}
