"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, MailCheck, Pencil, Play, Plus, Save, Trash2, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatTaipeiDateTime } from "@/lib/date-time";
import { reportScheduleTypeLabels, type ScheduledReportType } from "@/lib/report-scheduling";

type Delivery = {
  id: string;
  status: "PROCESSING" | "SENT" | "SIMULATED" | "FAILURE";
  subject: string;
  periodStart: string;
  periodEnd: string;
  recipientCount: number;
  errorCode: string | null;
  sentAt: string | null;
  createdAt: string;
};
type Schedule = {
  id: string;
  name: string;
  reportType: ScheduledReportType;
  recipients: string[];
  stallIds: string[];
  timezone: string;
  sendHour: number;
  sendMinute: number;
  dayOfWeek: number | null;
  isEnabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdByName: string;
  deliveries: Delivery[];
};
type Draft = Omit<Schedule, "id" | "nextRunAt" | "lastRunAt" | "createdByName" | "deliveries" | "recipients"> & { recipientsText: string };

const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const deliveryLabels = { PROCESSING: "處理中", SENT: "已寄送", SIMULATED: "模擬完成", FAILURE: "寄送失敗" } as const;

export function ReportScheduleManager({
  organizationId,
  organizationEmail,
  stalls,
  initialSchedules,
  deliveryMode,
}: {
  organizationId: string;
  organizationEmail: string;
  stalls: Array<{ id: string; name: string }>;
  initialSchedules: Schedule[];
  deliveryMode: "CONFIGURED" | "SIMULATED" | "MISSING";
}) {
  const router = useRouter();
  const [archivedScheduleIds, setArchivedScheduleIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const schedules = initialSchedules.filter((schedule) => !archivedScheduleIds.includes(schedule.id));

  function newDraft(): Draft {
    return {
      name: "每日銷售日報",
      reportType: "DAILY_SALES",
      recipientsText: organizationEmail,
      stallIds: stalls.map((stall) => stall.id),
      timezone: "Asia/Taipei",
      sendHour: 8,
      sendMinute: 0,
      dayOfWeek: null,
      isEnabled: true,
    };
  }

  function edit(schedule: Schedule) {
    setEditingId(schedule.id);
    setDraft({
      name: schedule.name,
      reportType: schedule.reportType,
      recipientsText: schedule.recipients.join("\n"),
      stallIds: schedule.stallIds,
      timezone: schedule.timezone,
      sendHour: schedule.sendHour,
      sendMinute: schedule.sendMinute,
      dayOfWeek: schedule.dayOfWeek,
      isEnabled: schedule.isEnabled,
    });
    setMessage("");
  }

  async function save() {
    if (!draft) return;
    const recipients = [...new Set(draft.recipientsText.split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean))];
    const payload = {
      name: draft.name,
      reportType: draft.reportType,
      recipients,
      stallIds: draft.stallIds,
      timezone: draft.timezone,
      sendHour: draft.sendHour,
      sendMinute: draft.sendMinute,
      dayOfWeek: draft.reportType === "WEEKLY_SALES" ? draft.dayOfWeek : null,
      isEnabled: draft.isEnabled,
    };
    setBusyId(editingId ?? "new");
    setMessage("");
    try {
      const url = editingId
        ? `/api/merchant/organizations/${organizationId}/report-schedules/${editingId}`
        : `/api/merchant/organizations/${organizationId}/report-schedules`;
      const response = await fetch(url, { method: editingId ? "PATCH" : "POST", headers: csrfHeaders(), body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "無法儲存報表排程。");
      setMessage(editingId ? "報表排程已更新。" : "報表排程已建立。");
      setDraft(null);
      setEditingId(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法儲存報表排程。");
    } finally {
      setBusyId(null);
    }
  }

  async function runCommand(schedule: Schedule, operation: "TEST" | "ARCHIVE") {
    if (operation === "TEST" && !window.confirm(`確定立即測試寄送「${schedule.name}」？`)) return;
    if (operation === "ARCHIVE" && !window.confirm(`確定封存「${schedule.name}」？既有寄送紀錄會保留。`)) return;
    setBusyId(schedule.id);
    setMessage("");
    try {
      const response = await fetch(
        operation === "TEST"
          ? `/api/merchant/organizations/${organizationId}/report-schedules/${schedule.id}/test`
          : `/api/merchant/organizations/${organizationId}/report-schedules/${schedule.id}`,
        { method: operation === "TEST" ? "POST" : "DELETE", headers: csrfHeaders() },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? (operation === "TEST" ? "測試寄送失敗。" : "無法封存排程。"));
      if (operation === "ARCHIVE") setArchivedScheduleIds((current) => [...current, schedule.id]);
      setMessage(operation === "TEST" ? (result.status === "SIMULATED" ? "本機模擬寄送完成，未寄出真實 Email。" : "測試報告已寄送。") : "排程已封存，寄送紀錄已保留。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失敗。");
    } finally {
      setBusyId(null);
    }
  }

  const editing = Boolean(draft);
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-5">
        <div><div className="flex items-center gap-2 text-teal-800"><CalendarClock className="h-5 w-5" /><span className="text-sm font-semibold">自動報表</span></div><h1 className="mt-2 text-3xl font-semibold">排程寄送</h1><p className="mt-2 text-sm text-stone-600">自動寄送日報、週報及付款差異報告。</p></div>
        {!editing ? <button type="button" onClick={() => { setDraft(newDraft()); setEditingId(null); }} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" />新增排程</button> : null}
      </div>
      <div className={`border-b py-3 text-sm font-medium ${deliveryMode === "CONFIGURED" ? "border-emerald-200 text-emerald-800" : deliveryMode === "SIMULATED" ? "border-amber-200 text-amber-900" : "border-red-200 text-red-800"}`}>
        {deliveryMode === "CONFIGURED" ? "Email 服務已設定，測試與排程會寄送真實郵件。" : deliveryMode === "SIMULATED" ? "目前為本機模擬模式：會產生完整報告與寄送紀錄，但不寄出郵件。" : "正式環境尚未設定 Email 服務，排程將明確記錄失敗。"}
      </div>
      {message ? <p role="status" className={`border-b border-stone-200 py-3 text-sm font-medium ${/(無法|失敗|尚未)/.test(message) ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}

      {draft ? <ScheduleEditor draft={draft} stalls={stalls} busy={busyId !== null} onChange={setDraft} onSave={() => void save()} onCancel={() => { setDraft(null); setEditingId(null); }} /> : null}

      <section className="py-6" aria-labelledby="schedules-title">
        <h2 id="schedules-title" className="text-lg font-semibold">現有排程</h2>
        <div className="mt-4 grid gap-4">
          {schedules.map((schedule) => (
            <article key={schedule.id} className="rounded-md border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{schedule.name}</h3><span className={`text-xs font-semibold ${schedule.isEnabled ? "text-emerald-700" : "text-stone-500"}`}>{schedule.isEnabled ? "啟用中" : "已停用"}</span></div><p className="mt-1 text-sm text-stone-600">{reportScheduleTypeLabels[schedule.reportType]} · {timeLabel(schedule)} · {schedule.recipients.length} 位收件人</p><p className="mt-1 text-xs text-stone-500">下次執行：{formatTaipeiDateTime(schedule.nextRunAt)} · 建立者：{schedule.createdByName}</p></div><div className="flex gap-1"><button type="button" title="編輯排程" disabled={busyId !== null} onClick={() => edit(schedule)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 disabled:opacity-50"><Pencil className="h-4 w-4" /></button><button type="button" title="測試寄送" disabled={busyId !== null} onClick={() => void runCommand(schedule, "TEST")} className="grid h-10 w-10 place-items-center rounded-md border border-teal-300 text-teal-800 disabled:opacity-50"><Play className="h-4 w-4" /></button><button type="button" title="封存排程" disabled={busyId !== null} onClick={() => void runCommand(schedule, "ARCHIVE")} className="grid h-10 w-10 place-items-center rounded-md border border-red-200 text-red-700 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button></div></div>
              <details className="mt-4 border-t border-stone-100 pt-3"><summary className="cursor-pointer list-none text-sm font-semibold text-teal-800 [&::-webkit-details-marker]:hidden">最近寄送紀錄（{schedule.deliveries.length}）</summary><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{schedule.deliveries.map((delivery) => <div key={delivery.id} className="grid gap-1 py-3 text-xs sm:grid-cols-[120px_1fr_180px]"><span className={delivery.status === "FAILURE" ? "font-semibold text-red-700" : delivery.status === "SENT" ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}>{deliveryLabels[delivery.status]}</span><span className="truncate">{delivery.periodStart} 至 {delivery.periodEnd} · {delivery.recipientCount} 位</span><span className="text-stone-500">{formatTaipeiDateTime(delivery.sentAt ?? delivery.createdAt)}{delivery.errorCode ? ` · ${delivery.errorCode}` : ""}</span></div>)}{schedule.deliveries.length === 0 ? <p className="py-4 text-xs text-stone-500">尚無寄送紀錄。</p> : null}</div></details>
            </article>
          ))}
          {schedules.length === 0 ? <div className="border-y border-stone-200 py-10 text-center"><MailCheck className="mx-auto h-8 w-8 text-stone-400" /><p className="mt-3 text-sm text-stone-500">尚未建立報表寄送排程。</p></div> : null}
        </div>
      </section>
    </main>
  );
}

function ScheduleEditor({ draft, stalls, busy, onChange, onSave, onCancel }: { draft: Draft; stalls: Array<{ id: string; name: string }>; busy: boolean; onChange: (draft: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const time = `${String(draft.sendHour).padStart(2, "0")}:${String(draft.sendMinute).padStart(2, "0")}`;
  const selectedStalls = useMemo(() => new Set(draft.stallIds), [draft.stallIds]);
  return <section className="border-b border-stone-200 py-6" aria-labelledby="editor-title"><div className="flex items-center justify-between gap-3"><h2 id="editor-title" className="text-lg font-semibold">排程設定</h2><button type="button" title="關閉" onClick={onCancel} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300"><X className="h-4 w-4" /></button></div><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">排程名稱<input value={draft.name} maxLength={80} onChange={(event) => onChange({ ...draft, name: event.target.value })} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium">報告類型<select value={draft.reportType} onChange={(event) => { const reportType = event.target.value as ScheduledReportType; onChange({ ...draft, reportType, dayOfWeek: reportType === "WEEKLY_SALES" ? draft.dayOfWeek ?? 1 : null }); }} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">{Object.entries(reportScheduleTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-medium">寄送時間<input type="time" value={time} onChange={(event) => { const [hour, minute] = event.target.value.split(":").map(Number); onChange({ ...draft, sendHour: hour, sendMinute: minute }); }} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label>{draft.reportType === "WEEKLY_SALES" ? <label className="text-sm font-medium">寄送星期<select value={draft.dayOfWeek ?? 1} onChange={(event) => onChange({ ...draft, dayOfWeek: Number(event.target.value) })} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">{weekdays.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label> : null}<label className="text-sm font-medium md:col-span-2">收件人 Email<textarea value={draft.recipientsText} onChange={(event) => onChange({ ...draft, recipientsText: event.target.value })} rows={3} maxLength={5_000} placeholder="每行一個 Email，最多 20 位" className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label><fieldset className="md:col-span-2"><legend className="text-sm font-medium">攤位範圍</legend><div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{stalls.map((stall) => <label key={stall.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={selectedStalls.has(stall.id)} onChange={(event) => onChange({ ...draft, stallIds: event.target.checked ? [...draft.stallIds, stall.id] : draft.stallIds.filter((id) => id !== stall.id) })} />{stall.name}</label>)}</div></fieldset><label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={draft.isEnabled} onChange={(event) => onChange({ ...draft, isEnabled: event.target.checked })} />啟用此排程</label></div><div className="mt-5 flex gap-2"><button type="button" disabled={busy} onClick={onSave} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存排程</button><button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">取消</button></div></section>;
}

function timeLabel(schedule: Schedule) {
  const time = `${String(schedule.sendHour).padStart(2, "0")}:${String(schedule.sendMinute).padStart(2, "0")}`;
  return schedule.reportType === "WEEKLY_SALES" ? `${weekdays[schedule.dayOfWeek ?? 1]} ${time}` : `每日 ${time}`;
}
