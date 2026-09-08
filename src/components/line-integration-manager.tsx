"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, Power, Save } from "lucide-react";
import { SettingsFeedbackDialog } from "@/components/settings-feedback-dialog";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
} from "@/lib/form-field-errors";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
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
  const { m, label } = useMerchantMessages();
  const [data, setData] = useState(initialData);
  const [channelId, setChannelId] = useState(initialData.channelId);
  const [settings, setSettings] = useState(initialData.settings);
  const [savedSettings, setSavedSettings] = useState(initialData.settings);
  const [secrets, setSecrets] = useState<SecretDraft>(emptySecrets);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(initialData.configured ? 3 : 0);
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
  const baseUrl = appUrl.replace(/\/$/, "");
  const callbackUrl = `${baseUrl}/api/public/line/callback`;
  const webhookUrl = data.integrationId
    ? `${baseUrl}/api/webhooks/line/${data.integrationId}`
    : "";
  const steps = [m("官方帳號"), "LINE Login", m("通知設定"), m("Webhook 與實測")];

  function goToStep(nextStep: number) {
    setStep(nextStep);
    requestAnimationFrame(() => managerRef.current?.querySelector<HTMLElement>("[data-line-step-heading]")?.focus());
  }

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
        const nextFieldErrors = Object.fromEntries(
          Object.entries(parseFieldErrors(payload.fieldErrors)).map(([field, error]) => [field, label(error)]),
        );
        setFieldErrors(nextFieldErrors);
        setMessage(typeof payload.error === "string" ? label(payload.error) : m("無法儲存 LINE 整合設定。"));
        setHasError(true);
        const field = Object.keys(nextFieldErrors).find((key) => key !== "_form");
        if (field) setStep(["channelAccessToken", "messagingChannelSecret"].includes(field) ? 0 : ["channelId", "loginChannelSecret"].includes(field) ? 1 : 2);
        return;
      }
      setData(payload);
      setChannelId(payload.channelId);
      setSettings(payload.settings);
      setSavedSettings(payload.settings);
      setSecrets(emptySecrets);
      setStep(3);
      setMessage(m("LINE 整合與新憑證已安全儲存。"));
    } catch {
      setMessage(m("無法儲存 LINE 整合設定。"));
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!window.confirm(m("確定停用 LINE 訂單通知？尚未傳送的通知會一併取消。"))) return;
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
        const nextFieldErrors = Object.fromEntries(
          Object.entries(parseFieldErrors(payload.fieldErrors)).map(([field, error]) => [field, label(error)]),
        );
        setFieldErrors(nextFieldErrors);
        setMessage(typeof payload.error === "string" ? label(payload.error) : m("無法停用 LINE 整合。"));
        setHasError(true);
        return;
      }
      setData(payload);
      setChannelId("");
      setSecrets(emptySecrets);
      setDisableReason("");
      setShowDisable(false);
      setStep(0);
      setMessage(m("LINE 整合已停用，既有憑證已從 Vault 移除。"));
    } catch {
      setMessage(m("無法停用 LINE 整合。"));
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={managerRef} className="min-w-0 space-y-6">
      <section className="border-y border-stone-200 py-5">
        <h2 className="text-lg font-semibold">{data.configured ? m("LINE 串接設定") : m("第一次串接 LINE")}</h2>
        <p className="mt-2 leading-7 text-stone-700">{m("依序完成四步；LINE 後台會另開分頁，返回此頁可繼續填寫。")}</p>
        <p className="mt-2 text-sm text-stone-600">{m("整合狀態")}：{data.status === "ACTIVE" ? m("設定已儲存，尚未驗證實際收訊。") : data.status === "ERROR" ? m("需要檢查") : m("未啟用")}</p>
      </section>
      <nav aria-label={m("LINE 設定步驟")} className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {steps.map((title, index) => <button key={title} type="button" disabled={busy} aria-current={step === index ? "step" : undefined} onClick={() => goToStep(index)} className={`flex min-h-12 items-center gap-2 rounded-md border px-3 py-2 text-left font-semibold disabled:opacity-40 ${step === index ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300"}`}><span className="shrink-0">{index + 1}</span><span>{title}</span></button>)}
      </nav>
      <fieldset disabled={busy} className="min-w-0 space-y-6">
      <section className="space-y-5 rounded-lg border border-stone-200 p-4 sm:p-6">
        <h2 data-line-step-heading tabIndex={-1} className="text-xl font-semibold">{step + 1}. {steps[step]}</h2>
        {step === 0 ? <>
        <p className="leading-7">{m("開啟自己的官方帳號，至「設定 → Messaging API」啟用；沒有帳號可先建立。")}</p>
        <ConsoleLink href="https://manager.line.biz/">{m("開啟 LINE 官方帳號後台")}</ConsoleLink>
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 leading-7">{m("選擇商家自己的 Provider，後續 LINE Login 也要建立在同一個 Provider。Provider 選定後無法更換，請先確認帳號歸屬。")}</p>
        <ConsoleLink href="https://developers.line.biz/console/">{m("開啟 LINE Developers")}</ConsoleLink>
        <p className="leading-7">{m("不需另外申請 Vault 帳號；下列憑證由系統加密保存，重新開啟不會顯示原值。")}</p>
        {data.configured ? <p className="text-sm leading-6 text-stone-600">{m("更新設定時需重新輸入三項憑證；可填入仍有效的原憑證，不必重新簽發。")}</p> : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Messaging API Channel Access Token" field="channelAccessToken" hint={m("Messaging API Channel → Messaging API → Channel access token → Issue。已有有效 Token 可直接使用；重新簽發可能影響原本串接的服務。") } error={fieldErrors.channelAccessToken}><SecretInput field="channelAccessToken" error={fieldErrors.channelAccessToken} value={secrets.channelAccessToken} maxLength={4096} onChange={(value) => { clearFieldError("channelAccessToken"); setSecrets((current) => ({ ...current, channelAccessToken: value })); }} /></Field>
          <Field label="Messaging API Channel Secret" field="messagingChannelSecret" hint={m("Messaging API Channel → Basic settings → Channel secret。") } error={fieldErrors.messagingChannelSecret}><SecretInput field="messagingChannelSecret" error={fieldErrors.messagingChannelSecret} value={secrets.messagingChannelSecret} maxLength={256} onChange={(value) => { clearFieldError("messagingChannelSecret"); setSecrets((current) => ({ ...current, messagingChannelSecret: value })); }} /></Field>
        </div>
        </> : step === 1 ? <>
        <p className="leading-7">{m("在相同 Provider 建立 LINE Login Channel，選擇 Web app；在 Basic settings 連結自己的 LINE 官方帳號。")}</p>
        <ConsoleLink href="https://developers.line.biz/console/">{m("開啟 LINE Developers")}</ConsoleLink>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="LINE Login Channel ID" field="channelId" hint={m("LINE Login Channel → Basic settings → Channel ID；請勿填入 Messaging API 的 Channel ID。") } error={fieldErrors.channelId}><input {...validationProps("channelId", fieldErrors.channelId)} type="text" value={channelId} onChange={(event) => { clearFieldError("channelId"); setChannelId(event.target.value.slice(0, 30)); }} inputMode="numeric" autoComplete="off" minLength={5} maxLength={30} pattern="[0-9]{5,30}" className={inputClass(fieldErrors.channelId)} /></Field>
          <Field label="LINE Login Channel Secret" field="loginChannelSecret" hint={m("LINE Login Channel → Basic settings → Channel secret。") } error={fieldErrors.loginChannelSecret}><SecretInput field="loginChannelSecret" error={fieldErrors.loginChannelSecret} value={secrets.loginChannelSecret} maxLength={256} onChange={(value) => { clearFieldError("loginChannelSecret"); setSecrets((current) => ({ ...current, loginChannelSecret: value })); }} /></Field>
        </div>
        <CopyUrl id="line-callback-url" label="LINE Login Callback URL" value={callbackUrl} copyLabel={m("複製 Callback URL")} />
        <p className="leading-7">{m("貼到 LINE Login 分頁的 Callback URL。測試時先加入 Channel 測試者，驗收後再切換 Published 供顧客使用。")}</p>
        </> : step === 2 ? <>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={m("顯示名稱")} field="displayName" error={fieldErrors.displayName}><input {...validationProps("displayName", fieldErrors.displayName)} type="text" value={settings.displayName} onChange={(event) => { clearFieldError("displayName"); setSettings((current) => ({ ...current, displayName: event.target.value })); }} maxLength={80} className={inputClass(fieldErrors.displayName)} /></Field>
          <Field label={m("LINE 官方帳號網址（選填）")} field="officialAccountUrl" error={fieldErrors.officialAccountUrl}><input {...validationProps("officialAccountUrl", fieldErrors.officialAccountUrl)} value={settings.officialAccountUrl} onChange={(event) => { clearFieldError("officialAccountUrl"); setSettings((current) => ({ ...current, officialAccountUrl: event.target.value })); }} type="url" maxLength={500} placeholder="https://lin.ee/..." className={inputClass(fieldErrors.officialAccountUrl)} /></Field>
        </div>
        <h2 className="text-lg font-semibold">{m("通知事件")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Toggle label={m("訂單已確認")} checked={settings.notifyConfirmed} onChange={(checked) => setSettings((current) => ({ ...current, notifyConfirmed: checked }))} />
          <Toggle label={m("餐點可取餐")} checked={settings.notifyReady} onChange={(checked) => setSettings((current) => ({ ...current, notifyReady: checked }))} />
          <Toggle label={m("訂單已取消")} checked={settings.notifyCancelled} onChange={(checked) => setSettings((current) => ({ ...current, notifyCancelled: checked }))} />
        </div>
        <p className="leading-7 text-stone-700">{m("儲存後仍需完成第四步；本頁不會自動建立 LINE Channel、驗證憑證或傳送測試訊息。")}</p>
        <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex min-h-12 items-center gap-2 rounded-md bg-stone-950 px-4 font-semibold text-white disabled:opacity-40">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{m("儲存串接設定")}</button>
        </> : <>
        {webhookUrl ? <CopyUrl id="line-webhook-url" label="Webhook URL" value={webhookUrl} copyLabel={m("複製 Webhook URL")} /> : <p className="leading-7">{m("先完成前三步並儲存，系統才會產生此攤位的 Webhook URL。")}</p>}
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 leading-7">{m("若官方帳號已串接其他系統，請先確認 Webhook 用途；每個 Channel 只有一個 Webhook URL，覆蓋後會影響原服務。多攤位共用帳號需先規劃整合。")}</p>
        <ConsoleLink href="https://developers.line.biz/console/">{m("開啟 LINE Developers")}</ConsoleLink>
        <ol className="list-decimal space-y-3 pl-6 leading-7">
          <li>{m("在 Messaging API 分頁貼上 Webhook URL，Verify 成功後開啟 Use webhook。")}</li>
          <li>{m("用測試顧客建立訂單，在訂單頁點「使用 LINE 接收通知」，完成授權並加入官方帳號好友。")}</li>
          <li>{m("店員將測試訂單設為可取餐，確認顧客 LINE 收到通知；也請測試確認、取消及取餐時間變更。")}</li>
        </ol>
        <p className="leading-7 text-stone-700">{m("未收到通知時，檢查是否封鎖官方帳號、通知開關、Channel 狀態、憑證有效性及 LINE 訊息額度。")}</p>
        <p className="text-sm leading-6 text-stone-600">{m("此流程連結的是該筆訂單的通知，尚未建立跨訂單會員身分。")}</p>
        <button type="button" onClick={() => goToStep(0)} className="min-h-12 rounded-md border border-stone-300 px-4 font-semibold">{m("修改串接設定")}</button>
        </>}
        {(step === 1 || step === 3) && isLocalSetupUrl(appUrl) ? <p className="rounded-md border border-amber-300 bg-amber-50 p-3 leading-7">{m("目前為本機或非公開 HTTPS 網址，LINE 無法連入。請在公開 HTTPS 測試站或正式站使用該環境產生的網址與專用 Channel。")}</p> : null}
      </section>
      <div className="flex flex-wrap justify-between gap-3">
        {step > 0 ? <button type="button" onClick={() => goToStep(step - 1)} className="min-h-12 rounded-md border border-stone-300 px-4 font-semibold">{m("上一步")}</button> : <span />}
        {step < 2 ? <button type="button" onClick={() => goToStep(step + 1)} className="min-h-12 rounded-md bg-teal-800 px-4 font-semibold text-white">{m("下一步")}</button> : null}
      </div>
      </fieldset>
      {message ? <SettingsFeedbackDialog message={message} kind={hasError ? "error" : "success"} onClose={() => setMessage("")} focusAfterClose={() => { if (hasError && Object.keys(fieldErrors).length) focusFirstInvalidField(managerRef.current, fieldErrors); else managerRef.current?.querySelector<HTMLElement>("[data-line-step-heading]")?.focus(); }} /> : null}
      <div className="flex flex-wrap gap-3 border-t border-stone-200 pt-5">
        {data.configured && !showDisable ? <button type="button" onClick={() => setShowDisable(true)} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-40"><Power className="h-4 w-4" />{m("停用整合")}</button> : null}
      </div>
      {data.configured && showDisable ? <section className="grid gap-3 border-l-2 border-red-400 pl-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"><Field label={m("停用原因")} field="reason" error={fieldErrors.reason}><input {...validationProps("reason", fieldErrors.reason)} type="text" value={disableReason} minLength={2} maxLength={200} onChange={(event) => { clearFieldError("reason"); setDisableReason(event.target.value); }} className={inputClass(fieldErrors.reason)} /></Field><button type="button" disabled={busy} onClick={() => void disable()} className="min-h-11 rounded-md bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-40">{m("確認停用")}</button><button type="button" disabled={busy} onClick={() => { setShowDisable(false); setDisableReason(""); clearFieldError("reason"); }} className="min-h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold">{m("取消")}</button></section> : null}
    </div>
  );
}
function Field({ label, field, hint, error, children }: { label: string; field: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <div className="min-w-0"><label className="text-sm font-medium text-stone-800">{label}{children}</label>{hint ? <p id={`line-integration-${field}-hint`} className="mt-2 text-sm leading-6 text-stone-600">{hint}</p> : null}{error ? <span id={fieldErrorId(field)} role="alert" className="mt-1 block text-sm text-red-700">{error}</span> : null}</div>;
}

function SecretInput({ field, error, value, maxLength, onChange }: { field: string; error?: string; value: string; maxLength: number; onChange: (value: string) => void }) {
  return <input {...validationProps(field, error)} type="password" value={value} minLength={16} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} autoComplete="new-password" className={inputClass(error)} />;
}

function validationProps(field: string, error?: string) {
  const hint = ["channelId", "channelAccessToken", "messagingChannelSecret", "loginChannelSecret"].includes(field) ? `line-integration-${field}-hint` : "";
  return { "data-field-key": field, "aria-invalid": error ? true : undefined, "aria-describedby": [hint, error ? fieldErrorId(field) : ""].filter(Boolean).join(" ") || undefined };
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

function ConsoleLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center gap-2 rounded-md border border-teal-700 px-3 py-2 font-semibold text-teal-900"><span>{children}</span><ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" /></a>;
}

function CopyUrl({ id, label, value, copyLabel }: { id: string; label: string; value: string; copyLabel: string }) {
  const { m } = useMerchantMessages();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setResult("success");
    } catch {
      setResult("error");
      input.current?.focus();
      input.current?.select();
    }
  }
  return <div><label htmlFor={id} className="font-medium">{label}</label><div className="mt-2 flex gap-2"><input ref={input} id={id} type="text" readOnly value={value} className="min-h-12 min-w-0 flex-1 rounded-md border border-stone-300 bg-stone-50 px-3 text-sm" /><button type="button" title={copyLabel} aria-label={copyLabel} onClick={() => void copy()} className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-stone-300">{result === "success" ? <Check className="h-5 w-5 text-teal-800" /> : <Copy className="h-5 w-5" />}</button></div>{result ? <p role={result === "error" ? "alert" : "status"} className={`mt-2 text-sm ${result === "error" ? "text-red-700" : "text-teal-800"}`}>{result === "success" ? m("網址已複製。") : m("無法自動複製，請選取網址後手動複製。")}</p> : null}</div>;
}

function isLocalSetupUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return true;
  }
}
