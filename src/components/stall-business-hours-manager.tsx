"use client";

import { useState } from "react";
import { Clock3, Save } from "lucide-react";
import { CollapsibleSectionSummary } from "@/components/collapsible-section-summary";
import { csrfHeaders } from "@/lib/csrf-client";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

export type BusinessHourView = {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
};

const dayLabels = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

export function StallBusinessHoursManager({ stallId, initialHours }: { stallId: string; initialHours: BusinessHourView[] }) {
  const normalized = dayLabels.map((_, dayOfWeek) => initialHours.find((hour) => hour.dayOfWeek === dayOfWeek) ?? { dayOfWeek, opensAt: "17:00", closesAt: "23:00", isClosed: false });
  const [hours, setHours] = useState(normalized);
  const [savedHours, setSavedHours] = useState(normalized);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(hours) !== JSON.stringify(savedHours);
  useUnsavedSettings("business-hours", dirty);

  function update(dayOfWeek: number, changes: Partial<BusinessHourView>) {
    setHours((current) => current.map((hour) => hour.dayOfWeek === dayOfWeek ? { ...hour, ...changes } : hour));
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/business-hours`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ hours }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法儲存營業時間。");
      const next = dayLabels.map((_, dayOfWeek) => payload.hours.find((hour: BusinessHourView) => hour.dayOfWeek === dayOfWeek));
      setHours(next);
      setSavedHours(next);
      setMessage("營業時間已儲存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法儲存營業時間。");
    } finally {
      setBusy(false);
    }
  }

  return <details open data-settings-section data-settings-scope="business-hours" data-settings-search="營業時間 星期 開店 打烊 公休 多攤位範本" className="border-b border-stone-200 data-[dirty=true]:border-l-2 data-[dirty=true]:border-l-amber-500 [&[open]>summary_.section-chevron]:rotate-180">
    <CollapsibleSectionSummary icon={Clock3} title="營業時間" description={dirty ? "有尚未儲存的變更" : "可供多攤位範本複製。"} />
    <div className="pb-6">
      {message ? <p role="status" className="mb-3 text-sm font-medium text-stone-700">{message}</p> : null}
      <div className="divide-y divide-stone-200 border-y border-stone-200">{hours.map((hour) => <div key={hour.dayOfWeek} className="grid gap-3 py-3 sm:grid-cols-[100px_100px_1fr] sm:items-center"><strong className="text-sm">{dayLabels[hour.dayOfWeek]}</strong><label className="flex items-center gap-2 text-xs font-semibold text-stone-600"><input type="checkbox" checked={hour.isClosed} onChange={(event) => update(hour.dayOfWeek, { isClosed: event.target.checked })} />公休</label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-stone-600">開始<input type="time" disabled={hour.isClosed} value={hour.opensAt} onChange={(event) => update(hour.dayOfWeek, { opensAt: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-2 text-sm disabled:bg-stone-100" /></label><label className="text-xs font-semibold text-stone-600">結束<input type="time" disabled={hour.isClosed} value={hour.closesAt} onChange={(event) => update(hour.dayOfWeek, { closesAt: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-2 text-sm disabled:bg-stone-100" /></label></div></div>)}</div>
      <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存營業時間</button>
    </div>
  </details>;
}
