"use client";

import { useMerchantMessages } from "@/lib/messages/merchant-client";
import { useMemo, useRef, useState } from "react";
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
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
} from "@/lib/form-field-errors";
import {
  normalizePickupDisplayManagerCapabilities,
  type PickupDisplayManagerSettings,
} from "@/lib/pickup-display-contract";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

type EditableSettings = Omit<PickupDisplayManagerSettings, "preparingRetentionMinutes" | "readyRetentionMinutes"> & {
  preparingRetentionMinutes: number | string;
  readyRetentionMinutes: number | string;
};

function mergeManagerCapabilities(
  current: EditableSettings,
  latest: PickupDisplayManagerSettings,
): EditableSettings {
  const normalized = normalizePickupDisplayManagerCapabilities(latest);
  return {
    ...current,
    tokenConfigured: normalized.tokenConfigured,
    voiceAvailable: normalized.voiceAvailable,
    enableVoice: normalized.voiceAvailable && current.enableVoice,
  };
}

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
  const { label } = useMerchantMessages();
  const [settings, setSettings] = useState<EditableSettings>(() => (
    normalizePickupDisplayManagerCapabilities(initialSettings)
  ));
  const [savedSettings, setSavedSettings] = useState<EditableSettings>(() => (
    normalizePickupDisplayManagerCapabilities(initialSettings)
  ));
  const [displayToken, setDisplayToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLDivElement>(null);
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

  function clearFieldError(field: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
  }

  async function request(command: Record<string, unknown>) {
    const response = await fetch(`/api/merchant/stalls/${stallId}/display`, {
      method: "PATCH",
      headers: csrfHeaders(),
      body: JSON.stringify(command),
    });
    const payload = await response.json() as {
      error?: string;
      fieldErrors?: unknown;
      settings?: PickupDisplayManagerSettings;
      displayToken?: string;
    };
    if (!response.ok || !payload.settings) {
      const error = new Error(payload.error ?? label("無法儲存取餐顯示設定。")) as Error & { fieldErrors?: unknown };
      error.fieldErrors = payload.fieldErrors;
      throw error;
    }
    return payload;
  }

  async function save() {
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const payload = await request({
        operation: "UPDATE_SETTINGS",
        ...settings,
        enableVoice: settings.voiceAvailable && settings.enableVoice,
        preparingRetentionMinutes: numberOrOriginal(settings.preparingRetentionMinutes),
        readyRetentionMinutes: numberOrOriginal(settings.readyRetentionMinutes),
      });
      const nextSettings = normalizePickupDisplayManagerCapabilities(payload.settings!);
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      setMessage(label("取餐顯示設定已儲存。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("無法儲存取餐顯示設定。"));
      setHasError(true);
      const nextFieldErrors = parseFieldErrors(error instanceof Error && "fieldErrors" in error ? error.fieldErrors : undefined);
      setFieldErrors(nextFieldErrors);
      focusFirstInvalidField(formRef.current, nextFieldErrors);
    } finally {
      setBusy(false);
    }
  }

  async function rotateToken() {
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const payload = await request({ operation: "ROTATE_TOKEN" });
      setDisplayToken(payload.displayToken ?? "");
      setSettings((current) => mergeManagerCapabilities(current, payload.settings!));
      setSavedSettings((current) => mergeManagerCapabilities(current, payload.settings!));
      setMessage(label("顯示 Token 已輪替，舊連結已失效。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("無法輪替顯示 Token。"));
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken() {
    if (!window.confirm(label("確定要撤銷取餐顯示 Token？現有 Token 連結將立即失效。"))) return;
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const payload = await request({ operation: "REVOKE_TOKEN" });
      setDisplayToken("");
      setSettings((current) => mergeManagerCapabilities(current, payload.settings!));
      setSavedSettings((current) => mergeManagerCapabilities(current, payload.settings!));
      setMessage(label("顯示 Token 已撤銷。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("無法撤銷顯示 Token。"));
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={formRef} className="space-y-8">
      <section className="border-y border-stone-200 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold"><MonitorUp className="h-5 w-5 text-teal-700" />{label("公開顯示")}</h2>
            <p className="mt-1 text-sm text-stone-600">{settings.isActive ? label("顯示中") : label("已停用")}</p>
          </div>
          <Toggle label={label("啟用取餐顯示")} fieldKey="isActive" error={fieldErrors.isActive} checked={settings.isActive} onChange={(isActive) => { clearFieldError("isActive"); setSettings({ ...settings, isActive }); }} />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <label className="text-sm font-medium">{label("公開網址")}<div className="mt-1 flex gap-2"><input type="text" readOnly value={publicUrl} className="form-input min-w-0 flex-1 bg-stone-50" /><CopyButton value={publicUrl} label={label("複製公開網址")} /></div></label>
          <div className="flex items-center gap-3">
            <QRCodeSVG value={publicUrl} size={88} level="M" />
            <a href={publicUrl} target="_blank" rel="noreferrer" className="grid h-11 w-11 place-items-center rounded-md border border-stone-300" title={label("預覽公開顯示")}><ExternalLink className="h-4 w-4" /></a>
          </div>
        </div>
      </section>

      <section className="border-b border-stone-200 pb-7">
        <h2 className="text-xl font-semibold">{label("顯示內容")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Toggle label={label("顯示顧客名稱")} checked={settings.showCustomerName} onChange={(showCustomerName) => setSettings({ ...settings, showCustomerName })} />
          <Toggle label={label("顯示取餐碼")} checked={settings.showPickupCode} onChange={(showPickupCode) => setSettings({ ...settings, showPickupCode })} />
          <Toggle label={label("遮罩取餐碼")} checked={settings.maskPickupCode} disabled={!settings.showPickupCode} onChange={(maskPickupCode) => setSettings({ ...settings, maskPickupCode })} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberField label={label("製作中保留時間（分鐘）")} fieldKey="preparingRetentionMinutes" error={fieldErrors.preparingRetentionMinutes} min={15} max={1440} value={settings.preparingRetentionMinutes} onChange={(preparingRetentionMinutes) => { clearFieldError("preparingRetentionMinutes"); setSettings({ ...settings, preparingRetentionMinutes }); }} />
          <NumberField label={label("可取餐保留時間（分鐘）")} fieldKey="readyRetentionMinutes" error={fieldErrors.readyRetentionMinutes} min={1} max={240} value={settings.readyRetentionMinutes} onChange={(readyRetentionMinutes) => { clearFieldError("readyRetentionMinutes"); setSettings({ ...settings, readyRetentionMinutes }); }} />
        </div>
      </section>

      <section className="border-b border-stone-200 pb-7">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><Volume2 className="h-5 w-5 text-teal-700" />{label("語音與跑馬公告")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Toggle label={label("啟用完成語音")} fieldKey="enableVoice" error={fieldErrors.enableVoice} checked={settings.voiceAvailable && settings.enableVoice} disabled={!settings.voiceAvailable} onChange={(enableVoice) => { clearFieldError("enableVoice"); setSettings({ ...settings, enableVoice }); }} />
          <TextField label={label("語音語系")} fieldKey="voiceLocale" error={fieldErrors.voiceLocale} value={settings.voiceLocale} maxLength={35} onChange={(voiceLocale) => { clearFieldError("voiceLocale"); setSettings({ ...settings, voiceLocale }); }} />
          <TextField label={label("公告內容")} fieldKey="announcementText" error={fieldErrors.announcementText} value={settings.announcementText} maxLength={300} full onChange={(announcementText) => { clearFieldError("announcementText"); setSettings({ ...settings, announcementText }); }} />
        </div>
        {!settings.voiceAvailable ? <p className="mt-3 text-sm text-stone-500">{label("目前方案未包含語音播報。")}</p> : null}
      </section>

      <section className="border-b border-stone-200 pb-7">
        <h2 className="text-xl font-semibold">{label("品牌外觀")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField label={label("自訂標誌網址")} fieldKey="logoUrl" error={fieldErrors.logoUrl} value={settings.theme.logoUrl} maxLength={2000} onChange={(logoUrl) => { clearFieldError("logoUrl"); setSettings({ ...settings, theme: { ...settings.theme, logoUrl } }); }} />
          <TextField label={label("背景圖片網址")} fieldKey="backgroundImageUrl" error={fieldErrors.backgroundImageUrl} value={settings.theme.backgroundImageUrl} maxLength={2000} onChange={(backgroundImageUrl) => { clearFieldError("backgroundImageUrl"); setSettings({ ...settings, theme: { ...settings.theme, backgroundImageUrl } }); }} />
          <label className="text-sm font-medium">{label("主色")}<div className={`mt-1 flex h-11 items-center gap-3 rounded-md border bg-white px-3 ${fieldErrors.accentColor ? "border-red-500 bg-red-50" : "border-stone-300"}`}><input type="color" value={settings.theme.accentColor} data-field-key="accentColor" aria-invalid={Boolean(fieldErrors.accentColor)} aria-describedby={fieldErrors.accentColor ? "pickup-display-accentColor-error" : undefined} onChange={(event) => { clearFieldError("accentColor"); setSettings({ ...settings, theme: { ...settings.theme, accentColor: event.target.value } }); }} className="h-7 w-9 cursor-pointer border-0 bg-transparent p-0" /><span className="font-mono text-xs">{settings.theme.accentColor}</span></div>{fieldErrors.accentColor ? <FieldError fieldKey="accentColor" error={fieldErrors.accentColor} /> : null}</label>
        </div>
      </section>

      <section className="border-b border-stone-200 pb-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold">{label("Token 顯示連結")}</h2><p className="mt-1 text-sm text-stone-600">{settings.tokenConfigured ? label("已設定") : label("尚未設定")}</p></div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void rotateToken()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50"><RotateCw className="h-4 w-4" />{label("輪替 Token")}</button>
            <button type="button" disabled={busy || !settings.tokenConfigured} onClick={() => void revokeToken()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-50"><ShieldX className="h-4 w-4" />{label("撤銷")}</button>
          </div>
        </div>
        {tokenUrl ? <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center"><label className="text-sm font-medium">{label("新 Token 網址")}<div className="mt-1 flex gap-2"><input type="text" readOnly value={tokenUrl} className="form-input min-w-0 flex-1 bg-stone-50" /><CopyButton value={tokenUrl} label={label("複製 Token 網址")} /></div></label><QRCodeSVG value={tokenUrl} size={88} level="M" /></div> : null}
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{label("儲存設定")}
        </button>
        {message ? <p role={hasError ? "alert" : "status"} className={`text-sm font-medium ${hasError ? "text-red-700" : "text-stone-700"}`}>{message}</p> : null}
      </div>
    </div>
  );
}

function Toggle({ label, fieldKey, error, checked, disabled = false, onChange }: { label: string; fieldKey?: string; error?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const { label: translateLabel } = useMerchantMessages();
  const errorId = fieldKey ? fieldErrorId(fieldKey) : undefined;
  return <div><button type="button" role="switch" aria-checked={checked} data-field-key={fieldKey} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} disabled={disabled} onClick={() => onChange(!checked)} className={`flex min-h-12 w-full items-center rounded-md border px-3 text-left text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${error ? "border-red-500 bg-red-50" : checked ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-600"}`}><span>{label}</span><span className="ml-auto text-xs">{checked ? translateLabel("開啟") : translateLabel("關閉")}</span></button>{fieldKey && error ? <FieldError fieldKey={fieldKey} error={error} /> : null}</div>;
}

function NumberField({ label, fieldKey, error, value, min, max, onChange }: { label: string; fieldKey: string; error?: string; value: number | string; min: number; max: number; onChange: (value: string) => void }) {
  return <label className="text-sm font-medium">{label}<input type="number" min={min} max={max} value={value} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error ? fieldErrorId(fieldKey) : undefined} onChange={(event) => onChange(event.target.value)} className={`form-input mt-1 ${error ? "border-red-500 bg-red-50" : ""}`} />{error ? <FieldError fieldKey={fieldKey} error={error} /> : null}</label>;
}

function TextField({ label, fieldKey, error, value, maxLength, full = false, onChange }: { label: string; fieldKey: string; error?: string; value: string; maxLength: number; full?: boolean; onChange: (value: string) => void }) {
  return <label className={`text-sm font-medium ${full ? "sm:col-span-2" : ""}`}>{label}<input type="text" value={value} maxLength={maxLength} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error ? fieldErrorId(fieldKey) : undefined} onChange={(event) => onChange(event.target.value)} className={`form-input mt-1 ${error ? "border-red-500 bg-red-50" : ""}`} />{error ? <FieldError fieldKey={fieldKey} error={error} /> : null}</label>;
}

function FieldError({ fieldKey, error }: { fieldKey: string; error: string }) {
  return <span id={fieldErrorId(fieldKey)} role="alert" className="mt-1 block text-xs text-red-700">{error}</span>;
}

function fieldErrorId(field: string) {
  return `pickup-display-${field}-error`;
}

function numberOrOriginal(value: number | string) {
  if (typeof value === "number") return value;
  return value.trim() === "" ? value : Number(value);
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return <button type="button" title={label} onClick={() => void navigator.clipboard.writeText(value)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300"><Copy className="h-4 w-4" /></button>;
}
