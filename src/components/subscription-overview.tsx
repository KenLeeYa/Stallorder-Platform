"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, FileText, Gauge, Plus, QrCode, ReceiptText, Users } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";

type Props = {
  organizationId: string;
  currency: string;
  canApprove: boolean;
  data: {
    plan: { code: string; name: string; basePrice: number; includedStalls: number; additionalStallPrice: number | null; maxStalls: number | null };
    subscription: { status: string; periodStart: string; periodEnd: string };
    usage: { orderCount: number; activeStallCount: number; staffCount: number; qrCodeCount: number; csvExportCount: number };
    estimate: { additionalStallCount: number; additionalStallFee: number; excessOrderFee: number; estimatedTotal: number };
    approvals: Array<{ id: string; quantity: number; unitPrice: number; reason: string; effectiveAt: string }>;
    invoices: Array<{ id: string; number: string; status: string; total: number; periodStart: string; lineItems: Array<{ id: string; description: string; amount: number }> }>;
  };
};

const subscriptionStatusLabels: Record<string, string> = {
  TRIALING: "試用中", ACTIVE: "有效", PAST_DUE: "逾期", GRACE_PERIOD: "寬限期", SUSPENDED: "已暫停", CANCELLED: "已取消",
};

export function SubscriptionOverview({ organizationId, currency, canApprove, data }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function approve(formData: FormData) {
    setSaving(true);
    setMessage("");
    try {
      const unitPriceValue = String(formData.get("unitPrice") ?? "").trim();
      const response = await fetch(`/api/admin/organizations/${organizationId}/additional-stalls`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          quantity: Number(formData.get("quantity")),
          ...(unitPriceValue ? { unitPrice: Number(unitPriceValue) } : {}),
          reason: formData.get("reason"),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法核准額外攤位。");
      setMessage("額外攤位已核准，費用已加入本期草稿發票。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法核准額外攤位。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid border-y border-stone-200 sm:grid-cols-2 lg:grid-cols-4" aria-label="訂閱摘要">
        <Metric icon={<ReceiptText />} label="目前方案" value={data.plan.name} />
        <Metric icon={<Building2 />} label="使用攤位" value={`${data.usage.activeStallCount} / ${data.plan.maxStalls ?? "不限"}`} />
        <Metric icon={<Gauge />} label="訂閱狀態" value={subscriptionStatusLabels[data.subscription.status] ?? data.subscription.status} />
        <Metric icon={<FileText />} label="本期預估" value={formatMoney(data.estimate.estimatedTotal, currency)} />
      </section>

      <section>
        <h2 className="text-lg font-semibold">方案與本期費用</h2>
        <dl className="mt-4 grid gap-x-8 gap-y-4 border-y border-stone-200 py-5 sm:grid-cols-2 lg:grid-cols-4">
          <Definition label="基本月費" value={formatMoney(data.plan.basePrice, currency)} />
          <Definition label="內含攤位" value={`${data.plan.includedStalls} 個`} />
          <Definition label="額外攤位" value={data.plan.additionalStallPrice === null ? "需人工報價" : `${formatMoney(data.plan.additionalStallPrice, currency)} / 月`} />
          <Definition label="本期區間" value={`${data.subscription.periodStart} 至 ${data.subscription.periodEnd}`} />
          <Definition label="額外攤位費" value={formatMoney(data.estimate.additionalStallFee, currency)} />
          <Definition label="超額訂單費" value={formatMoney(data.estimate.excessOrderFee, currency)} />
        </dl>
      </section>

      <section>
        <h2 className="text-lg font-semibold">本期用量</h2>
        <div className="mt-4 grid border-y border-stone-200 sm:grid-cols-2 lg:grid-cols-5">
          <Usage icon={<ReceiptText />} label="訂單" value={data.usage.orderCount} />
          <Usage icon={<Building2 />} label="啟用攤位" value={data.usage.activeStallCount} />
          <Usage icon={<Users />} label="成員" value={data.usage.staffCount} />
          <Usage icon={<QrCode />} label="QR Code" value={data.usage.qrCodeCount} />
          <Usage icon={<FileText />} label="CSV 匯出" value={data.usage.csvExportCount} />
        </div>
      </section>

      {canApprove ? (
        <section className="border-t border-stone-200 pt-7">
          <h2 className="text-lg font-semibold">平台人工核准</h2>
          <form action={approve} className="mt-4 grid gap-3 lg:grid-cols-[120px_180px_minmax(0,1fr)_auto]">
            <label className="text-sm font-medium">核准數量<input name="quantity" type="number" min="1" max="100" defaultValue="1" required className="mt-1.5 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
            <label className="text-sm font-medium">單價（Enterprise）<input name="unitPrice" type="number" min="0" max="1000000" className="mt-1.5 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
            <label className="text-sm font-medium">核准原因<input type="text" name="reason" required minLength={2} maxLength={500} className="mt-1.5 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
            <button type="submit" disabled={saving} className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{saving ? "核准中..." : "核准"}</button>
          </form>
        </section>
      ) : null}

      <section className="border-t border-stone-200 pt-7">
        <h2 className="text-lg font-semibold">額外攤位核准</h2>
        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">{data.approvals.map((approval) => <div key={approval.id} className="flex flex-wrap justify-between gap-3 py-4 text-sm"><div><strong>{approval.quantity} 個攤位</strong><p className="mt-1 text-stone-500">{approval.reason}</p></div><div className="text-right"><strong>{formatMoney(approval.unitPrice, currency)} / 個</strong><p className="mt-1 text-stone-500">{approval.effectiveAt}</p></div></div>)}</div>
        {data.approvals.length === 0 ? <p className="mt-4 text-sm text-stone-500">目前沒有額外攤位核准。</p> : null}
      </section>

      <section className="border-t border-stone-200 pt-7">
        <h2 className="text-lg font-semibold">發票紀錄</h2>
        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">{data.invoices.map((invoice) => <article key={invoice.id} className="py-4"><div className="flex flex-wrap justify-between gap-3"><div><strong>{invoice.number}</strong><p className="mt-1 text-sm text-stone-500">{invoice.periodStart} · {invoice.status}</p></div><strong>{formatMoney(invoice.total, currency)}</strong></div><ul className="mt-3 space-y-1 text-sm text-stone-600">{invoice.lineItems.map((item) => <li key={item.id} className="flex justify-between gap-3"><span>{item.description}</span><span>{formatMoney(item.amount, currency)}</span></li>)}</ul></article>)}</div>
        {data.invoices.length === 0 ? <p className="mt-4 text-sm text-stone-500">尚無發票紀錄。</p> : null}
      </section>
      {message ? <p role="status" className="text-sm font-medium text-stone-700">{message}</p> : null}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex min-h-28 items-center gap-3 border-b border-stone-200 p-4 sm:border-r lg:border-b-0"><span className="text-teal-700 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><dt className="text-sm text-stone-500">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div></div>; }
function Definition({ label, value }: { label: string; value: string }) { return <div><dt className="text-sm text-stone-500">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>; }
function Usage({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) { return <div className="flex min-h-24 items-center gap-3 border-b border-stone-200 p-4 lg:border-b-0 lg:border-r"><span className="text-teal-700 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><div className="text-xs text-stone-500">{label}</div><strong className="text-lg">{value}</strong></div></div>; }
