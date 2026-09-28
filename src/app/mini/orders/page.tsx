import Link from "next/link";
import { ReceiptText, ArrowRight } from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPagePrincipal } from "@/lib/auth";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { getPlatformMember, hasPlatformIdentity, listPlatformOrders } from "@/server/line-platform/member-service";
import { LineMiniAppLogin } from "@/components/line-miniapp-login";
import { platformOrderStatusLabel } from "@/lib/line-platform-labels";
export const dynamic = "force-dynamic";
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ view?: string; stall?: string; page?: string }> }) {
  const runtime = getLinePlatformRuntime();
  if (!runtime) notFound();
  const principal = await getPagePrincipal();
  const member = await getPlatformMember(principal);
  const lineIdentity = await hasPlatformIdentity(principal);
  if (!member || !principal) return <main className="mx-auto max-w-lg space-y-4 p-4"><h1 className="text-2xl font-bold">我的訂單</h1>
    <div className="mini-card mini-empty"><ReceiptText aria-hidden="true" /><p className="font-semibold">每一筆訂單，都在這裡</p><p className="mini-muted">登入後查看餐點進度，出示取餐 QR。</p>
    {lineIdentity ? <Link href="/mini/member" className="mini-primary">請先完成平台入會</Link>
      : <LineMiniAppLogin liffId={runtime.liffId} endpointUrl={runtime.endpointUrl} />}</div></main>;
  const query = await searchParams;
  const history = query.view === "history";
  const page = Math.max(1, Math.min(1000, Number.parseInt(query.page ?? "1", 10) || 1));
  const stall = /^[0-9a-f-]{36}$/i.test(query.stall ?? "") ? query.stall! : null;
  const stores = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    select distinct s.id,s.name from public.line_platform_order_owners own join public.orders o on o.id=own.order_id
      join public.stalls s on s.id=o.stall_id where own.profile_id=${member.profile_id}::uuid and own.environment=${runtime.environment}`;
  const orders = await listPlatformOrders(principal, { history, page, stallId: stall });
  return <main className="mx-auto max-w-3xl space-y-4 p-4"><h1 className="text-2xl font-bold">我的訂單</h1>
    <form className="mini-card flex flex-wrap gap-3 text-sm"><label className="flex min-w-0 flex-1 flex-col gap-1">訂單狀態<select name="view" defaultValue={history ? "history" : "active"} className="min-h-11 max-w-full rounded-lg border bg-transparent px-3"><option value="active">進行中</option><option value="history">歷史訂單</option></select></label>
      <label className="flex min-w-0 flex-1 flex-col gap-1">店家<select name="stall" defaultValue={stall ?? ""} className="min-h-11 max-w-full rounded-lg border bg-transparent px-3"><option value="">全部店家</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <button type="submit" className="mini-secondary self-end">查詢</button></form>
    {orders.slice(0,20).map(o => <Link key={o.id} href={`/mini/orders/${o.id}`} className="mini-card mini-order-card space-y-3">
      <div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{o.store_name}</strong><span className="mini-status">{platformOrderStatusLabel(o.status)}</span></div>
      <div className="flex flex-wrap justify-between gap-2"><span>訂單 {o.order_no}</span><strong>NT$ {o.total.toLocaleString("zh-TW")}</strong></div>
      <p className="mini-muted">{o.created_at.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p><div className="mini-order-card-footer text-sm"><span>查看訂單／取餐碼</span><ArrowRight aria-hidden="true" /></div></Link>)}
    {!orders.length && <div className="mini-card mini-empty"><ReceiptText aria-hidden="true" /><p role="status">目前沒有符合條件的訂單。</p><Link href="/mini" className="mini-primary">探索合作店家</Link></div>}
    <div className="flex justify-between gap-3">{page>1 && <Link className="inline-flex min-h-11 items-center underline" href={`?view=${history ? "history" : "active"}&stall=${stall ?? ""}&page=${page-1}`}>上一頁</Link>}
      {orders.length>20 && <Link className="inline-flex min-h-11 items-center underline" href={`?view=${history ? "history" : "active"}&stall=${stall ?? ""}&page=${page+1}`}>下一頁</Link>}</div>
  </main>;
}
