import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
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
  const [capability] = await prisma.$queryRaw<Array<{ pickup_required: boolean; has_payment: boolean; payment_configured: boolean }>>`
    select (own.pickup_required or exists(select 1 from public.line_platform_pickup_credentials c
      where c.order_id=own.order_id and c.environment=own.environment)) as pickup_required,
    exists(select 1 from public.line_platform_payment_attempts a
      where a.order_id=own.order_id and a.environment=own.environment) as has_payment,
    exists(select 1 from public.payment_provider_connections c
      where c.organization_id=${order.organizationId}::uuid and c.stall_id=${order.stallId}::uuid
        and c.provider='LINE_PAY' and c.environment='SANDBOX' and c.status='ACTIVE'
        and 'PUBLIC_MENU'=any(c.enabled_channels) and nullif(c.secret_reference,'') is not null
        and nullif(c.merchant_reference,'') is not null and c.capabilities->>'apiVersion'='v4'
        and jsonb_typeof(c.capabilities->'credentialVersion')='string') as payment_configured
    from public.line_platform_order_owners own where own.order_id=${order.id}::uuid`;
  const pickedUp = await prisma.orderEvent.findFirst({ where: { orderId, eventType: "LINE_PLATFORM_PICKED_UP" }, select: { createdAt: true } });
  const expected = order.committedFulfillmentAt ?? order.requestedFulfillmentAt ?? order.scheduledPickupAt ?? order.quotedReadyAt;
  const active = !["COMPLETED","CANCELLED","EXPIRED"].includes(order.status);
  const allowNewPayment = runtime.payEnabled && capability?.payment_configured === true && active && order.paymentStatus === "UNPAID";
  return <main className="mx-auto max-w-lg space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
    <Link href="/mini/orders" className="mini-secondary text-sm"><ArrowLeft className="size-4" aria-hidden="true" />我的訂單</Link>
    <h1 className="break-words text-2xl font-bold">{order.stall.name}</h1><p className="mini-muted">訂單 {order.orderNo}</p>
    <LinePlatformOrderRefresh active={!["COMPLETED","CANCELLED","EXPIRED"].includes(order.status)} />
    <section className="mini-hero space-y-4"><strong className="text-xl">{pickedUp ? "已完成取餐" : platformOrderStatusLabel(order.status)}</strong>
      <div><p className="mini-muted">取餐號碼</p><p className="mini-pickup-number">{order.pickupCodeDisplay ?? order.orderNo}</p></div>
      <dl className="mini-detail-rows"><div><dt>訂單金額</dt><dd>NT$ {order.total.toLocaleString("zh-TW")} · {platformPaymentStatusLabel(order.paymentStatus)}</dd></div>
      {expected && <div><dt>預約／預估時間</dt><dd>{expected.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</dd></div>}
      {pickedUp && <div><dt>交付時間</dt><dd>{pickedUp.createdAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</dd></div>}</dl>
      {order.stall.location && <p className="mini-muted flex items-start gap-2"><MapPin className="mt-1 size-4 shrink-0" aria-hidden="true" />{order.stall.location}</p>}
    </section>
    {capability?.pickup_required && !pickedUp && active && order.paymentStatus !== "REFUNDED" && <LinePlatformPickupCard orderId={order.id} />}
    <section className="mini-card"><h2 className="mb-2 font-semibold">餐點明細</h2><ul className="divide-y">{order.items.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-3"><span className="min-w-0 flex-1">{item.quantity} × {item.name}</span><span className="shrink-0">NT$ {item.quantity * item.unitPrice}</span></li>)}</ul></section>
    {(capability?.has_payment || allowNewPayment) && <LinePlatformPayButton orderId={order.id} amount={order.total} orderVersion={order.updatedAt.toISOString()} allowNewPayment={allowNewPayment} />}
    <Link href={`/mini/store/${encodeURIComponent(order.stall.code)}?view=menu`} className="mini-secondary w-full">查看本店資訊</Link>
    <p className="mini-muted">以本頁最新狀態為準。付款完成不代表餐點已做好；請待餐點完成後，由店員確認交付。</p>
  </main>;
}
