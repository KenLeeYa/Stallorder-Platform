import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Link2 } from "lucide-react";
import { DeliveryMenuMappingForm } from "@/components/delivery-menu-mapping-form";
import { prisma } from "@/lib/prisma";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import { requireMerchantDeliveryPage } from "@/server/delivery-platforms/delivery-page";
import { listExternalMenuMappings } from "@/server/delivery-platforms/menu-mapping-service";

type PageProps = {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ stallId?: string }>;
};

export default async function DeliveryMenuMappingPage({ params, searchParams }: PageProps) {
  const { m } = await getRequestMerchantMessages();
  const [{ connectionId }, { stallId }] = await Promise.all([params, searchParams]);
  const scope = await requireMerchantDeliveryPage({
    stallId,
    returnPath: `/merchant/integrations/delivery/${connectionId}/menu-mapping`,
  });
  if (!scope.access.allowed) notFound();
  const connection = await deliveryPlatformRepository.findScopedConnection(
    connectionId,
    scope.workspace.id,
    scope.stall.id,
  );
  if (!connection) notFound();
  const [mappings, categories, products, noteGroups] = await Promise.all([
    listExternalMenuMappings(connectionId),
    prisma.productCategory.findMany({
      where: { organizationId: scope.workspace.id, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: {
        organizationId: scope.workspace.id,
        isActive: true,
        stallProducts: { some: { stallId: scope.stall.id } },
      },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.productNoteGroup.findMany({
      where: { organizationId: scope.workspace.id, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        options: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true },
        },
      },
    }),
  ]);
  const entities = [
    ...categories.map((item) => ({ id: item.id, type: "CATEGORY" as const, label: item.name })),
    ...products.map((item) => ({ id: item.id, type: "PRODUCT" as const, label: item.name })),
    ...noteGroups.map((item) => ({ id: item.id, type: "MODIFIER_GROUP" as const, label: item.name })),
    ...noteGroups.flatMap((group) => group.options.map((item) => ({
      id: item.id,
      type: "MODIFIER_ITEM" as const,
      label: `${group.name} · ${item.name}`,
    }))),
  ];
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <Link href={`/merchant/integrations/delivery/${connectionId}?stallId=${scope.stall.id}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />{m("返回連線設定")}</Link>
      <header className="mt-4 border-b border-stone-200 pb-5"><h1 className="flex items-center gap-3 text-3xl font-semibold"><Link2 className="h-7 w-7 text-teal-700" />{m("商品與註記對應")}</h1><p className="mt-2 text-sm text-stone-600">{m("缺少對應時訂單會停止匯入並顯示營運警示，不會建立不完整訂單。")}</p></header>
      <section className="py-7"><h2 className="text-xl font-semibold">{m("新增或修改對應")}</h2><DeliveryMenuMappingForm connectionId={connectionId} stallId={scope.stall.id} entities={entities} /></section>
      <section className="border-t border-stone-200 py-7"><h2 className="text-xl font-semibold">{m("目前對應")}</h2><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b border-stone-300"><th className="px-2 py-3">{m("類型")}</th><th className="px-2 py-3">StallOrder ID</th><th className="px-2 py-3">{m("外送平台 ID")}</th><th className="px-2 py-3">{m("狀態")}</th></tr></thead><tbody>{mappings.map((mapping) => <tr key={mapping.id} className="border-b border-stone-200"><td className="px-2 py-3">{mapping.internalEntityType}</td><td className="px-2 py-3 font-mono text-xs">{mapping.internalEntityId}</td><td className="px-2 py-3 font-mono text-xs">{mapping.externalEntityId}</td><td className="px-2 py-3">{mapping.mappingStatus}</td></tr>)}</tbody></table>{mappings.length === 0 ? <p className="py-4 text-sm text-stone-600">{m("尚未建立對應。")}</p> : null}</div></section>
    </main>
  );
}
