import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ScrollText } from "lucide-react";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import { requireMerchantDeliveryPage } from "@/server/delivery-platforms/delivery-page";

type PageProps = {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ stallId?: string }>;
};

export default async function DeliveryLogsPage({ params, searchParams }: PageProps) {
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
      <Link href={`/merchant/integrations/delivery/${connectionId}?stallId=${scope.stall.id}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回連線設定</Link>
      <header className="mt-4 border-b border-stone-200 pb-5"><h1 className="flex items-center gap-3 text-3xl font-semibold"><ScrollText className="h-7 w-7 text-teal-700" />處理紀錄</h1><p className="mt-2 text-sm text-stone-600">僅顯示安全狀態與錯誤代碼，不顯示原始 webhook 或憑證。</p></header>
      <section className="py-7"><h2 className="text-xl font-semibold">同步工作</h2><div className="mt-3 divide-y divide-stone-200">{logs.jobs.length ? logs.jobs.map((job) => <div key={job.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]"><div><p className="font-semibold">{job.jobType}</p><p className="text-sm text-stone-600">{job.status}{job.lastErrorCode ? ` · ${job.lastErrorCode}` : ""} · 嘗試 {job.attemptCount}/{job.maxAttempts} · {job.requestedViaCircuit}</p></div><time className="text-sm text-stone-500">{formatDate(job.createdAt)}</time></div>) : <p className="py-4 text-sm text-stone-600">尚無同步工作。</p>}</div></section>
      <section className="border-t border-stone-200 py-7"><h2 className="text-xl font-semibold">Webhook</h2><div className="mt-3 divide-y divide-stone-200">{logs.webhooks.length ? logs.webhooks.map((event) => <div key={event.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]"><div><p className="font-semibold">{event.eventType}</p><p className="text-sm text-stone-600">{event.processingStatus}{event.lastErrorCode ? ` · ${event.lastErrorCode}` : ""} · {event.receivedViaCircuit}</p></div><time className="text-sm text-stone-500">{formatDate(event.receivedAt)}</time></div>) : <p className="py-4 text-sm text-stone-600">尚無 Webhook 紀錄。</p>}</div></section>
    </main>
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(date);
}
