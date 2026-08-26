"use client";

import { type FormEvent, useState } from "react";
import { AlertTriangle, Gift, LoaderCircle, Pause, Play, Sparkles, StopCircle } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { parseFieldErrors } from "@/lib/form-field-errors";
import type { getGrowthDashboard } from "@/server/growth/growth-service";

type Dashboard = Awaited<ReturnType<typeof getGrowthDashboard>>;

const channelLabels: Record<string, string> = { QR: "QR 點餐", STAFF_POS: "店員點餐", LINE_ORDERING: "LINE 訂餐", BRANDED_WEB: "品牌訂餐頁", FOODPANDA: "foodpanda", UBER_EATS: "Uber Eats" };
const statusLabels: Record<string, string> = { DRAFT: "草稿", ACTIVE: "啟用", PAUSED: "暫停", ENDED: "結束" };

export function GrowthCenter({ organizationId, initialDashboard }: { organizationId: string; initialDashboard: Dashboard }) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function send(command: Record<string, unknown>, success: string) {
    if (busy) return false;
    setBusy(true); setMessage(""); setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/growth`, { method: "POST", headers: csrfHeaders(), body: JSON.stringify(command) });
      const payload = await response.json() as Dashboard & { error?: string; fieldErrors?: unknown };
      if (!response.ok || payload.error) { setMessage(payload.error ?? "目前無法更新優惠活動。"); setFieldErrors(parseFieldErrors(payload.fieldErrors)); return false; }
      setDashboard(payload); setMessage(success); return true;
    } catch { setMessage("網路連線中斷，請稍後再試。"); return false; }
    finally { setBusy(false); }
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await send({
      operation: "CREATE_COUPON_CAMPAIGN",
      name: data.get("name"),
      discountType: data.get("discountType"),
      discountValue: Number(data.get("discountValue")),
      budgetAmount: Number(data.get("budgetAmount")),
      perCustomerLimit: Number(data.get("perCustomerLimit")),
      minimumOrderAmount: Number(data.get("minimumOrderAmount")),
      startsAt: new Date(String(data.get("startsAt"))).toISOString(),
      endsAt: new Date(String(data.get("endsAt"))).toISOString(),
      channels: data.getAll("channels"),
    }, "優惠活動草稿已建立。");
    if (ok) form.reset();
  }

  return (
    <div className="space-y-6">
      {dashboard.customerActivationLocked ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><h2 className="font-semibold">顧客發送維持硬鎖</h2><p className="mt-1">可先設計與審核活動，但在隱私／法務核准同意版本、退訂、留存及資料刪除流程前，不會發券、傳訊或執行自動化。</p></div></div></section> : null}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["優惠活動", dashboard.campaigns.length], ["集點方案", dashboard.counts.stampPrograms], ["推薦方案", dashboard.counts.referralPrograms], ["RFM 快照", dashboard.counts.rfmSnapshots]].map(([label, value]) => <article key={label} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><p className="text-sm text-stone-600">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></article>)}</section>
      {message ? <p role="status" className={`rounded-lg border p-3 text-sm ${Object.keys(fieldErrors).length ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-900"}`}>{message}</p> : null}
      <form onSubmit={createCampaign} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Gift className="h-5 w-5" />建立優惠活動草稿</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="活動名稱" name="name" placeholder="開幕九折" error={fieldErrors.name} />
          <label className="grid gap-1 text-sm font-medium">折扣類型<select name="discountType" className="min-h-11 rounded-md border border-stone-300 bg-white px-3"><option value="PERCENT">百分比折扣</option><option value="FIXED">固定金額</option></select></label>
          <Field label="折扣值" name="discountValue" type="number" min="1" max="1000000" defaultValue="10" error={fieldErrors.discountValue} />
          <Field label="活動預算（元）" name="budgetAmount" type="number" min="1" max="100000000" defaultValue="20000" error={fieldErrors.budgetAmount} />
          <Field label="每客上限" name="perCustomerLimit" type="number" min="1" max="100" defaultValue="1" error={fieldErrors.perCustomerLimit} />
          <Field label="最低消費（元）" name="minimumOrderAmount" type="number" min="0" defaultValue="0" error={fieldErrors.minimumOrderAmount} />
          <Field label="開始時間" name="startsAt" type="datetime-local" error={fieldErrors.startsAt} />
          <Field label="結束時間" name="endsAt" type="datetime-local" error={fieldErrors.endsAt} />
        </div>
        <fieldset className="mt-3"><legend className="text-sm font-medium">適用通路</legend><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{Object.entries(channelLabels).map(([channel, label]) => <label key={channel} className="flex min-h-11 items-center gap-2 rounded-md border border-stone-200 px-3 text-sm"><input type="checkbox" name="channels" value={channel} defaultChecked={channel === "QR"} />{label}</label>)}</div>{fieldErrors.channels ? <span className="text-sm text-red-700">{fieldErrors.channels}</span> : null}</fieldset>
        <button type="submit" disabled={busy} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}建立草稿</button>
      </form>
      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">優惠活動</h2><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{dashboard.campaigns.map((campaign) => <article key={campaign.id} className="rounded-lg border border-stone-200 p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{campaign.name}</p><p className="text-sm text-stone-600">{campaign.discountType === "PERCENT" ? `${campaign.discountValue}% off` : `折抵 $${campaign.discountValue}`}</p></div><span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold">{statusLabels[campaign.status] ?? campaign.status}</span></div><dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-stone-500">預算</dt><dd className="font-semibold">${campaign.redeemedAmount} / ${campaign.budgetAmount}</dd></div><div><dt className="text-stone-500">每客上限</dt><dd className="font-semibold">{campaign.perCustomerLimit}</dd></div></dl><p className="mt-2 text-xs text-stone-500">{campaign.channels.map((channel) => channelLabels[channel] ?? channel).join("、")}</p><div className="mt-3 flex flex-wrap gap-2">{campaign.status === "DRAFT" || campaign.status === "PAUSED" ? <ActionButton icon={<Play className="h-4 w-4" />} label="啟用" onClick={() => send({ operation: "SET_COUPON_CAMPAIGN_STATUS", campaignId: campaign.id, status: "ACTIVE" }, "優惠活動已啟用；顧客發送硬鎖仍會生效。") } busy={busy} /> : null}{campaign.status === "ACTIVE" ? <ActionButton icon={<Pause className="h-4 w-4" />} label="暫停" onClick={() => send({ operation: "SET_COUPON_CAMPAIGN_STATUS", campaignId: campaign.id, status: "PAUSED" }, "優惠活動已暫停。") } busy={busy} /> : null}{campaign.status !== "ENDED" ? <ActionButton icon={<StopCircle className="h-4 w-4" />} label="結束" onClick={() => send({ operation: "SET_COUPON_CAMPAIGN_STATUS", campaignId: campaign.id, status: "ENDED" }, "優惠活動已結束。") } busy={busy} /> : null}</div></article>)}{!dashboard.campaigns.length ? <p className="text-sm text-stone-600">尚未建立優惠活動。</p> : null}</div></section>
    </div>
  );
}

function Field({ label, name, error, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string }) { return <label className="grid gap-1 text-sm font-medium">{label}<input type={type} name={name} required {...props} className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3" />{error ? <span className="text-sm text-red-700">{error}</span> : null}</label>; }
function ActionButton({ icon, label, onClick, busy }: { icon: React.ReactNode; label: string; onClick: () => void; busy: boolean }) { return <button type="button" disabled={busy} onClick={onClick} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50">{icon}{label}</button>; }
