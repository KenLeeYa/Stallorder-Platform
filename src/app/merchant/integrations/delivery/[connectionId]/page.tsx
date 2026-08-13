import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, ClipboardList, Link2, ScrollText, Store, Truck } from "lucide-react";
import { DeliveryConnectionActions } from "@/components/delivery-connection-actions";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import {
  deliveryConnectionStatusLabels,
  deliveryProviderLabel,
} from "@/lib/delivery-platform-labels";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import { requireMerchantDeliveryPage } from "@/server/delivery-platforms/delivery-page";

type PageProps = {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ stallId?: string }>;
};

export default async function MerchantDeliveryConnectionPage({ params, searchParams }: PageProps) {
  const { m, label } = await getRequestMerchantMessages();
  const [{ connectionId }, { stallId }] = await Promise.all([params, searchParams]);
  const scope = await requireMerchantDeliveryPage({
    stallId,
    returnPath: `/merchant/integrations/delivery/${connectionId}`,
  });
  if (!scope.access.allowed) {
    return <FeatureUpgradeNotice title={m("外送平台整合尚未開放")} message={scope.access.message} billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`} returnHref={`/merchant/stalls/${scope.stall.id}`} returnLabel={m("返回攤位設定")} />;
  }
  const connection = await deliveryPlatformRepository.findScopedConnection(
    connectionId,
    scope.workspace.id,
    scope.stall.id,
  );
  if (!connection) notFound();
  const links = [
    { href: "stores", label: m("外送門市對應"), icon: Store },
    { href: "menu-mapping", label: m("商品與註記對應"), icon: Link2 },
    { href: "orders", label: m("外送訂單"), icon: ClipboardList },
    { href: "logs", label: m("處理紀錄"), icon: ScrollText },
  ];
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-7 md:px-8">
      <Link href={`/merchant/integrations/delivery?stallId=${scope.stall.id}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />{m("返回外送平台整合")}</Link>
      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{scope.stall.name}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><Truck className="h-7 w-7 text-teal-700" />{deliveryProviderLabel(connection.provider)}</h1>
        <p className="mt-2 text-sm text-stone-600">{m("狀態：{status}", { status: label(deliveryConnectionStatusLabels[connection.status] ?? connection.status) })}{connection.externalStoreName ? ` · ${connection.externalStoreName}` : ""}</p>
      </header>
      <div className="divide-y divide-stone-200 py-4">
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={`/merchant/integrations/delivery/${connection.id}/${href}?stallId=${scope.stall.id}`} className="flex min-h-16 items-center gap-3 py-3"><Icon className="h-5 w-5 text-teal-700" /><span className="flex-1 font-semibold">{label}</span><ChevronRight className="h-5 w-5 text-stone-400" /></Link>)}
      </div>
      <section className="border-t border-stone-200 py-6">
        <h2 className="mb-3 text-lg font-semibold">{m("緊急控制")}</h2>
        <DeliveryConnectionActions connectionId={connection.id} stallId={scope.stall.id} canPause={["ACTIVE", "TESTING"].includes(connection.status)} canDisconnect={!["DISCONNECTED", "REJECTED"].includes(connection.status)} />
      </section>
    </main>
  );
}
