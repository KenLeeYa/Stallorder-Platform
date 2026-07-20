"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Gauge,
  LoaderCircle,
  PackageOpen,
  Pause,
  Play,
  Save,
  TimerReset,
  Trash2,
} from "lucide-react";
import type { CapacityManagerData, CapacitySettingsDto } from "@/lib/capacity-contract";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatTaipeiDateTime } from "@/lib/date-time";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

type ProductRuleDraft = {
  productId: string;
  capacityWeight: string;
  prepMinutes: string;
  maxQuantityPerWindow: string;
  isActive: boolean;
};

const emptyRule: ProductRuleDraft = {
  productId: "",
  capacityWeight: "1",
  prepMinutes: "10",
  maxQuantityPerWindow: "",
  isActive: true,
};

export function CapacitySettingsForm({
  stallId,
  initialData,
}: {
  stallId: string;
  initialData: CapacityManagerData;
}) {
  const [data, setData] = useState(initialData);
  const [settings, setSettings] = useState(initialData.settings);
  const [savedSettings, setSavedSettings] = useState(initialData.settings);
  const [reason, setReason] = useState("");
  const [manualWait, setManualWait] = useState(initialData.settings.manualWaitMinutes?.toString() ?? "");
  const [rule, setRule] = useState<ProductRuleDraft>(emptyRule);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [savedSettings, settings],
  );
  useUnsavedSettings("capacity-settings", dirty);

  async function request(command: Record<string, unknown>) {
    const response = await fetch(`/api/merchant/stalls/${stallId}/capacity`, {
      method: "PATCH",
      headers: csrfHeaders(),
      body: JSON.stringify(command),
    });
    const payload = await response.json() as CapacityManagerData & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "無法更新容量設定。");
    setData(payload);
    setSettings(payload.settings);
    setSavedSettings(payload.settings);
    setManualWait(payload.settings.manualWaitMinutes?.toString() ?? "");
    return payload;
  }

  async function run(command: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setMessage("");
    try {
      await request(command);
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法更新容量設定。");
    } finally {
      setBusy(false);
    }
  }

  function updateNumber(key: keyof CapacitySettingsDto, value: string) {
    setSettings((current) => ({ ...current, [key]: Number(value) }));
  }

  async function saveSettings() {
    await run({
      operation: "UPDATE_SETTINGS",
      windowMinutes: settings.windowMinutes,
      maxOrdersPerWindow: settings.maxOrdersPerWindow,
      maxItemsPerWindow: settings.maxItemsPerWindow,
      warningUtilizationPercent: settings.warningUtilizationPercent,
      pauseUtilizationPercent: settings.pauseUtilizationPercent,
      defaultPrepMinutes: settings.defaultPrepMinutes,
      minimumQuoteMinutes: settings.minimumQuoteMinutes,
      maximumQuoteMinutes: settings.maximumQuoteMinutes,
      quoteBufferMinutes: settings.quoteBufferMinutes,
      acknowledgmentThresholdMinutes: settings.acknowledgmentThresholdMinutes,
      autoPauseEnabled: settings.autoPauseEnabled,
      autoResumeEnabled: settings.autoResumeEnabled,
      isActive: settings.isActive,
    }, "容量與等候時間設定已儲存。");
  }

  async function saveRule() {
    if (!rule.productId) {
      setMessage("請選擇商品。");
      return;
    }
    await run({
      operation: "UPSERT_PRODUCT_RULE",
      productId: rule.productId,
      capacityWeight: Number(rule.capacityWeight),
      prepMinutes: Number(rule.prepMinutes),
      maxQuantityPerWindow:
        rule.maxQuantityPerWindow === "" ? null : Number(rule.maxQuantityPerWindow),
      isActive: rule.isActive,
    }, "商品容量規則已儲存。");
    setRule(emptyRule);
  }

  function editRule(productId: string) {
    const current = data.rules.find((candidate) => candidate.productId === productId);
    if (!current) return;
    setRule({
      productId: current.productId,
      capacityWeight: String(current.capacityWeight),
      prepMinutes: String(current.prepMinutes),
      maxQuantityPerWindow: current.maxQuantityPerWindow?.toString() ?? "",
      isActive: current.isActive,
    });
  }

  async function deleteRule(productId: string) {
    if (!window.confirm("確定刪除此商品的容量規則？刪除後會使用攤位預設值。")) return;
    await run({ operation: "DELETE_PRODUCT_RULE", productId }, "商品容量規則已刪除。");
    if (rule.productId === productId) setRule(emptyRule);
  }

  const snapshot = data.snapshot;
  const paused = snapshot.pauseSource !== "NONE" || !snapshot.acceptingPublicOrders;

  return (
    <div className="space-y-7">
      <section className="border-y border-stone-200 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold"><Gauge className="h-5 w-5 text-teal-700" />即時負載</h2>
            <p className="mt-1 text-sm text-stone-600">每次公開送單仍會由伺服器重新驗證。</p>
          </div>
          <span className={`text-sm font-semibold ${paused ? "text-red-700" : snapshot.utilizationPercent >= snapshot.warningUtilizationPercent ? "text-amber-700" : "text-emerald-700"}`}>{paused ? "公開接單暫停" : "公開接單中"}</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-y-4 sm:grid-cols-4">
          <Metric label="預估等候" value={snapshot.quoteMinMinutes === snapshot.quoteMaxMinutes ? `${snapshot.quoteMaxMinutes} 分` : `${snapshot.quoteMinMinutes}～${snapshot.quoteMaxMinutes} 分`} />
          <Metric label="產能使用率" value={`${Math.round(snapshot.utilizationPercent)}%`} />
          <Metric label="製作中訂單" value={String(snapshot.orderCount)} />
          <Metric label="製作中品項" value={String(snapshot.itemCount)} />
        </div>
      </section>

      <details className="border-b border-stone-200 pb-6" open>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xl font-semibold"><TimerReset className="h-5 w-5 text-teal-700" />等候時間與容量門檻</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="計算視窗（分鐘）" min={5} max={120} value={settings.windowMinutes} onChange={(value) => updateNumber("windowMinutes", value)} />
          <NumberField label="每視窗訂單上限" min={1} max={1000} value={settings.maxOrdersPerWindow} onChange={(value) => updateNumber("maxOrdersPerWindow", value)} />
          <NumberField label="每視窗品項上限" min={1} max={5000} value={settings.maxItemsPerWindow} onChange={(value) => updateNumber("maxItemsPerWindow", value)} />
          <NumberField label="警示門檻（%）" min={1} max={99} value={settings.warningUtilizationPercent} onChange={(value) => updateNumber("warningUtilizationPercent", value)} />
          <NumberField label="自動暫停門檻（%）" min={2} max={200} value={settings.pauseUtilizationPercent} onChange={(value) => updateNumber("pauseUtilizationPercent", value)} />
          <NumberField label="預設製作時間（分鐘）" min={0} max={240} value={settings.defaultPrepMinutes} onChange={(value) => updateNumber("defaultPrepMinutes", value)} />
          <NumberField label="最短報價（分鐘）" min={0} max={240} value={settings.minimumQuoteMinutes} onChange={(value) => updateNumber("minimumQuoteMinutes", value)} />
          <NumberField label="最長報價（分鐘）" min={0} max={480} value={settings.maximumQuoteMinutes} onChange={(value) => updateNumber("maximumQuoteMinutes", value)} />
          <NumberField label="緩衝時間（分鐘）" min={0} max={60} value={settings.quoteBufferMinutes} onChange={(value) => updateNumber("quoteBufferMinutes", value)} />
          <NumberField label="需顧客確認門檻（分鐘）" min={1} max={480} value={settings.acknowledgmentThresholdMinutes} onChange={(value) => updateNumber("acknowledgmentThresholdMinutes", value)} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Toggle label="啟用容量計算" checked={settings.isActive} onChange={(isActive) => setSettings({ ...settings, isActive })} />
          <Toggle label="自動暫停" checked={settings.autoPauseEnabled} disabled={!data.capabilities.automaticControl} onChange={(autoPauseEnabled) => setSettings({ ...settings, autoPauseEnabled })} />
          <Toggle label="負載下降自動恢復" checked={settings.autoResumeEnabled} disabled={!data.capabilities.automaticControl} onChange={(autoResumeEnabled) => setSettings({ ...settings, autoResumeEnabled })} />
        </div>
        {!data.capabilities.automaticControl ? <p className="mt-3 text-sm text-stone-500">目前方案提供手動等候時間，但未包含自動容量控制。</p> : null}
        <button type="button" disabled={busy || !dirty} onClick={() => void saveSettings()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}儲存門檻</button>
      </details>

      <details className="border-b border-stone-200 pb-6" open>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xl font-semibold"><AlertTriangle className="h-5 w-5 text-teal-700" />現場覆寫</summary>
        <label className="mt-4 block text-sm font-medium">操作原因<input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="例如：人力不足、恢復正常" className="form-input mt-1" /></label>
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,240px)_1fr] sm:items-end">
          <label className="text-sm font-medium">手動等候時間（分鐘）<input type="number" min={0} max={480} value={manualWait} onChange={(event) => setManualWait(event.target.value)} placeholder="留空使用自動計算" className="form-input mt-1" /></label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void run({ operation: "SET_WAIT_OVERRIDE", minutes: manualWait === "" ? null : Number(manualWait), reason }, manualWait === "" ? "已恢復自動估算。" : "已更新手動等候時間。") } className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Save className="h-4 w-4" />套用等候時間</button>
            {paused ? <button type="button" disabled={busy} onClick={() => void run({ operation: "RESUME_ORDERING", reason }, "已恢復公開接單。") } className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white"><Play className="h-4 w-4" />恢復接單</button> : <button type="button" disabled={busy} onClick={() => void run({ operation: "PAUSE_ORDERING", reason }, "已暫停公開接單。") } className="inline-flex min-h-10 items-center gap-2 rounded-md bg-red-700 px-3 text-sm font-semibold text-white"><Pause className="h-4 w-4" />暫停接單</button>}
          </div>
        </div>
      </details>

      <details className="border-b border-stone-200 pb-6" open={data.capabilities.productRules}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xl font-semibold"><PackageOpen className="h-5 w-5 text-teal-700" />商品容量規則</summary>
        {!data.capabilities.productRules ? <p className="mt-3 text-sm text-stone-500">目前方案未包含各商品權重與時段數量上限。</p> : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <label className="text-sm font-medium lg:col-span-2">商品<select value={rule.productId} onChange={(event) => setRule({ ...rule, productId: event.target.value })} className="form-input mt-1"><option value="">請選擇</option>{data.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
              <TextNumberField label="產能權重" min={0.1} max={100} step={0.1} value={rule.capacityWeight} onChange={(capacityWeight) => setRule({ ...rule, capacityWeight })} />
              <TextNumberField label="製作分鐘" min={0} max={240} value={rule.prepMinutes} onChange={(prepMinutes) => setRule({ ...rule, prepMinutes })} />
              <TextNumberField label="視窗數量上限" min={1} max={5000} value={rule.maxQuantityPerWindow} placeholder="不限" onChange={(maxQuantityPerWindow) => setRule({ ...rule, maxQuantityPerWindow })} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3"><Toggle label="啟用規則" checked={rule.isActive} onChange={(isActive) => setRule({ ...rule, isActive })} /><button type="button" disabled={busy} onClick={() => void saveRule()} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white"><Save className="h-4 w-4" />儲存商品規則</button></div>
            <div className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
              {data.rules.length === 0 ? <p className="py-4 text-sm text-stone-500">尚未設定商品容量規則。</p> : data.rules.map((item) => (
                <div key={item.id} className="grid gap-3 py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div><div className="font-semibold">{item.productName}</div><div className="mt-1 text-xs text-stone-500">權重 {item.capacityWeight} · 製作 {item.prepMinutes} 分鐘 · {item.maxQuantityPerWindow ? `每視窗最多 ${item.maxQuantityPerWindow} 份` : "無單品上限"} · {item.isActive ? "啟用" : "停用"}</div></div>
                  <button type="button" onClick={() => editRule(item.productId)} className="min-h-9 rounded-md border border-stone-300 px-3 text-xs font-semibold">編輯</button>
                  <button type="button" title="刪除商品容量規則" onClick={() => void deleteRule(item.productId)} className="grid h-9 w-9 place-items-center rounded-md border border-red-300 text-red-700"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </>
        )}
      </details>

      <details className="border-b border-stone-200 pb-6">
        <summary className="min-h-11 cursor-pointer list-none text-xl font-semibold">最近容量事件</summary>
        <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
          {data.events.length === 0 ? <p className="py-4 text-sm text-stone-500">尚無容量事件。</p> : data.events.map((event) => <div key={event.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[160px_1fr_auto]"><span className="font-semibold">{eventLabel(event.eventType)}</span><span className="text-stone-600">{event.reason}</span><time dateTime={event.createdAt} className="text-xs text-stone-500">{formatTaipeiDateTime(event.createdAt)}</time></div>)}
        </div>
      </details>

      {message ? <p role="status" className={`text-sm font-medium ${/(無法|請選擇|失敗|未包含)/.test(message) ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border-r border-stone-200 px-3 last:border-r-0"><div className="text-xs text-stone-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>;
}

function NumberField({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (value: string) => void }) {
  return <label className="text-sm font-medium">{label}<input type="number" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} className="form-input mt-1" /></label>;
}

function TextNumberField({ label, min, max, step = 1, value, placeholder, onChange }: { label: string; min: number; max: number; step?: number; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return <label className="text-sm font-medium">{label}<input type="number" min={min} max={max} step={step} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="form-input mt-1" /></label>;
}

function Toggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`flex min-h-11 items-center justify-between gap-3 rounded-md border border-stone-300 px-3 text-sm font-medium ${disabled ? "opacity-50" : ""}`}><span>{label}</span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5" /></label>;
}

function eventLabel(eventType: string) {
  return ({
    CAPACITY_WARNING: "容量警示",
    AUTO_PAUSED: "自動暫停",
    AUTO_RESUMED: "自動恢復",
    MANUAL_OVERRIDE: "人工覆寫",
    WAIT_TIME_CHANGED: "等候時間變更",
  } as Record<string, string>)[eventType] ?? eventType;
}
