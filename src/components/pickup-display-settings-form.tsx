"use client";

import { useMemo, useState } from "react";
import {
  Copy,
  ExternalLink,
  LoaderCircle,
  MonitorUp,
  RotateCw,
  Save,
  ShieldX,
  Volume2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { csrfHeaders } from "@/lib/csrf-client";
import type { PickupDisplayManagerSettings } from "@/lib/pickup-display-contract";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

export function PickupDisplaySettingsForm({
  stallId,
  stallSlug,
  appUrl,
  initialSettings,
}: {
  stallId: string;
  stallSlug: string;
  appUrl: string;
  initialSettings: PickupDisplayManagerSettings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [displayToken, setDisplayToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const baseUrl = appUrl.replace(/\/$/, "");
  const publicUrl = `${baseUrl}/display/${encodeURIComponent(stallSlug)}`;
  const tokenUrl = displayToken
    ? `${baseUrl}/display/q/${encodeURIComponent(displayToken)}`
    : "";
  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [savedSettings, settings],
  );
  useUnsavedSettings("pickup-display", dirty);

  async function request(command: Record<string, unknown>) {
    const response = await fetch(`/api/merchant/stalls/${stallId}/display`, {
      method: "PATCH",
      headers: csrfHeaders(),
      body: JSON.stringify(command),
    });
    const payload = await response.json() as {
      error?: string;
      settings?: PickupDisplayManagerSettings;
      displayToken?: string;
    };
    if (!response.ok || !payload.settings) {
      throw new Error(payload.error ?? "無法儲存取餐顯示設定。");
    }
    return payload;
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const payload = await request({ operation: "UPDATE_SETTINGS", ...settings });
      setSettings(payload.settings!);
      setSavedSettings(payload.settings!);
      setMessage("取餐顯示設定已儲存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法儲存取餐顯示設定。");
    } finally {
      setBusy(false);
    }
  }

  async function rotateToken() {
    setBusy(true);
    setMessage("");
    try {
      const payload = await request({ operation: "ROTATE_TOKEN" });
      setDisplayToken(payload.displayToken ?? "");
      setSettings((current) => ({ ...current, tokenConfigured: true }));
      setSavedSettings((current) => ({ ...current, tokenConfigured: true }));
      setMessage("顯示 Token 已輪替，舊連結已失效。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法輪替顯示 Token。");
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken() {
    if (!window.confirm("確定要撤銷取餐顯示 Token？現有 Token 連結將立即失效。")) return;
    setBusy(true);
    setMessage("");
    try {
      await request({ operation: "REVOKE_TOKEN" });
      setDisplayToken("");
      setSettings((current) => ({ ...current, tokenConfigured: false }));
      setSavedSettings((current) => ({ ...current, tokenConfigured: false }));
      setMessage("顯示 Token 已撤銷。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法撤銷顯示 Token。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="border-y border-stone-200 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold"><MonitorUp className="h-5 w-5 text-teal-700" />公開顯示</h2>
            <p className="mt-1 text-sm text-stone-600">{settings.isActive ? "顯示中" : "已停用"}</p>
          </div>
          <Toggle label="啟用取餐顯示" checked={settings.isActive} onChange={(isActive) => setSettings({ ...settings, isActive })} />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <label className="text-sm font-medium">公開網址<div className="mt-1 flex gap-2"><input type="text" readOnly value={publicUrl} className="form-input min-w-0 flex-1 bg-stone-50" /><CopyButton value={publicUrl} label="複製公開網址" /></div></label>
          <div className="flex items-center gap-3">
            <QRCodeSVG value={publicUrl} size={88} level="M" />
            <a href={publicUrl} target="_blank" rel="noreferrer" className="grid h-11 w-11 place-items-center rounded-md border border-stone-300" title="預覽公開顯示"><ExternalLink className="h-4 w-4" /></a>
          </div>
        </div>
      </section>

      <section className="border-b border-stone-200 pb-7">
        <h2 className="text-xl font-semibold">顯示內容</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Toggle label="顯示顧客名稱" checked={settings.showCustomerName} onChange={(showCustomerName) => setSettings({ ...settings, showCustomerName })} />
          <Toggle label="顯示取餐碼" checked={settings.showPickupCode} onChange={(showPickupCode) => setSettings({ ...settings, showPickupCode })} />
          <Toggle label="遮罩取餐碼" checked={settings.maskPickupCode} disabled={!settings.showPickupCode} onChange={(maskPickupCode) => setSettings({ ...settings, maskPickupCode })} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberField label="製作中保留時間（分鐘）" min={15} max={1440} value={settings.preparingRetentionMinutes} onChange={(preparingRetentionMinutes) => setSettings({ ...settings, preparingRetentionMinutes })} />
          <NumberField label="可取餐保留時間（分鐘）" min={1} max={240} value={settings.readyRetentionMinutes} onChange={(readyRetentionMinutes) => setSettings({ ...settings, readyRetentionMinutes })} />
        </div>
      </section>

      <section className="border-b border-stone-200 pb-7">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><Volume2 className="h-5 w-5 text-teal-700" />語音與跑馬公告</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Toggle label="啟用完成語音" checked={settings.enableVoice} disabled={!settings.voiceAvailable} onChange={(enableVoice) => setSettings({ ...settings, enableVoice })} />
          <label className="text-sm font-medium">語音語系<input type="text" value={settings.voiceLocale} maxLength={35} onChange={(event) => setSettings({ ...settings, voiceLocale: event.target.value })} className="form-input mt-1" /></label>
          <label className="text-sm font-medium sm:col-span-2">公告內容<input type="text" value={settings.announcementText} maxLength={300} onChange={(event) => setSettings({ ...settings, announcementText: event.target.value })} className="form-input mt-1" /></label>
        </div>
        {!settings.voiceAvailable ? <p className="mt-3 text-sm text-stone-500">目前方案未包含語音播報。</p> : null}
      </section>

      <section className="border-b border-stone-200 pb-7">
        <h2 className="text-xl font-semibold">品牌外觀</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">自訂標誌網址<input type="text" value={settings.theme.logoUrl} maxLength={2000} onChange={(event) => setSettings({ ...settings, theme: { ...settings.theme, logoUrl: event.target.value } })} className="form-input mt-1" /></label>
          <label className="text-sm font-medium">背景圖片網址<input type="text" value={settings.theme.backgroundImageUrl} maxLength={2000} onChange={(event) => setSettings({ ...settings, theme: { ...settings.theme, backgroundImageUrl: event.target.value } })} className="form-input mt-1" /></label>
          <label className="text-sm font-medium">主色<div className="mt-1 flex h-11 items-center gap-3 rounded-md border border-stone-300 bg-white px-3"><input type="color" value={settings.theme.accentColor} onChange={(event) => setSettings({ ...settings, theme: { ...settings.theme, accentColor: event.target.value } })} className="h-7 w-9 cursor-pointer border-0 bg-transparent p-0" /><span className="font-mono text-xs">{settings.theme.accentColor}</span></div></label>
        </div>
      </section>

      <section className="border-b border-stone-200 pb-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold">Token 顯示連結</h2><p className="mt-1 text-sm text-stone-600">{settings.tokenConfigured ? "已設定" : "尚未設定"}</p></div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void rotateToken()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50"><RotateCw className="h-4 w-4" />輪替 Token</button>
            <button type="button" disabled={busy || !settings.tokenConfigured} onClick={() => void revokeToken()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-50"><ShieldX className="h-4 w-4" />撤銷</button>
          </div>
        </div>
        {tokenUrl ? <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center"><label className="text-sm font-medium">新 Token 網址<div className="mt-1 flex gap-2"><input type="text" readOnly value={tokenUrl} className="form-input min-w-0 flex-1 bg-stone-50" /><CopyButton value={tokenUrl} label="複製 Token 網址" /></div></label><QRCodeSVG value={tokenUrl} size={88} level="M" /></div> : null}
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}儲存設定
        </button>
        {message ? <p role="status" className="text-sm font-medium text-stone-700">{message}</p> : null}
      </div>
    </div>
  );
}

function Toggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`flex min-h-12 items-center rounded-md border px-3 text-left text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-600"}`}><span>{label}</span><span className="ml-auto text-xs">{checked ? "開啟" : "關閉"}</span></button>;
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="text-sm font-medium">{label}<input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="form-input mt-1" /></label>;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return <button type="button" title={label} onClick={() => void navigator.clipboard.writeText(value)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300"><Copy className="h-4 w-4" /></button>;
}
