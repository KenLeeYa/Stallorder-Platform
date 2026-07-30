import Link from "next/link";
import { ChevronRight, ShieldCheck, Truck } from "lucide-react";
import { AdminDeliveryJobRetry } from "@/components/admin-delivery-integration-actions";
import {
  deliveryConnectionStatusLabels,
  deliveryProviderLabel,
  deliveryRequestStatusLabels,
} from "@/lib/delivery-platform-labels";
import { requirePlatformAdminPage } from "@/lib/authorization";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";

export default async function AdminDeliveryIntegrationsPage() {
  await requirePlatformAdminPage("/admin/delivery-integrations");
  const data = await deliveryPlatformRepository.listPlatformAdminData();
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header className="border-b border-stone-200 pb-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-teal-800"><ShieldCheck className="h-4 w-4" />僅限平台管理員</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><Truck className="h-7 w-7 text-teal-700" />外送平台整合管理</h1>
        <p className="mt-2 text-sm text-stone-600">正式平台功能與供應商 Adapter 預設關閉；核准設定不等於正式啟用。</p>
      </header>

      <section className="py-7">
        <h2 className="text-xl font-semibold">待審申請</h2>
        <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
          {data.requests.length ? data.requests.map((request) => (
            <Link key={request.id} href={`/admin/delivery-integrations/${request.id}`} className="flex min-h-20 items-center gap-4 py-4">
              <div className="min-w-0 flex-1"><p className="font-semibold">{deliveryProviderLabel(request.provider)} · {request.merchantContactName}</p><p className="mt-1 text-sm text-stone-600">{deliveryRequestStatusLabels[request.status] ?? request.status}</p></div><ChevronRight className="h-5 w-5 text-stone-400" />
            </Link>
          )) : <p className="py-5 text-sm text-stone-600">目前沒有申請。</p>}
        </div>
      </section>

      <section className="border-t border-stone-200 py-7">
        <h2 className="text-xl font-semibold">連線</h2>
        <div className="mt-3 divide-y divide-stone-200">
          {data.connections.length ? data.connections.map((connection) => (
            <Link key={connection.id} href={`/admin/delivery-connections/${connection.id}`} className="flex min-h-16 items-center gap-4 py-3"><div className="min-w-0 flex-1"><p className="font-semibold">{deliveryProviderLabel(connection.provider)}</p><p className="text-sm text-stone-600">{deliveryConnectionStatusLabels[connection.status] ?? connection.status}{connection.externalStoreName ? ` · ${connection.externalStoreName}` : ""}</p></div><ChevronRight className="h-5 w-5 text-stone-400" /></Link>
          )) : <p className="py-4 text-sm text-stone-600">尚無連線。</p>}
        </div>
      </section>

      <section className="border-t border-stone-200 py-7">
        <h2 className="text-xl font-semibold">需人工判斷的失敗工作</h2>
        <div className="mt-3 divide-y divide-stone-200">
          {data.failedJobs.length ? data.failedJobs.map((job) => <div key={job.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-semibold">{deliveryProviderLabel(job.provider)} · {job.jobType}</p><p className="text-sm text-stone-600">{job.status} · {job.lastErrorCode ?? "UNKNOWN"} · 嘗試 {job.attemptCount}/{job.maxAttempts}</p></div><AdminDeliveryJobRetry connectionId={job.connectionId} jobId={job.id} /></div>) : <p className="py-4 text-sm text-stone-600">目前沒有失敗工作。</p>}
        </div>
      </section>
    </main>
  );
}
