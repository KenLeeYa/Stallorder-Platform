import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPagePrincipal } from "@/lib/auth";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { requirePlatformOrderOwner } from "@/server/line-platform/member-service";
import { LineMiniAppLogin } from "@/components/line-miniapp-login";
import { LinePlatformPickupCard } from "@/components/line-platform-pickup-card";
import { LinePlatformOrderRefresh } from "@/components/line-platform-order-refresh";
import { LinePlatformPayButton } from "@/components/line-platform-pay-button";
import { platformOrderStatusLabel, platformPaymentStatusLabel } from "@/lib/line-platform-labels";
export const dynamic = "force-dynamic";
export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const runtime = getLinePlatformRuntime();
  if (!runtime) notFound();
  const principal = await getPagePrincipal();
  if (!principal) return <main className="mx-auto max-w-lg space-y-4 p-4"><h1 className="text-2xl font-bold">查看本人訂單</h1><LineMiniAppLogin liffId={runtime.liffId} endpointUrl={runtime.endpointUrl} /></main>;
  const { orderId } = await params;
  try { await requirePlatformOrderOwner(principal, orderId); } catch { notFound(); }
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { stall: { select: { name: true, code: true, location: true } }, items: true } });
  if (!order) notFound();
  const [capability] = await prisma.$queryRaw<Array<{ pickup_required: boolean; has_payment: boolean }>>`
    select (own.pickup_required or exists(select 1 from public.line_platform_pickup_credentials c
      where c.order_id=own.order_id and c.environment=own.environment)) as pickup_required,
    exists(select 1 from public.line_platform_payment_attempts a
      where a.order_id=own.order_id and a.environment=own.environment) as has_payment
    from public.line_platform_order_owners own where own.order_id=${order.id}::uuid`;
  const pickedUp = await prisma.orderEvent.findFirst({ where: { orderId, eventType: "LINE_PLATFORM_PICKED_UP" }, select: { createdAt: true } });
  const expected = order.committedFulfillmentAt ?? order.requestedFulfillmentAt ?? order.scheduledPickupAt ?? order.quotedReadyAt;
  const active = !["COMPLETED","CANCELLED","EXPIRED"].includes(order.status);
  const allowNewPayment = runtime.payEnabled && active && order.paymentStatus === "UNPAID";
  return <main className="mx-auto max-w-lg space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
    <h1 className="break-words text-2xl font-bold">{order.stall.name}</h1><p>訂單 {order.orderNo}</p>
    <LinePlatformOrderRefresh active={!["COMPLETED","CANCELLED","EXPIRED"].includes(order.status)} />
    <section className="space-y-3 rounded-xl border p-4"><strong className="text-xl">{pickedUp ? "已完成取餐" : platformOrderStatusLabel(order.status)}</strong>
      <p>{platformPaymentStatusLabel(order.paymentStatus)}・<strong>NT$ {order.total.toLocaleString("zh-TW")}</strong></p>
      <p>取餐號碼：{order.pickupCodeDisplay ?? order.orderNo}</p>
      {expected && <p>預約／預估時間：{expected.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>}
      {pickedUp && <p>交付時間：{pickedUp.createdAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>}
      <p>{order.stall.location}</p>
    </section>
    <ul className="divide-y rounded-xl border px-4">{order.items.map(item => <li key={item.id} className="flex justify-between gap-4 py-3"><span className="break-words">{item.quantity} × {item.name}</span><span className="shrink-0">NT$ {item.quantity * item.unitPrice}</span></li>)}</ul>
    {capability?.pickup_required && !pickedUp && active && <LinePlatformPickupCard orderId={order.id} />}
    {(capability?.has_payment || allowNewPayment) && <LinePlatformPayButton orderId={order.id} amount={order.total} orderVersion={order.updatedAt.toISOString()} allowNewPayment={allowNewPayment} />}
    <Link href={`/mini/store/${encodeURIComponent(order.stall.code)}?view=menu`} className="inline-flex min-h-11 items-center underline">查看本店資訊</Link>
    <p className="text-sm">以本頁最新狀態為準。付款完成不代表餐點已做好；請待餐點完成後，由店員確認交付。</p>
  </main>;
}
