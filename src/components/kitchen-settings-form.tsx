"use client";

import { useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import type { KitchenBoardMode } from "@/lib/kitchen-contract";

export function KitchenSettingsForm({ stallSlug, initialSettings }: { stallSlug: string; initialSettings: { warningMinutes: number; criticalMinutes: number; defaultView: KitchenBoardMode } }) {
  const [settings, setSettings] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${stallSlug}/kitchen/settings`, { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify(settings) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "無法儲存 KDS 設定。");
      setMessage("KDS 設定已儲存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法儲存 KDS 設定。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-6"><div className="border-b border-stone-200 pb-5"><h2 className="text-2xl font-semibold">KDS 顯示設定</h2><p className="mt-2 text-sm text-stone-600">警示門檻以訂單確認時間開始計算。</p></div>{message ? <p role="status" className="mt-4 border-l-4 border-teal-700 bg-teal-50 px-4 py-3 text-sm text-teal-900">{message}</p> : null}<section className="py-6"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">警示時間（分鐘）<input type="number" min={1} max={120} value={settings.warningMinutes} onChange={(event) => setSettings({ ...settings, warningMinutes: Number(event.target.value) })} className="form-input mt-1" /></label><label className="text-sm font-medium">嚴重逾時（分鐘）<input type="number" min={2} max={240} value={settings.criticalMinutes} onChange={(event) => setSettings({ ...settings, criticalMinutes: Number(event.target.value) })} className="form-input mt-1" /></label><label className="text-sm font-medium sm:col-span-2">預設看板模式<select value={settings.defaultView} onChange={(event) => setSettings({ ...settings, defaultView: event.target.value as KitchenBoardMode })} className="form-input mt-1 bg-white"><option value="ORDER">訂單模式</option><option value="ITEM">品項彙總</option><option value="STATION">工作站模式</option></select></label></div><button type="button" disabled={busy} onClick={() => void save()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}儲存設定</button></section></main>
  );
}
