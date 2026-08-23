"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import {
  StallAlertSoundSettings,
  type StallAlertSoundSettingsValue,
} from "@/components/stall-alert-sound-settings";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatAppNumber } from "@/lib/locale-format";
import type { MessageValues } from "@/lib/message-catalog";
import type { MerchantMessageKey } from "@/lib/messages/merchant";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

export type StallOrderLimits = {
  orderSessionTtlSeconds: number;
  unconfirmedOrderTimeoutSeconds: number;
  maxItemQuantity: number;
  maxUniqueProducts: number;
  maxTotalQuantity: number;
  maxNoteLength: number;
  maxPendingOrdersPerDevice: number;
  maxOrdersPerWindow: number;
  orderWindowSeconds: number;
  estimatedWaitMinutes: number;
  businessDayCutoffHour: number;
  preorderReminderMinutes: number;
  managerAuthorizationCodeConfigured: boolean;
};

type LimitKey = Exclude<keyof StallOrderLimits, "managerAuthorizationCodeConfigured">;
type LimitsDraft = Record<LimitKey, string>;
type LimitRule = { label: MerchantMessageKey; min: number; max: number };

const limitRules = {
  orderSessionTtlSeconds: { label: "點餐工作階段秒數", min: 60, max: 1800 },
  unconfirmedOrderTimeoutSeconds: { label: "待確認逾時秒數", min: 60, max: 3600 },
  maxItemQuantity: { label: "單品數量上限", min: 1, max: 100 },
  maxUniqueProducts: { label: "商品種類上限", min: 1, max: 100 },
  maxTotalQuantity: { label: "總數量上限", min: 1, max: 500 },
  maxNoteLength: { label: "備註字數上限", min: 0, max: 2000 },
  maxPendingOrdersPerDevice: { label: "每裝置待確認上限", min: 1, max: 20 },
  maxOrdersPerWindow: { label: "時間窗訂單上限", min: 1, max: 100 },
  orderWindowSeconds: { label: "訂單時間窗秒數", min: 60, max: 3600 },
  estimatedWaitMinutes: { label: "顧客預估等候分鐘", min: 0, max: 240 },
  businessDayCutoffHour: { label: "營業日切換時間", min: 0, max: 23 },
  preorderReminderMinutes: { label: "預約單提前提醒分鐘", min: 0, max: 1440 },
} satisfies Record<LimitKey, LimitRule>;

const limitFields = [
  "orderSessionTtlSeconds",
  "unconfirmedOrderTimeoutSeconds",
  "maxItemQuantity",
  "maxUniqueProducts",
  "maxTotalQuantity",
  "maxNoteLength",
  "maxPendingOrdersPerDevice",
  "maxOrdersPerWindow",
  "orderWindowSeconds",
] as const satisfies readonly LimitKey[];

export function StallOrderLimitsForm({
  stallId,
  stallSlug,
  initialSettings,
  initialAlertSettings,
}: {
  stallId: string;
  stallSlug: string;
  initialSettings: StallOrderLimits;
  initialAlertSettings: StallAlertSoundSettingsValue;
}) {
  const { locale, m, label } = useMerchantMessages();
  const [draft, setDraft] = useState<LimitsDraft>(() => toLimitsDraft(initialSettings));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LimitKey, string>>>({});
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [authorizationCodeConfirmation, setAuthorizationCodeConfirmation] = useState("");
  const [authorizationCodeConfigured, setAuthorizationCodeConfigured] = useState(
    initialSettings.managerAuthorizationCodeConfigured,
  );
  const [isSavingAuthorizationCode, setIsSavingAuthorizationCode] = useState(false);

  function updateLimit(key: LimitKey, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function saveLimits() {
    setMessage("");
    const validation = validateLimitsDraft(draft, m, locale);
    setFieldErrors(validation.fieldErrors);
    if (!validation.settings) {
      setIsError(true);
      setMessage(m("請修正標示欄位後再儲存。"));
      const firstInvalidKey = Object.keys(validation.fieldErrors)[0] as LimitKey | undefined;
      if (firstInvalidKey) {
        window.requestAnimationFrame(() => document.getElementById(`order-limit-${firstInvalidKey}`)?.focus());
      }
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/ordering`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ action: "UPDATE_LIMITS", settings: validation.settings }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? label(payload.error) : m("目前無法更新安全與訂單限制。"));
      if (payload.state?.orderingSettings) setDraft(toLimitsDraft(payload.state.orderingSettings));
      setFieldErrors({});
      setIsError(false);
      setMessage(m("安全與訂單限制已更新。"));
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? label(error.message) : m("網路連線中斷，請稍後再試。"));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveAuthorizationCode() {
    setMessage("");
    if (!/^\d{4,8}$/.test(authorizationCode)) {
      setIsError(true);
      setMessage(m("管理授權碼須為 4 到 8 位數字。"));
      return;
    }
    if (authorizationCode !== authorizationCodeConfirmation) {
      setIsError(true);
      setMessage(m("兩次輸入的管理授權碼不一致。"));
      return;
    }

    setIsSavingAuthorizationCode(true);
    try {
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/ordering`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ action: "UPDATE_MANAGER_AUTHORIZATION_CODE", authorizationCode }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? label(payload.error) : m("目前無法更新管理授權碼。"));
      setAuthorizationCode("");
      setAuthorizationCodeConfirmation("");
      setAuthorizationCodeConfigured(true);
      setIsError(false);
      setMessage(m("管理授權碼已更新。"));
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? label(error.message) : m("網路連線中斷，請稍後再試。"));
    } finally {
      setIsSavingAuthorizationCode(false);
    }
  }

  return (
    <section aria-labelledby="stall-order-limits-heading">
      <div className="border-b border-stone-200 pb-4">
        <h2 id="stall-order-limits-heading" className="text-2xl font-semibold">{m("安全與訂單限制")}</h2>
        <p className="mt-2 text-sm text-stone-600">{m("設定 QR 點餐工作階段、訂單數量限制與顧客看到的預估等候時間。")}</p>
      </div>

      {message ? (
        <p role={isError ? "alert" : "status"} className={`mt-4 text-sm font-medium ${isError ? "text-red-700" : "text-emerald-800"}`}>
          {message}
        </p>
      ) : null}

      <form noValidate className="mt-6" onSubmit={(event) => { event.preventDefault(); void saveLimits(); }}>
        <div className="mb-6 grid gap-4 border-b border-stone-200 pb-6 sm:grid-cols-2">
          <label className="text-sm font-medium text-stone-700">
            {m("顧客預估等候分鐘")}
            <input
              id="order-limit-estimatedWaitMinutes"
              type="number"
              min={0}
              max={240}
              step={1}
              required
              value={draft.estimatedWaitMinutes}
              aria-invalid={Boolean(fieldErrors.estimatedWaitMinutes)}
              aria-describedby={fieldErrors.estimatedWaitMinutes ? "order-limit-estimatedWaitMinutes-error" : undefined}
              onChange={(event) => updateLimit("estimatedWaitMinutes", event.target.value)}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
            />
            {fieldErrors.estimatedWaitMinutes ? (
              <span id="order-limit-estimatedWaitMinutes-error" className="mt-1 block text-xs font-normal text-red-700">
                {fieldErrors.estimatedWaitMinutes}
              </span>
            ) : null}
          </label>
          <label className="text-sm font-medium text-stone-700">
            {m("營業日切換時間")}
            <select
              id="order-limit-businessDayCutoffHour"
              value={draft.businessDayCutoffHour}
              aria-invalid={Boolean(fieldErrors.businessDayCutoffHour)}
              aria-describedby={fieldErrors.businessDayCutoffHour ? "order-limit-businessDayCutoffHour-error" : undefined}
              onChange={(event) => updateLimit("businessDayCutoffHour", event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
              ))}
            </select>
            {fieldErrors.businessDayCutoffHour ? (
              <span id="order-limit-businessDayCutoffHour-error" className="mt-1 block text-xs font-normal text-red-700">
                {fieldErrors.businessDayCutoffHour}
              </span>
            ) : null}
            <span className="mt-1 block text-xs font-normal text-stone-500">{m("切換前完成的訂單計入前一個營業日。")}</span>
          </label>
          <label className="text-sm font-medium text-stone-700">
            {m("預約單提前提醒分鐘")}
            <input
              id="order-limit-preorderReminderMinutes"
              type="number"
              min={0}
              max={1440}
              step={1}
              required
              value={draft.preorderReminderMinutes}
              aria-invalid={Boolean(fieldErrors.preorderReminderMinutes)}
              aria-describedby={fieldErrors.preorderReminderMinutes ? "order-limit-preorderReminderMinutes-error" : undefined}
              onChange={(event) => updateLimit("preorderReminderMinutes", event.target.value)}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
            />
            {fieldErrors.preorderReminderMinutes ? (
              <span id="order-limit-preorderReminderMinutes-error" className="mt-1 block text-xs font-normal text-red-700">
                {fieldErrors.preorderReminderMinutes}
              </span>
            ) : null}
            <span className="mt-1 block text-xs font-normal text-stone-500">{m("設為 0 代表預約時間到達時才提醒。")}</span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {limitFields.map((key) => (
            <label key={key} className="text-sm font-medium text-stone-700">
              {m(limitRules[key].label)}
              <input
                id={`order-limit-${key}`}
                type="number"
                min={limitRules[key].min}
                max={limitRules[key].max}
                step={1}
                required
                value={draft[key]}
                aria-invalid={Boolean(fieldErrors[key])}
                aria-describedby={fieldErrors[key] ? `order-limit-${key}-error` : undefined}
                onChange={(event) => updateLimit(key, event.target.value)}
                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              />
              {fieldErrors[key] ? (
                <span id={`order-limit-${key}-error`} className="mt-1 block text-xs font-normal text-red-700">
                  {fieldErrors[key]}
                </span>
              ) : null}
            </label>
          ))}
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {isSaving ? m("儲存中...") : m("儲存限制")}
        </button>
      </form>

      <StallAlertSoundSettings
        stallId={stallId}
        stallSlug={stallSlug}
        initialSettings={initialAlertSettings}
      />

      <form
        noValidate
        className="mt-8 border-t border-stone-200 pt-6"
        onSubmit={(event) => { event.preventDefault(); void saveAuthorizationCode(); }}
      >
        <h3 className="text-lg font-semibold text-stone-900">{m("管理授權碼")}</h3>
        <p className="mt-1 text-sm text-stone-600">
          {authorizationCodeConfigured
            ? m("目前已設定。輸入新授權碼可取代原授權碼。")
            : m("尚未設定。員工將無法執行高折扣、取消訂單或更正付款方式等高權限操作。")}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-stone-700">
            {m("新管理授權碼")}
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              minLength={4}
              maxLength={8}
              autoComplete="new-password"
              value={authorizationCode}
              onChange={(event) => setAuthorizationCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-medium text-stone-700">
            {m("再次輸入授權碼")}
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              minLength={4}
              maxLength={8}
              autoComplete="new-password"
              value={authorizationCodeConfirmation}
              onChange={(event) => setAuthorizationCodeConfirmation(event.target.value.replace(/\D/g, "").slice(0, 8))}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={isSavingAuthorizationCode}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-900 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {isSavingAuthorizationCode ? m("儲存中...") : m("更新管理授權碼")}
        </button>
      </form>
    </section>
  );
}

function toLimitsDraft(settings: StallOrderLimits): LimitsDraft {
  return {
    orderSessionTtlSeconds: String(settings.orderSessionTtlSeconds),
    unconfirmedOrderTimeoutSeconds: String(settings.unconfirmedOrderTimeoutSeconds),
    maxItemQuantity: String(settings.maxItemQuantity),
    maxUniqueProducts: String(settings.maxUniqueProducts),
    maxTotalQuantity: String(settings.maxTotalQuantity),
    maxNoteLength: String(settings.maxNoteLength),
    maxPendingOrdersPerDevice: String(settings.maxPendingOrdersPerDevice),
    maxOrdersPerWindow: String(settings.maxOrdersPerWindow),
    orderWindowSeconds: String(settings.orderWindowSeconds),
    estimatedWaitMinutes: String(settings.estimatedWaitMinutes),
    businessDayCutoffHour: String(settings.businessDayCutoffHour),
    preorderReminderMinutes: String(settings.preorderReminderMinutes),
  };
}

function validateLimitsDraft(
  draft: LimitsDraft,
  m: (key: MerchantMessageKey, values?: MessageValues) => string,
  locale: Parameters<typeof formatAppNumber>[0],
) {
  const settings = {} as StallOrderLimits;
  const fieldErrors: Partial<Record<LimitKey, string>> = {};

  for (const key of Object.keys(limitRules) as LimitKey[]) {
    const rawValue = draft[key].trim();
    const rule = limitRules[key];
    if (!rawValue) {
      fieldErrors[key] = m("{field}為必填欄位。", { field: m(rule.label) });
      continue;
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      fieldErrors[key] = m("{field}請輸入整數。", { field: m(rule.label) });
      continue;
    }
    if (value < rule.min || value > rule.max) {
      fieldErrors[key] = m("{field}請輸入 {min} 到 {max} 之間。", {
        field: m(rule.label),
        min: formatAppNumber(locale, rule.min),
        max: formatAppNumber(locale, rule.max),
      });
      continue;
    }
    settings[key] = value;
  }

  if (
    !fieldErrors.maxItemQuantity
    && !fieldErrors.maxTotalQuantity
    && settings.maxTotalQuantity < settings.maxItemQuantity
  ) {
    fieldErrors.maxTotalQuantity = m("總數量上限不得低於單品上限。");
  }

  return {
    settings: Object.keys(fieldErrors).length === 0 ? settings : null,
    fieldErrors,
  };
}
