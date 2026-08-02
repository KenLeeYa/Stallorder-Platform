"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, Power, Save } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
} from "@/lib/form-field-errors";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

type ManagerData = {
  configured: boolean;
  integrationId: string | null;
  status: "DISABLED" | "ACTIVE" | "ERROR";
  channelId: string;
  settings: {
    displayName: string;
    officialAccountUrl: string;
    notifyConfirmed: boolean;
    notifyReady: boolean;
    notifyCancelled: boolean;
  };
  updatedAt: string | null;
};

type SecretDraft = {
  channelAccessToken: string;
  messagingChannelSecret: string;
  loginChannelSecret: string;
};

const emptySecrets: SecretDraft = {
  channelAccessToken: "",
  messagingChannelSecret: "",
  loginChannelSecret: "",
};

export function LineIntegrationManager({
  stallId,
  appUrl,
  initialData,
}: {
  stallId: string;
  appUrl: string;
  initialData: ManagerData;
}) {
  const [data, setData] = useState(initialData);
  const [channelId, setChannelId] = useState(initialData.channelId);
  const [settings, setSettings] = useState(initialData.settings);
  const [savedSettings, setSavedSettings] = useState(initialData.settings);
  const [secrets, setSecrets] = useState<SecretDraft>(emptySecrets);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showDisable, setShowDisable] = useState(false);
  const [disableReason, setDisableReason] = useState("");
  const managerRef = useRef<HTMLDivElement>(null);
  const dirty = useMemo(() => (
    channelId !== data.channelId
    || JSON.stringify(settings) !== JSON.stringify(savedSettings)
    || Object.values(secrets).some(Boolean)
  ), [channelId, data.channelId, savedSettings, secrets, settings]);
  useUnsavedSettings("line-integration-settings", dirty);
  const webhookUrl = data.integrationId
    ? `${appUrl}/api/webhooks/line/${data.integrationId}`
    : "";

  function clearFieldError(field: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
  }

  async function save() {
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/line`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "UPSERT", channelId, ...secrets, ...settings }),
      });
      const payload = await response.json() as ManagerData & { error?: string; fieldErrors?: unknown };
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(payload.fieldErrors);
        setFieldErrors(nextFieldErrors);
        setMessage(payload.error ?? "無法儲存 LINE 整合設定。");
        setHasError(true);
        focusFirstInvalidField(managerRef.current, nextFieldErrors);
        return;
      }
      setData(payload);
      setChannelId(payload.channelId);
      setSettings(payload.settings);
      setSavedSettings(payload.settings);
      setSecrets(emptySecrets);
      setMessage("LINE 整合與新憑證已安全儲存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法儲存 LINE 整合設定。");
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!window.confirm("確定停用 LINE 訂單通知？尚未傳送的通知會一併取消。")) return;
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/line`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "DISABLE", reason: disableReason }),
      });
      const payload = await response.json() as ManagerData & { error?: string; fieldErrors?: unknown };
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(payload.fieldErrors);
        setFieldErrors(nextFieldErrors);
        setMessage(payload.error ?? "無法停用 LINE 整合。");
        setHasError(true);
        focusFirstInvalidField(managerRef.current, nextFieldErrors);
        return;
      }
      setData(payload);
      setChannelId("");
      setSecrets(emptySecrets);
      setDisableReason("");
      setShowDisable(false);
      setMessage("LINE 整合已停用，既有憑證已從 Vault 移除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法停用 LINE 整合。");
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  async function copyWebhook() {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div ref={managerRef} className="space-y-8">
      <section className="border-y border-stone-200 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">整合狀態</h2><p className="mt-1 text-sm text-stone-600">{data.status === "ACTIVE" ? "已啟用" : data.status === "ERROR" ? "需要檢查" : "未啟用"}</p></div>
          <span className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold ${data.status === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-700"}`}><span className={`h-2.5 w-2.5 rounded-full ${data.status === "ACTIVE" ? "bg-emerald-600" : "bg-stone-400"}`} />{data.status === "ACTIVE" ? "啟用" : "停用"}</span>
        </div>
        {webhookUrl ? <div className="mt-5"><label className="text-sm font-medium" htmlFor="line-webhook-url">Webhook URL</label><div className="mt-2 flex gap-2"><input type="text" id="line-webhook-url" readOnly value={webhookUrl} className="min-h-11 min-w-0 flex-1 rounded-md border border-stone-300 bg-stone-50 px-3 text-sm" /><button type="button" title="複製 Webhook URL" aria-label="複製 Webhook URL" onClick={() => void copyWebhook()} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300">{copied ? <Check className="h-4 w-4 text-emerald-700" /> : <Copy className="h-4 w-4" />}</button></div></div> : null}
      </section>

      <section>
        <h2 className="text-lg font-semibold">LINE Channel</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="LINE Login Channel ID" field="channelId" error={fieldErrors.channelId}><input {...validationProps("channelId", fieldErrors.channelId)} type="text" value={channelId} onChange={(event) => { clearFieldError("channelId"); setChannelId(event.target.value.slice(0, 30)); }} inputMode="numeric" autoComplete="off" minLength={5} maxLength={30} pattern="[0-9]{5,30}" className={inputClass(fieldErrors.channelId)} /></Field>
          <Field label="顯示名稱" field="displayName" error={fieldErrors.displayName}><input {...validationProps("displayName", fieldErrors.displayName)} type="text" value={settings.displayName} onChange={(event) => { clearFieldError("displayName"); setSettings((current) => ({ ...current, displayName: event.target.value })); }} maxLength={80} className={inputClass(fieldErrors.displayName)} /></Field>
          <Field label="LINE 官方帳號網址（選填）" field="officialAccountUrl" error={fieldErrors.officialAccountUrl}><input {...validationProps("officialAccountUrl", fieldErrors.officialAccountUrl)} value={settings.officialAccountUrl} onChange={(event) => { clearFieldError("officialAccountUrl"); setSettings((current) => ({ ...current, officialAccountUrl: event.target.value })); }} type="url" maxLength={500} placeholder="https://lin.ee/..." className={inputClass(fieldErrors.officialAccountUrl)} /></Field>
        </div>
      </section>

      <section className="border-y border-stone-200 py-5">
        <h2 className="text-lg font-semibold">Vault 憑證</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Messaging API Channel Access Token" field="channelAccessToken" error={fieldErrors.channelAccessToken}><SecretInput field="channelAccessToken" error={fieldErrors.channelAccessToken} value={secrets.channelAccessToken} maxLength={4096} onChange={(value) => { clearFieldError("channelAccessToken"); setSecrets((current) => ({ ...current, channelAccessToken: value })); }} /></Field>
          <Field label="Messaging API Channel Secret" field="messagingChannelSecret" error={fieldErrors.messagingChannelSecret}><SecretInput field="messagingChannelSecret" error={fieldErrors.messagingChannelSecret} value={secrets.messagingChannelSecret} maxLength={256} onChange={(value) => { clearFieldError("messagingChannelSecret"); setSecrets((current) => ({ ...current, messagingChannelSecret: value })); }} /></Field>
          <Field label="LINE Login Channel Secret" field="loginChannelSecret" error={fieldErrors.loginChannelSecret}><SecretInput field="loginChannelSecret" error={fieldErrors.loginChannelSecret} value={secrets.loginChannelSecret} maxLength={256} onChange={(value) => { clearFieldError("loginChannelSecret"); setSecrets((current) => ({ ...current, loginChannelSecret: value })); }} /></Field>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">通知事件</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Toggle label="訂單已確認" checked={settings.notifyConfirmed} onChange={(checked) => setSettings((current) => ({ ...current, notifyConfirmed: checked }))} />
          <Toggle label="餐點可取餐" checked={settings.notifyReady} onChange={(checked) => setSettings((current) => ({ ...current, notifyReady: checked }))} />
          <Toggle label="訂單已取消" checked={settings.notifyCancelled} onChange={(checked) => setSettings((current) => ({ ...current, notifyCancelled: checked }))} />
        </div>
      </section>

      {message ? <p role={hasError ? "alert" : "status"} className={`rounded-md border p-3 text-sm ${hasError ? "border-red-200 bg-red-50 text-red-800" : "border-stone-200 bg-stone-50"}`}>{message}</p> : null}
      <div className="flex flex-wrap gap-3 border-t border-stone-200 pt-5">
        <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}儲存並輪替憑證</button>
        {data.configured && !showDisable ? <button type="button" onClick={() => setShowDisable(true)} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-40"><Power className="h-4 w-4" />停用整合</button> : null}
      </div>
      {data.configured && showDisable ? <section className="grid gap-3 border-l-2 border-red-400 pl-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"><Field label="停用原因" field="reason" error={fieldErrors.reason}><input {...validationProps("reason", fieldErrors.reason)} type="text" value={disableReason} minLength={2} maxLength={200} onChange={(event) => { clearFieldError("reason"); setDisableReason(event.target.value); }} className={inputClass(fieldErrors.reason)} /></Field><button type="button" disabled={busy} onClick={() => void disable()} className="min-h-11 rounded-md bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-40">確認停用</button><button type="button" disabled={busy} onClick={() => { setShowDisable(false); setDisableReason(""); clearFieldError("reason"); }} className="min-h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold">取消</button></section> : null}
    </div>
  );
}
function Field({ label, field, error, children }: { label: string; field: string; error?: string; children: React.ReactNode }) {
  return <label className="text-sm font-medium text-stone-800">{label}{children}{error ? <span id={fieldErrorId(field)} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}

function SecretInput({ field, error, value, maxLength, onChange }: { field: string; error?: string; value: string; maxLength: number; onChange: (value: string) => void }) {
  return <input {...validationProps(field, error)} type="password" value={value} minLength={16} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} autoComplete="new-password" className={inputClass(error)} />;
}

function validationProps(field: string, error?: string) {
  return { "data-field-key": field, "aria-invalid": error ? true : undefined, "aria-describedby": error ? fieldErrorId(field) : undefined };
}

function fieldErrorId(field: string) {
  return `line-integration-${field}-error`;
}

function inputClass(error?: string) {
  return `mt-1 min-h-11 w-full rounded-md border px-3 ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex min-h-12 items-center gap-3 rounded-md border border-stone-300 px-3 text-sm font-semibold"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5" />{label}</label>;
}
