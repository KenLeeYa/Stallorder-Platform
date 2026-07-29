import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
import {
  deliveryProcessingStatusLabels,
  deliveryProviderLabel,
} from "@/lib/delivery-platform-labels";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import { requireMerchantDeliveryPage } from "@/server/delivery-platforms/delivery-page";

type PageProps = {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ stallId?: string }>;
};

export default async function DeliveryOrdersPage({ params, searchParams }: PageProps) {
  const [{ connectionId }, { stallId }] = await Promise.all([params, searchParams]);
  const scope = await requireMerchantDeliveryPage({
    stallId,
    returnPath: `/merchant/integrations/delivery/${connectionId}/orders`,
  });
  if (!scope.access.allowed) notFound();
  const connection = await deliveryPlatformRepository.findScopedConnection(connectionId, scope.workspace.id, scope.stall.id);
  if (!connection) notFound();
  const orders = await deliveryPlatformRepository.listExternalOrders(connectionId, scope.workspace.id, scope.stall.id);
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <Link href={`/merchant/integrations/delivery/${connectionId}?stallId=${scope.stall.id}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回連線設定</Link>
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{deliveryProviderLabel(connection.provider)}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><ClipboardList className="h-7 w-7 text-teal-700" />外送訂單</h1></header>
      <div className="divide-y divide-stone-200 py-4">{orders.length ? orders.map((order) => <article key={order.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto]"><div><p className="font-semibold">{order.externalOrderNumber ?? "未提供外部訂單編號"}</p><p className="mt-1 text-sm text-stone-600">{deliveryProcessingStatusLabels[order.processingStatus] ?? order.processingStatus} · {order.receivedViaCircuit}</p><dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-4"><MoneyTerm label="顧客總額" value={order.externalTotalAmount} currency={order.currency} /><MoneyTerm label="平台折扣" value={order.platformDiscountAmount} currency={order.currency} /><MoneyTerm label="商家折扣" value={order.merchantDiscountAmount} currency={order.currency} /><MoneyTerm label="商家應收" value={order.merchantReceivableAmount} currency={order.currency} /></dl></div><time className="text-sm text-stone-500">{formatDate(order.receivedAt)}</time></article>) : <p className="py-5 text-sm text-stone-600">尚無外送訂單。</p>}</div>
    </main>
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(date);
}

function MoneyTerm({ label, value, currency }: { label: string; value: number | null; currency: string }) {
  return <div><dt className="text-xs text-stone-500">{label}</dt><dd className="mt-0.5 font-semibold">{new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: 0 }).format(value ?? 0)}</dd></div>;
}
