"use client";

import { useMemo, useState } from "react";
import { Check, Copy, LoaderCircle, Power, Save } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
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
  const dirty = useMemo(() => (
    channelId !== data.channelId
    || JSON.stringify(settings) !== JSON.stringify(savedSettings)
    || Object.values(secrets).some(Boolean)
  ), [channelId, data.channelId, savedSettings, secrets, settings]);
  useUnsavedSettings("line-integration-settings", dirty);
  const webhookUrl = data.integrationId
    ? `${appUrl}/api/webhooks/line/${data.integrationId}`
    : "";

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/line`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "UPSERT", channelId, ...secrets, ...settings }),
      });
      const payload = await response.json() as ManagerData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "無法儲存 LINE 整合設定。");
      setData(payload);
      setChannelId(payload.channelId);
      setSettings(payload.settings);
      setSavedSettings(payload.settings);
      setSecrets(emptySecrets);
      setMessage("LINE 整合與新憑證已安全儲存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法儲存 LINE 整合設定。");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!window.confirm("確定停用 LINE 訂單通知？尚未傳送的通知會一併取消。")) return;
    const reason = window.prompt("請輸入停用原因。", "暫停使用 LINE 通知")?.trim();
    if (!reason) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/line`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "DISABLE", reason }),
      });
      const payload = await response.json() as ManagerData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "無法停用 LINE 整合。");
      setData(payload);
      setChannelId("");
      setSecrets(emptySecrets);
      setMessage("LINE 整合已停用，既有憑證已從 Vault 移除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法停用 LINE 整合。");
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
    <div className="space-y-8">
      <section className="border-y border-stone-200 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">整合狀態</h2><p className="mt-1 text-sm text-stone-600">{data.status === "ACTIVE" ? "已啟用" : data.status === "ERROR" ? "需要檢查" : "未啟用"}</p></div>
          <span className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold ${data.status === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-700"}`}><span className={`h-2.5 w-2.5 rounded-full ${data.status === "ACTIVE" ? "bg-emerald-600" : "bg-stone-400"}`} />{data.status === "ACTIVE" ? "啟用" : "停用"}</span>
        </div>
        {webhookUrl ? <div className="mt-5"><label className="text-sm font-medium" htmlFor="line-webhook-url">Webhook URL</label><div className="mt-2 flex gap-2"><input id="line-webhook-url" readOnly value={webhookUrl} className="min-h-11 min-w-0 flex-1 rounded-md border border-stone-300 bg-stone-50 px-3 text-sm" /><button type="button" title="複製 Webhook URL" aria-label="複製 Webhook URL" onClick={() => void copyWebhook()} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300">{copied ? <Check className="h-4 w-4 text-emerald-700" /> : <Copy className="h-4 w-4" />}</button></div></div> : null}
      </section>

      <section>
        <h2 className="text-lg font-semibold">LINE Channel</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="LINE Login Channel ID"><input value={channelId} onChange={(event) => setChannelId(event.target.value)} inputMode="numeric" autoComplete="off" className="mt-1 min-h-11 w-full rounded-md border border-stone-300 px-3" /></Field>
          <Field label="顯示名稱"><input value={settings.displayName} onChange={(event) => setSettings((current) => ({ ...current, displayName: event.target.value }))} maxLength={80} className="mt-1 min-h-11 w-full rounded-md border border-stone-300 px-3" /></Field>
          <Field label="LINE 官方帳號網址（選填）"><input value={settings.officialAccountUrl} onChange={(event) => setSettings((current) => ({ ...current, officialAccountUrl: event.target.value }))} type="url" placeholder="https://lin.ee/..." className="mt-1 min-h-11 w-full rounded-md border border-stone-300 px-3" /></Field>
        </div>
      </section>

      <section className="border-y border-stone-200 py-5">
        <h2 className="text-lg font-semibold">Vault 憑證</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Messaging API Channel Access Token"><SecretInput value={secrets.channelAccessToken} onChange={(value) => setSecrets((current) => ({ ...current, channelAccessToken: value }))} /></Field>
          <Field label="Messaging API Channel Secret"><SecretInput value={secrets.messagingChannelSecret} onChange={(value) => setSecrets((current) => ({ ...current, messagingChannelSecret: value }))} /></Field>
          <Field label="LINE Login Channel Secret"><SecretInput value={secrets.loginChannelSecret} onChange={(value) => setSecrets((current) => ({ ...current, loginChannelSecret: value }))} /></Field>
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

      {message ? <p role="status" className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">{message}</p> : null}
      <div className="flex flex-wrap gap-3 border-t border-stone-200 pt-5">
        <button type="button" onClick={() => void save()} disabled={busy || !channelId || Object.values(secrets).some((value) => value.length < 16)} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}儲存並輪替憑證</button>
        {data.configured ? <button type="button" onClick={() => void disable()} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-40"><Power className="h-4 w-4" />停用整合</button> : null}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm font-medium text-stone-800">{label}{children}</label>;
}

function SecretInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input type="password" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="new-password" className="mt-1 min-h-11 w-full rounded-md border border-stone-300 px-3" />;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex min-h-12 items-center gap-3 rounded-md border border-stone-300 px-3 text-sm font-semibold"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5" />{label}</label>;
}
