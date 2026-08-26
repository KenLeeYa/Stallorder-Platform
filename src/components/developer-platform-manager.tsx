"use client";

import { type FormEvent, useState } from "react";
import { AlertTriangle, Braces, Copy, KeyRound, LoaderCircle, RotateCw, Webhook } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { parseFieldErrors } from "@/lib/form-field-errors";
import type { getDeveloperPlatformDashboard } from "@/server/developer-platform/developer-service";

type Dashboard = Awaited<ReturnType<typeof getDeveloperPlatformDashboard>>;

const scopeLabels: Record<string, string> = {
  "catalog:read": "讀取商品目錄",
  "orders:read": "讀取訂單",
  "customers:read": "讀取授權顧客資料",
  "inventory:read": "讀取庫存",
  "webhooks:write": "管理 Webhook",
};

const eventLabels: Record<string, string> = {
  CATALOG_PUBLISHED: "菜單已發布",
  ORDER_CREATED: "訂單已建立",
  ORDER_CONFIRMED: "訂單已確認",
  ORDER_COMPLETED: "訂單已完成",
  ORDER_CANCELLED: "訂單已取消",
  INVENTORY_LOW: "低庫存",
};

export function DeveloperPlatformManager({ organizationId, initialDashboard }: { organizationId: string; initialDashboard: Dashboard }) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [oneTimeSecret, setOneTimeSecret] = useState("");
  const [secretKind, setSecretKind] = useState<string | null>(null);

  async function sendCommand(command: Record<string, unknown>, successMessage: string) {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    setFieldErrors({});
    setOneTimeSecret("");
    setSecretKind(null);
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/developer`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as Dashboard & { error?: string; fieldErrors?: unknown; oneTimeSecret?: string | null; secretKind?: string | null };
      if (!response.ok || payload.error) {
        setMessage(payload.error ?? "目前無法更新開發者整合。");
        setFieldErrors(parseFieldErrors(payload.fieldErrors));
        return false;
      }
      setDashboard(payload);
      setOneTimeSecret(payload.oneTimeSecret ?? "");
      setSecretKind(payload.secretKind ?? null);
      setMessage(successMessage);
      return true;
    } catch {
      setMessage("網路連線中斷，請稍後再試。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await sendCommand({
      operation: "CREATE_API_KEY",
      name: data.get("name"),
      scopes: data.getAll("scopes"),
      stallIds: [],
      expiresAt: data.get("expiresAt") ? new Date(String(data.get("expiresAt"))).toISOString() : null,
    }, "API 金鑰已建立，請立即保存一次性內容。");
    if (ok) form.reset();
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await sendCommand({
      operation: "CREATE_WEBHOOK_ENDPOINT",
      name: data.get("name"),
      url: data.get("url"),
      eventTypes: data.getAll("eventTypes"),
    }, "Webhook 端點已建立但預設停用；請保存 Secret 並完成接收端驗證後再啟用。");
    if (ok) form.reset();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><h2 className="font-semibold">外送採 fail-closed</h2><p className="mt-1">建立 Webhook 不會立即傳送；啟用時會重新做 HTTPS、DNS 與私有網段檢查。正式送達仍需後續核准受控 egress 與重試 worker。</p></div></div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["API 金鑰", dashboard.apiClients.length], ["有效金鑰", dashboard.apiClients.filter((item) => item.status === "ACTIVE").length], ["Webhook", dashboard.webhookEndpoints.length], ["待重試／失敗", dashboard.recentDeliveries.filter((item) => ["RETRY_PENDING", "DEAD_LETTER"].includes(item.status)).length]].map(([label, value]) => <article key={label} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><p className="text-sm text-stone-600">{label}</p><p className="mt-1 text-2xl font-semibold text-stone-950">{value}</p></article>)}
      </section>

      {message ? <p role="status" className={`rounded-lg border p-3 text-sm ${Object.keys(fieldErrors).length ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-900"}`}>{message}</p> : null}
      {oneTimeSecret ? (
        <section className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-950">{secretKind === "API_KEY" ? "一次性 API Key" : "一次性 Webhook Secret"}</h2>
          <p className="mt-1 text-sm text-amber-900">離開或再次操作後不會再顯示，資料庫也無法還原。</p>
          <div className="mt-3 flex gap-2"><code className="min-w-0 flex-1 select-all overflow-x-auto rounded-md bg-stone-950 p-3 text-xs text-white">{oneTimeSecret}</code><button type="button" title="複製" aria-label="複製一次性機密" onClick={() => navigator.clipboard.writeText(oneTimeSecret).catch(() => undefined)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-amber-400 bg-white"><Copy className="h-4 w-4" /></button></div>
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={createApiKey} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound className="h-5 w-5" />建立 Scoped API Key</h2>
          <label className="mt-4 grid gap-1 text-sm font-medium">名稱<input type="text" name="name" required maxLength={120} placeholder="ERP 唯讀串接" className="min-h-11 rounded-md border border-stone-300 px-3" />{fieldErrors.name ? <span className="text-red-700">{fieldErrors.name}</span> : null}</label>
          <fieldset className="mt-3"><legend className="text-sm font-medium">權限範圍</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(scopeLabels).map(([scope, label]) => <label key={scope} className="flex min-h-11 items-center gap-2 rounded-md border border-stone-200 px-3 text-sm"><input type="checkbox" name="scopes" value={scope} defaultChecked={scope === "catalog:read"} />{label}</label>)}</div>{fieldErrors.scopes ? <span className="text-sm text-red-700">{fieldErrors.scopes}</span> : null}</fieldset>
          <label className="mt-3 grid gap-1 text-sm font-medium">到期時間（選填）<input type="datetime-local" name="expiresAt" className="min-h-11 rounded-md border border-stone-300 px-3" />{fieldErrors.expiresAt ? <span className="text-red-700">{fieldErrors.expiresAt}</span> : null}</label>
          <button type="submit" disabled={busy} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Braces className="h-4 w-4" />}建立金鑰</button>
        </form>

        <form onSubmit={createWebhook} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Webhook className="h-5 w-5" />建立 Webhook</h2>
          <label className="mt-4 grid gap-1 text-sm font-medium">名稱<input type="text" name="name" required maxLength={120} placeholder="ERP 訂單同步" className="min-h-11 rounded-md border border-stone-300 px-3" /></label>
          <label className="mt-3 grid gap-1 text-sm font-medium">HTTPS 網址<input type="url" name="url" required maxLength={500} placeholder="https://hooks.example.com/stallorder" className="min-h-11 rounded-md border border-stone-300 px-3" />{fieldErrors.url ? <span className="text-red-700">{fieldErrors.url}</span> : null}</label>
          <fieldset className="mt-3"><legend className="text-sm font-medium">訂閱事件</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(eventLabels).map(([eventType, label]) => <label key={eventType} className="flex min-h-11 items-center gap-2 rounded-md border border-stone-200 px-3 text-sm"><input type="checkbox" name="eventTypes" value={eventType} defaultChecked={eventType === "ORDER_COMPLETED"} />{label}</label>)}</div>{fieldErrors.eventTypes ? <span className="text-sm text-red-700">{fieldErrors.eventTypes}</span> : null}</fieldset>
          <button type="submit" disabled={busy} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Webhook className="h-4 w-4" />}建立端點</button>
        </form>
      </div>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">API 金鑰</h2><div className="mt-3 grid gap-2 md:grid-cols-2">{dashboard.apiClients.map((client) => <article key={client.id} className="rounded-lg border border-stone-200 p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{client.name}</p><code className="text-xs text-stone-600">{client.keyPrefix}…</code></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${client.status === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>{client.status === "ACTIVE" ? "有效" : "已撤銷"}</span></div><p className="mt-2 text-xs text-stone-600">{client.scopes.map((scope) => scopeLabels[scope] ?? scope).join("、")}</p>{client.status === "ACTIVE" ? <button type="button" disabled={busy} onClick={() => sendCommand({ operation: "REVOKE_API_KEY", clientId: client.id, reason: "管理者撤銷" }, "API 金鑰已撤銷。") } className="mt-3 min-h-11 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700">撤銷</button> : null}</article>)}{!dashboard.apiClients.length ? <p className="text-sm text-stone-600">尚未建立 API 金鑰。</p> : null}</div></section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">Webhook 端點</h2><div className="mt-3 grid gap-2 md:grid-cols-2">{dashboard.webhookEndpoints.map((endpoint) => <article key={endpoint.id} className="rounded-lg border border-stone-200 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{endpoint.name}</p><p className="truncate text-xs text-stone-600">{endpoint.url}</p></div><span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold">{endpoint.status === "ACTIVE" ? "啟用" : endpoint.status === "ERROR" ? "錯誤" : "停用"}</span></div><p className="mt-2 text-xs text-stone-600">Secret v{endpoint.secretVersion} · {endpoint.eventTypes.map((event) => eventLabels[event] ?? event).join("、")}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => sendCommand({ operation: "SET_WEBHOOK_STATUS", endpointId: endpoint.id, status: endpoint.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }, endpoint.status === "ACTIVE" ? "Webhook 已停用。" : "Webhook 已通過公開網路檢查並啟用。") } className="min-h-11 rounded-md border border-stone-300 px-3 text-sm font-semibold">{endpoint.status === "ACTIVE" ? "停用" : "安全驗證並啟用"}</button><button type="button" disabled={busy} onClick={() => sendCommand({ operation: "ROTATE_WEBHOOK_SECRET", endpointId: endpoint.id }, "Webhook Secret 已輪替；端點已自動停用。") } className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><RotateCw className="h-4 w-4" />輪替 Secret</button></div></article>)}{!dashboard.webhookEndpoints.length ? <p className="text-sm text-stone-600">尚未建立 Webhook 端點。</p> : null}</div></section>
    </div>
  );
}
