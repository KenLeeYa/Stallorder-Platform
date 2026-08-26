"use client";

import { type FormEvent, useState } from "react";
import { AlertTriangle, Clipboard, Coins, LoaderCircle, Megaphone, Pause, Play, StopCircle } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { parseFieldErrors } from "@/lib/form-field-errors";
import type { getEventGrowthDashboard } from "@/server/event-growth/event-growth-service";

type Dashboard = Awaited<ReturnType<typeof getEventGrowthDashboard>>;
const statusLabels: Record<string, string> = { DRAFT: "草稿", ACTIVE: "啟用", PAUSED: "暫停", ENDED: "結束" };
const categoryLabels: Record<string, string> = { BOOTH_FEE: "攤位費", ADVERTISING: "廣告", TRANSPORT: "交通", STAFF: "人員", OTHER: "其他" };

export function EventGrowthCenter({ organizationId, initialDashboard }: { organizationId: string; initialDashboard: Dashboard }) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function send(command: Record<string, unknown>, success: string) {
    if (busy) return false;
    setBusy(true); setMessage(""); setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/event-growth`, { method: "POST", headers: csrfHeaders(), body: JSON.stringify(command) });
      const payload = await response.json() as Dashboard & { error?: string; fieldErrors?: unknown };
      if (!response.ok || payload.error) { setMessage(payload.error ?? "目前無法更新活動推廣設定。"); setFieldErrors(parseFieldErrors(payload.fieldErrors)); return false; }
      setDashboard(payload); setMessage(success); return true;
    } catch { setMessage("網路連線中斷，請稍後再試。"); return false; }
    finally { setBusy(false); }
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await send({ operation: "CREATE_CAMPAIGN", marketEventId: data.get("marketEventId"), name: data.get("name"), source: data.get("source"), medium: data.get("medium"), campaignCode: data.get("campaignCode"), startsAt: new Date(String(data.get("startsAt"))).toISOString(), endsAt: new Date(String(data.get("endsAt"))).toISOString() }, "活動推廣草稿已建立。");
    if (ok) form.reset();
  }

  async function createExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await send({ operation: "CREATE_EXPENSE", marketEventId: data.get("marketEventId"), category: data.get("category"), amount: Number(data.get("amount")), note: data.get("note"), incurredAt: new Date(String(data.get("incurredAt"))).toISOString() }, "活動費用已記錄。");
    if (ok) form.reset();
  }

  async function copyOrderLink(path: string) {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setMessage("簽章點餐連結已複製；目前僅供本機流程驗證。");
  }

  return (
    <div className="space-y-6">
      {!dashboard.attributionCaptureEnabled ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><h2 className="font-semibold">訂單歸因仍維持關閉</h2><p className="mt-1">可先建立活動、簽章連結與費用；系統不會寫入訂單歸因，直到兩條公開下單流程都通過同等的整合與防竄改測試。</p></div></div></section> : null}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["推廣活動", dashboard.campaigns.length], ["觸及紀錄", dashboard.summary.touchCount], ["歸因訂單", dashboard.summary.attributedOrderCount], ["已記錄費用", `$${dashboard.summary.expenseAmount}`]].map(([label, value]) => <article key={label} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><p className="text-sm text-stone-600">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></article>)}</section>
      {message ? <p role="status" className={`rounded-lg border p-3 text-sm ${Object.keys(fieldErrors).length ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-900"}`}>{message}</p> : null}
      {!dashboard.events.length ? <p className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">請先在「市集活動」建立活動，再設定推廣與費用。</p> : <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={createCampaign} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 text-lg font-semibold"><Megaphone className="h-5 w-5" />建立推廣草稿</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><EventSelect events={dashboard.events} error={fieldErrors.marketEventId} /><Field label="活動名稱" name="name" placeholder="夏日市集 LINE" error={fieldErrors.name} /><Field label="來源" name="source" placeholder="LINE" error={fieldErrors.source} /><Field label="媒介" name="medium" placeholder="QR" error={fieldErrors.medium} /><Field label="活動代碼" name="campaignCode" placeholder="SUMMER-2026" error={fieldErrors.campaignCode} /><Field label="開始時間" name="startsAt" type="datetime-local" error={fieldErrors.startsAt} /><Field label="結束時間" name="endsAt" type="datetime-local" error={fieldErrors.endsAt} /></div><SubmitButton busy={busy} label="建立推廣草稿" /></form>
        <form onSubmit={createExpense} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 text-lg font-semibold"><Coins className="h-5 w-5" />記錄活動費用</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><EventSelect events={dashboard.events} error={fieldErrors.marketEventId} /><label className="grid gap-1 text-sm font-medium">費用類別<select name="category" className="min-h-11 rounded-md border border-stone-300 bg-white px-3">{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Field label="金額（元）" name="amount" type="number" min="0" max="100000000" error={fieldErrors.amount} /><Field label="發生時間" name="incurredAt" type="datetime-local" error={fieldErrors.incurredAt} /><Field label="費用說明" name="note" placeholder="攤位租金" error={fieldErrors.note} /></div><SubmitButton busy={busy} label="記錄費用" /></form>
      </div>}
      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">推廣活動</h2><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{dashboard.campaigns.map((campaign) => <article key={campaign.id} className="rounded-lg border border-stone-200 p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{campaign.name}</p><p className="text-sm text-stone-600">{campaign.eventName}</p></div><span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold">{statusLabels[campaign.status] ?? campaign.status}</span></div><p className="mt-2 text-xs text-stone-500">{campaign.source} / {campaign.medium} / {campaign.campaignCode}</p><div className="mt-3 flex flex-wrap gap-2">{campaign.orderPath ? <ActionButton icon={<Clipboard className="h-4 w-4" />} label="複製簽章連結" onClick={() => void copyOrderLink(campaign.orderPath!)} busy={busy} /> : null}{campaign.status === "DRAFT" || campaign.status === "PAUSED" ? <ActionButton icon={<Play className="h-4 w-4" />} label="啟用" onClick={() => void send({ operation: "SET_CAMPAIGN_STATUS", campaignId: campaign.id, status: "ACTIVE" }, "推廣活動已啟用。") } busy={busy} /> : null}{campaign.status === "ACTIVE" ? <ActionButton icon={<Pause className="h-4 w-4" />} label="暫停" onClick={() => void send({ operation: "SET_CAMPAIGN_STATUS", campaignId: campaign.id, status: "PAUSED" }, "推廣活動已暫停。") } busy={busy} /> : null}{campaign.status !== "ENDED" ? <ActionButton icon={<StopCircle className="h-4 w-4" />} label="結束" onClick={() => void send({ operation: "SET_CAMPAIGN_STATUS", campaignId: campaign.id, status: "ENDED" }, "推廣活動已結束。") } busy={busy} /> : null}</div></article>)}{!dashboard.campaigns.length ? <p className="text-sm text-stone-600">尚未建立推廣活動。</p> : null}</div></section>
      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">最近費用</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{dashboard.expenses.map((expense) => <article key={expense.id} className="rounded-lg border border-stone-200 p-3"><div className="flex justify-between gap-3"><p className="font-semibold">{expense.eventName}</p><p className="font-semibold">${expense.amount}</p></div><p className="mt-1 text-sm text-stone-600">{categoryLabels[expense.category] ?? expense.category} · {expense.note}</p></article>)}{!dashboard.expenses.length ? <p className="text-sm text-stone-600">尚未記錄活動費用。</p> : null}</div></section>
    </div>
  );
}

function EventSelect({ events, error }: { events: Dashboard["events"]; error?: string }) { return <label className="grid gap-1 text-sm font-medium">市集活動<select name="marketEventId" required className="min-h-11 min-w-0 rounded-md border border-stone-300 bg-white px-3"><option value="">請選擇</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}{event.hasActiveOrderQr ? "" : "（尚無活動 QR）"}</option>)}</select>{error ? <span className="text-sm text-red-700">{error}</span> : null}</label>; }
function Field({ label, name, error, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string }) { return <label className="grid gap-1 text-sm font-medium">{label}<input type={type} name={name} required {...props} className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3" />{error ? <span className="text-sm text-red-700">{error}</span> : null}</label>; }
function SubmitButton({ busy, label }: { busy: boolean; label: string }) { return <button type="submit" disabled={busy} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{label}</button>; }
function ActionButton({ icon, label, onClick, busy }: { icon: React.ReactNode; label: string; onClick: () => void; busy: boolean }) { return <button type="button" disabled={busy} onClick={onClick} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50">{icon}{label}</button>; }
