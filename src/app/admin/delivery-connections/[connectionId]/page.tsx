import { notFound } from "next/navigation";
import { PlugZap } from "lucide-react";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { AdminDeliveryConnectionActions, AdminDeliveryStoreVerify } from "@/components/admin-delivery-integration-actions";
import { requirePlatformAdminPage } from "@/lib/authorization";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { deliveryProviderLabel } from "@/lib/delivery-platform-labels";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";
import { prisma } from "@/lib/prisma";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import { requireAdminModuleVisible } from "@/server/admin/admin-module-visibility";

type PageProps = { params: Promise<{ connectionId: string }> };

export default async function AdminDeliveryConnectionPage({ params }: PageProps) {
  await requirePlatformAdminPage("/admin/delivery-integrations");
  await requireAdminModuleVisible("delivery");
  const [{ connectionId }, { locale }] = await Promise.all([params, getRequestAppLocale()]);
  const raw = await prisma.deliveryPlatformConnection.findUnique({ where: { id: connectionId }, select: { organizationId: true, stallId: true } });
  if (!raw) notFound();
  const connection = await deliveryPlatformRepository.findScopedConnection(connectionId, raw.organizationId, raw.stallId);
  if (!connection) notFound();
  const [storeMappings, logs] = await Promise.all([
    prisma.externalStoreMapping.findMany({ where: { connectionId }, orderBy: { updatedAt: "desc" }, select: { id: true, externalStoreName: true, externalStoreId: true, mappingStatus: true, verifiedAt: true } }),
    deliveryPlatformRepository.listSafeConnectionLogs(connectionId, raw.organizationId, raw.stallId),
  ]);
  const m = createAdminTranslator(locale);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <ContextualBackButton fallbackHref="/admin/delivery-integrations">{m("Back to delivery integration management")}</ContextualBackButton>
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{deliveryProviderLabel(connection.provider)}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><PlugZap className="h-7 w-7 text-teal-700" />{m("Delivery connection")}</h1><p className="mt-2 text-sm text-stone-600">{getAdminCodeLabel(locale, connection.status)}{connection.externalStoreName ? ` · ${connection.externalStoreName}` : ""}</p></header>
      <section className="py-6"><AdminDeliveryConnectionActions connectionId={connection.id} status={connection.status} /></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Store mappings")}</h2><div className="mt-3 divide-y divide-stone-200">{storeMappings.length ? storeMappings.map((mapping) => <div key={mapping.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-semibold">{mapping.externalStoreName}</p><p className="text-sm text-stone-600">{getAdminCodeLabel(locale, mapping.mappingStatus)} · {mapping.externalStoreId}</p></div>{mapping.mappingStatus !== "VERIFIED" ? <AdminDeliveryStoreVerify connectionId={connection.id} mappingId={mapping.id} /> : null}</div>) : <p className="py-4 text-sm text-stone-600">{m("There are no store mappings.")}</p>}</div></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Recent jobs")}</h2><div className="mt-3 divide-y divide-stone-200">{logs.jobs.slice(0, 20).map((job) => <div key={job.id} className="py-3"><p className="font-semibold">{job.jobType}</p><p className="text-sm text-stone-600">{getAdminCodeLabel(locale, job.status)}{job.lastErrorCode ? ` · ${job.lastErrorCode}` : ""}</p></div>)}</div></section>
    </main>
  );
}
