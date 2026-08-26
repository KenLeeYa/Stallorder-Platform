import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { formatAppDateTime } from "@/lib/locale-format";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import { requireMerchantDeliveryPage } from "@/server/delivery-platforms/delivery-page";

type PageProps = {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ stallId?: string }>;
};

export default async function DeliveryLogsPage({ params, searchParams }: PageProps) {
  const { locale, m } = await getRequestMerchantMessages();
  const [{ connectionId }, { stallId }] = await Promise.all([params, searchParams]);
  const scope = await requireMerchantDeliveryPage({
    stallId,
    returnPath: `/merchant/integrations/delivery/${connectionId}/logs`,
  });
  if (!scope.access.allowed) notFound();
  const connection = await deliveryPlatformRepository.findScopedConnection(connectionId, scope.workspace.id, scope.stall.id);
  if (!connection) notFound();
  const logs = await deliveryPlatformRepository.listSafeConnectionLogs(connectionId, scope.workspace.id, scope.stall.id);
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <ContextualBackButton fallbackHref={`/merchant/integrations/delivery/${connectionId}?stallId=${scope.stall.id}`}>{m("返回連線設定")}</ContextualBackButton>
      <header className="mt-4 border-b border-stone-200 pb-5"><h1 className="flex items-center gap-3 text-3xl font-semibold"><ScrollText className="h-7 w-7 text-teal-700" />{m("處理紀錄")}</h1><p className="mt-2 text-sm text-stone-600">{m("僅顯示安全狀態與錯誤代碼，不顯示原始 webhook 或憑證。")}</p></header>
      <section className="py-7"><h2 className="text-xl font-semibold">{m("同步工作")}</h2><div className="mt-3 divide-y divide-stone-200">{logs.jobs.length ? logs.jobs.map((job) => <div key={job.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]"><div><p className="font-semibold">{job.jobType}</p><p className="text-sm text-stone-600">{job.status}{job.lastErrorCode ? ` · ${job.lastErrorCode}` : ""} · {m("嘗試 {count}/{max}", { count: job.attemptCount, max: job.maxAttempts })} · {job.requestedViaCircuit}</p></div><time className="text-sm text-stone-500">{formatAppDateTime(locale, job.createdAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</time></div>) : <p className="py-4 text-sm text-stone-600">{m("尚無同步工作。")}</p>}</div></section>
      <section className="border-t border-stone-200 py-7"><h2 className="text-xl font-semibold">Webhook</h2><div className="mt-3 divide-y divide-stone-200">{logs.webhooks.length ? logs.webhooks.map((event) => <div key={event.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]"><div><p className="font-semibold">{event.eventType}</p><p className="text-sm text-stone-600">{event.processingStatus}{event.lastErrorCode ? ` · ${event.lastErrorCode}` : ""} · {event.receivedViaCircuit}</p></div><time className="text-sm text-stone-500">{formatAppDateTime(locale, event.receivedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</time></div>) : <p className="py-4 text-sm text-stone-600">{m("尚無 Webhook 紀錄。")}</p>}</div></section>
    </main>
  );
}
