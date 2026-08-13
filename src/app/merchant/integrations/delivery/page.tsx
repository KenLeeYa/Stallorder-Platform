import Link from "next/link";
import { ArrowLeft, ChevronRight, Truck } from "lucide-react";
import { DeliveryConnectionRequestForm } from "@/components/delivery-connection-request-form";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import {
  deliveryConnectionStatusLabels,
  deliveryProviderLabel,
  deliveryRequestStatusLabels,
} from "@/lib/delivery-platform-labels";
import { formatAppDateTime } from "@/lib/locale-format";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { getMerchantDeliveryIntegrationData } from "@/server/delivery-platforms/connection-service";
import { requireMerchantDeliveryPage } from "@/server/delivery-platforms/delivery-page";

type PageProps = { searchParams: Promise<{ stallId?: string }> };

export default async function MerchantDeliveryIntegrationsPage({ searchParams }: PageProps) {
  const { locale, m, label } = await getRequestMerchantMessages();
  const { stallId } = await searchParams;
  const scope = await requireMerchantDeliveryPage({
    stallId,
    returnPath: "/merchant/integrations/delivery",
  });
  if (!scope.access.allowed) {
    return <FeatureUpgradeNotice title={m("外送平台整合尚未開放")} message={scope.access.message} billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`} returnHref={`/merchant/stalls/${scope.stall.id}`} returnLabel={m("返回攤位設定")} />;
  }
  const data = await getMerchantDeliveryIntegrationData(
    scope.workspace.id,
    [scope.stall.id],
  );
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <Link href={`/merchant/stalls/${scope.stall.id}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />{m("返回攤位設定")}</Link>
      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{scope.workspace.businessName} · {scope.stall.name}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><Truck className="h-7 w-7 text-teal-700" />{m("外送平台整合")}</h1>
        <p className="mt-2 text-sm text-stone-600">{m("管理外送平台申請、門市對應、商品對應與訂單匯入狀態。")}</p>
      </header>

      <section className="py-7">
        <h2 className="text-xl font-semibold">{m("連線狀態")}</h2>
        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
          {data.connections.length ? data.connections.map((connection) => (
            <Link key={connection.id} href={`/merchant/integrations/delivery/${connection.id}?stallId=${scope.stall.id}`} className="flex min-h-20 items-center gap-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{deliveryProviderLabel(connection.provider)}</p>
                <p className="mt-1 text-sm text-stone-600">{label(deliveryConnectionStatusLabels[connection.status] ?? connection.status)}{connection.externalStoreName ? ` · ${connection.externalStoreName}` : ""}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-stone-400" />
            </Link>
          )) : <p className="py-5 text-sm text-stone-600">{m("目前尚未建立外送平台連線。")}</p>}
        </div>
      </section>

      <section className="border-t border-stone-200 py-7">
        <h2 className="text-xl font-semibold">{m("申請紀錄")}</h2>
        <div className="mt-4 divide-y divide-stone-200">
          {data.requests.length ? data.requests.map((request) => (
            <div key={request.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div><p className="font-semibold">{deliveryProviderLabel(request.provider)}</p><p className="text-sm text-stone-600">{label(deliveryRequestStatusLabels[request.status] ?? request.status)}</p></div>
              <time className="text-sm text-stone-500">{formatAppDateTime(locale, request.submittedAt ?? request.createdAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</time>
            </div>
          )) : <p className="py-4 text-sm text-stone-600">{m("尚無申請紀錄。")}</p>}
        </div>
      </section>

      <section className="border-t border-stone-200 py-7">
        <h2 className="text-xl font-semibold">{m("申請外送平台連線")}</h2>
        <p className="mt-2 text-sm text-stone-600">{m("送出申請不代表已啟用；仍需完成平台合作資格、門市對應與測試驗證。")}</p>
        <DeliveryConnectionRequestForm stallId={scope.stall.id} />
      </section>
    </main>
  );
}
