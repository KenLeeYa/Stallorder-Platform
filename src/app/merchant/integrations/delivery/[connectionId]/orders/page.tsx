import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { ContextualBackButton } from "@/components/contextual-back-button";
import {
  deliveryProcessingStatusLabels,
  deliveryProviderLabel,
} from "@/lib/delivery-platform-labels";
import { formatAppCurrency, formatAppDateTime } from "@/lib/locale-format";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import { requireMerchantDeliveryPage } from "@/server/delivery-platforms/delivery-page";

type PageProps = {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ stallId?: string }>;
};

export default async function DeliveryOrdersPage({ params, searchParams }: PageProps) {
  const { locale, m, label } = await getRequestMerchantMessages();
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
      <ContextualBackButton fallbackHref={`/merchant/integrations/delivery/${connectionId}?stallId=${scope.stall.id}`}>{m("返回連線設定")}</ContextualBackButton>
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{deliveryProviderLabel(connection.provider)}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><ClipboardList className="h-7 w-7 text-teal-700" />{m("外送訂單")}</h1></header>
      <div className="divide-y divide-stone-200 py-4">{orders.length ? orders.map((order) => <article key={order.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto]"><div><p className="font-semibold">{order.externalOrderNumber ?? m("未提供外部訂單編號")}</p><p className="mt-1 text-sm text-stone-600">{label(deliveryProcessingStatusLabels[order.processingStatus] ?? order.processingStatus)} · {order.receivedViaCircuit}</p><dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-4"><MoneyTerm label={m("顧客總額")} value={order.externalTotalAmount} currency={order.currency} locale={locale} /><MoneyTerm label={m("平台折扣")} value={order.platformDiscountAmount} currency={order.currency} locale={locale} /><MoneyTerm label={m("商家折扣")} value={order.merchantDiscountAmount} currency={order.currency} locale={locale} /><MoneyTerm label={m("商家應收")} value={order.merchantReceivableAmount} currency={order.currency} locale={locale} /></dl></div><time className="text-sm text-stone-500">{formatAppDateTime(locale, order.receivedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</time></article>) : <p className="py-5 text-sm text-stone-600">{m("尚無外送訂單。")}</p>}</div>
    </main>
  );
}

function MoneyTerm({ label, value, currency, locale }: { label: string; value: number | null; currency: string; locale: Parameters<typeof formatAppCurrency>[0] }) {
  return <div><dt className="text-xs text-stone-500">{label}</dt><dd className="mt-0.5 font-semibold">{formatAppCurrency(locale, value ?? 0, currency, { maximumFractionDigits: 0 })}</dd></div>;
}
