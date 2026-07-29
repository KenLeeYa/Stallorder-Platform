import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Store } from "lucide-react";
import { DeliveryStoreSelector } from "@/components/delivery-store-selector";
import { prisma } from "@/lib/prisma";
import { deliveryProviderLabel } from "@/lib/delivery-platform-labels";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import { requireMerchantDeliveryPage } from "@/server/delivery-platforms/delivery-page";

type PageProps = {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ stallId?: string }>;
};

export default async function DeliveryStoresPage({ params, searchParams }: PageProps) {
  const [{ connectionId }, { stallId }] = await Promise.all([params, searchParams]);
  const scope = await requireMerchantDeliveryPage({
    stallId,
    returnPath: `/merchant/integrations/delivery/${connectionId}/stores`,
  });
  if (!scope.access.allowed) notFound();
  const connection = await deliveryPlatformRepository.findScopedConnection(
    connectionId,
    scope.workspace.id,
    scope.stall.id,
  );
  if (!connection) notFound();
  const mappings = await prisma.externalStoreMapping.findMany({
    where: {
      organizationId: scope.workspace.id,
      stallId: scope.stall.id,
      connectionId,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      externalStoreName: true,
      externalStoreId: true,
      mappingStatus: true,
      verifiedAt: true,
    },
  });
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-7 md:px-8">
      <BackLink connectionId={connectionId} stallId={scope.stall.id} />
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{deliveryProviderLabel(connection.provider)}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><Store className="h-7 w-7 text-teal-700" />外送門市對應</h1><p className="mt-2 text-sm text-stone-600">外送平台門市必須由平台管理員驗證後才能接收訂單。</p></header>
      <section className="py-7"><DeliveryStoreSelector connectionId={connectionId} stallId={scope.stall.id} /></section>
      <section className="border-t border-stone-200 py-7"><h2 className="text-xl font-semibold">已選門市</h2><div className="mt-3 divide-y divide-stone-200">{mappings.length ? mappings.map((mapping) => <div key={mapping.id} className="grid gap-1 py-4 sm:grid-cols-[1fr_auto]"><div><p className="font-semibold">{mapping.externalStoreName}</p><p className="text-xs text-stone-500">識別碼：{mapping.externalStoreId}</p></div><p className="text-sm font-semibold text-stone-700">{mapping.mappingStatus === "VERIFIED" ? "已驗證" : "等待驗證"}</p></div>) : <p className="py-4 text-sm text-stone-600">尚未選取外送門市。</p>}</div></section>
    </main>
  );
}

function BackLink({ connectionId, stallId }: { connectionId: string; stallId: string }) {
  return <Link href={`/merchant/integrations/delivery/${connectionId}?stallId=${stallId}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回連線設定</Link>;
}
