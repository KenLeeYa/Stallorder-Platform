import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PlugZap } from "lucide-react";
import {
  AdminDeliveryConnectionActions,
  AdminDeliveryStoreVerify,
} from "@/components/admin-delivery-integration-actions";
import { requirePlatformAdminPage } from "@/lib/authorization";
import {
  deliveryConnectionStatusLabels,
  deliveryProviderLabel,
} from "@/lib/delivery-platform-labels";
import { prisma } from "@/lib/prisma";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";

type PageProps = { params: Promise<{ connectionId: string }> };

export default async function AdminDeliveryConnectionPage({ params }: PageProps) {
  await requirePlatformAdminPage("/admin/delivery-integrations");
  const { connectionId } = await params;
  const raw = await prisma.deliveryPlatformConnection.findUnique({
    where: { id: connectionId },
    select: { organizationId: true, stallId: true },
  });
  if (!raw) notFound();
  const connection = await deliveryPlatformRepository.findScopedConnection(connectionId, raw.organizationId, raw.stallId);
  if (!connection) notFound();
  const [storeMappings, logs] = await Promise.all([
    prisma.externalStoreMapping.findMany({
      where: { connectionId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, externalStoreName: true, externalStoreId: true, mappingStatus: true, verifiedAt: true },
    }),
    deliveryPlatformRepository.listSafeConnectionLogs(connectionId, raw.organizationId, raw.stallId),
  ]);
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <Link href="/admin/delivery-integrations" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回外送整合管理</Link>
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{deliveryProviderLabel(connection.provider)}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><PlugZap className="h-7 w-7 text-teal-700" />外送連線</h1><p className="mt-2 text-sm text-stone-600">{deliveryConnectionStatusLabels[connection.status] ?? connection.status}{connection.externalStoreName ? ` · ${connection.externalStoreName}` : ""}</p></header>
      <section className="py-6"><AdminDeliveryConnectionActions connectionId={connection.id} status={connection.status} /></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">門市對應</h2><div className="mt-3 divide-y divide-stone-200">{storeMappings.length ? storeMappings.map((mapping) => <div key={mapping.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-semibold">{mapping.externalStoreName}</p><p className="text-sm text-stone-600">{mapping.mappingStatus} · {mapping.externalStoreId}</p></div>{mapping.mappingStatus !== "VERIFIED" ? <AdminDeliveryStoreVerify connectionId={connection.id} mappingId={mapping.id} /> : null}</div>) : <p className="py-4 text-sm text-stone-600">尚無門市對應。</p>}</div></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">最近工作</h2><div className="mt-3 divide-y divide-stone-200">{logs.jobs.slice(0, 20).map((job) => <div key={job.id} className="py-3"><p className="font-semibold">{job.jobType}</p><p className="text-sm text-stone-600">{job.status}{job.lastErrorCode ? ` · ${job.lastErrorCode}` : ""}</p></div>)}</div></section>
    </main>
  );
}
