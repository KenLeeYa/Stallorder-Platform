"use client";

import { useMerchantMessages } from "@/lib/messages/merchant-client";
import { useMemo, useRef, useState } from "react";
import {
  Ban,
  Check,
  CircleAlert,
  LoaderCircle,
  Save,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatAppDateTime } from "@/lib/locale-format";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
} from "@/lib/form-field-errors";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

type FeatureState = {
  enabled: boolean;
  source: string;
  expiresAt: string | null;
};

type OfflineDevice = {
  id: string;
  installationId: string;
  displayName: string;
  platform: string;
  appVersion: string;
  pwaInstalled: boolean;
  offlineEnabled: boolean;
  offlineRole: string;
  status: string;
  lastOnlineAt: string | null;
  lastSyncAt: string | null;
  permitExpiresAt: string | null;
  activePermitExpiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type OfflinePolicy = {
  stallId: string;
  offlineEnabled: boolean;
  offlineWriteMode: string;
  offlineLeaderDeviceId: string | null;
  maxOfflineDurationMinutes: number;
  maxPendingOrders: number;
  maxTotalAmount: number;
  maxSingleOrderAmount: number;
  maxManualPaymentAmount: number;
  maxTotalManualPaymentAmount: number;
  requireCustomerContactAboveAmount: number;
  managerApprovalThreshold: number;
  updatedAt: string | null;
};

export type OfflineManagementState = {
  feature: {
    offlinePos: FeatureState;
    singleDeviceOnly: FeatureState;
    manualPayment: FeatureState;
  };
  policy: OfflinePolicy;
  devices: OfflineDevice[];
};

const terminalDeviceStatuses = new Set(["REVOKED", "LOST", "REPLACED"]);

type EditableOfflinePolicy = {
  offlineEnabled: boolean;
  offlineLeaderDeviceId: string | null;
  maxOfflineDurationMinutes: number | string;
  maxPendingOrders: number | string;
  maxTotalAmount: number | string;
  maxSingleOrderAmount: number | string;
  maxManualPaymentAmount: number | string;
  maxTotalManualPaymentAmount: number | string;
  requireCustomerContactAboveAmount: number | string;
  managerApprovalThreshold: number | string;
};

function normalizePolicy(policy: OfflinePolicy): EditableOfflinePolicy {
  return {
    offlineEnabled: policy.offlineEnabled,
    offlineLeaderDeviceId: policy.offlineLeaderDeviceId,
    maxOfflineDurationMinutes: policy.maxOfflineDurationMinutes,
    maxPendingOrders: policy.maxPendingOrders,
    maxTotalAmount: policy.maxTotalAmount,
    maxSingleOrderAmount: policy.maxSingleOrderAmount,
    maxManualPaymentAmount: policy.maxManualPaymentAmount,
    maxTotalManualPaymentAmount: policy.maxTotalManualPaymentAmount,
    requireCustomerContactAboveAmount: policy.requireCustomerContactAboveAmount,
    managerApprovalThreshold: policy.managerApprovalThreshold,
  };
}

export function OfflineDeviceManager({
  stallId,
  initialData,
}: {
  stallId: string;
  initialData: OfflineManagementState;
}) {
  const { locale, m, label } = useMerchantMessages();
  const [data, setData] = useState(initialData);
  const [policy, setPolicy] = useState(() => normalizePolicy(initialData.policy));
  const [savedPolicy, setSavedPolicy] = useState(() => normalizePolicy(initialData.policy));
  const [reason, setReason] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const managerRef = useRef<HTMLDivElement>(null);
  const featureAvailable = data.feature.offlinePos.enabled
    && data.feature.singleDeviceOnly.enabled;
  const leaderCandidates = data.devices.filter(
    (device) => !terminalDeviceStatuses.has(device.status),
  );
  const dirty = useMemo(
    () => JSON.stringify(policy) !== JSON.stringify(savedPolicy),
    [policy, savedPolicy],
  );
  useUnsavedSettings("offline-device-policy", dirty);

  function clearFieldError(field: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
  }

  async function submit(command: Record<string, unknown>, busyId: string) {
    setBusyKey(busyId);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/offline`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as OfflineManagementState & { error?: string; fieldErrors?: unknown };
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(payload.fieldErrors);
        setFieldErrors(nextFieldErrors);
        setMessage(payload.error ?? label("無法更新離線裝置設定。"));
        setHasError(true);
        focusFirstInvalidField(managerRef.current, nextFieldErrors);
        return;
      }
      setData(payload);
      const nextPolicy = normalizePolicy(payload.policy);
      setPolicy(nextPolicy);
      setSavedPolicy(nextPolicy);
      setReason("");
      setMessage(label("離線裝置設定已更新。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("無法更新離線裝置設定。"));
      setHasError(true);
    } finally {
      setBusyKey(null);
    }
  }

  async function savePolicy() {
    await submit({
      operation: "UPDATE_POLICY",
      offlineEnabled: policy.offlineEnabled,
      offlineWriteMode: policy.offlineEnabled ? "SINGLE_DEVICE_ONLY" : "DISABLED",
      offlineLeaderDeviceId: policy.offlineEnabled ? policy.offlineLeaderDeviceId : null,
      limits: {
        maxOfflineDurationMinutes: numberOrOriginal(policy.maxOfflineDurationMinutes),
        maxPendingOrders: numberOrOriginal(policy.maxPendingOrders),
        maxTotalAmount: numberOrOriginal(policy.maxTotalAmount),
        maxSingleOrderAmount: numberOrOriginal(policy.maxSingleOrderAmount),
        maxManualPaymentAmount: numberOrOriginal(policy.maxManualPaymentAmount),
        maxTotalManualPaymentAmount: numberOrOriginal(policy.maxTotalManualPaymentAmount),
        requireCustomerContactAboveAmount: numberOrOriginal(policy.requireCustomerContactAboveAmount),
        managerApprovalThreshold: numberOrOriginal(policy.managerApprovalThreshold),
      },
      reason,
    }, "policy");
  }

  async function updateDevice(
    device: OfflineDevice,
    action: "APPROVE_READ_ONLY" | "DISABLE" | "REVOKE" | "MARK_LOST",
  ) {
    if (
      ["REVOKE", "MARK_LOST"].includes(action)
      && !window.confirm(
        action === "REVOKE"
          ? m("確定撤銷「{value0}」？現有離線 Permit 將立即失效。", { value0: device.displayName })
          : m("確定將「{value0}」標記為遺失？此裝置將無法同步。", { value0: device.displayName }),
      )
    ) {
      return;
    }
    await submit({
      operation: "UPDATE_DEVICE",
      deviceId: device.id,
      action,
      reason,
    }, device.id);
  }

  function updateLimit(
    key:
      | "maxOfflineDurationMinutes"
      | "maxPendingOrders"
      | "maxTotalAmount"
      | "maxSingleOrderAmount"
      | "maxManualPaymentAmount"
      | "maxTotalManualPaymentAmount"
      | "requireCustomerContactAboveAmount"
      | "managerApprovalThreshold",
    value: string,
  ) {
    clearFieldError(key);
    setPolicy((current) => ({ ...current, [key]: value }));
  }

  return (
    <div ref={managerRef} className="space-y-7">
      {!featureAvailable ? (
        <section className="border-y border-amber-300 bg-amber-50 px-4 py-4 text-amber-950">
          <div className="flex gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h2 className="font-semibold">{label("離線收單模組尚未開放")}</h2>
              <p className="mt-1 text-sm">
                {label("目前裝置維持線上操作；啟用模組後仍須由管理者核准裝置並指定唯一 Leader。")}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="border-b border-stone-200 pb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <ShieldCheck className="h-5 w-5 text-teal-700" />
              {label("離線收單政策")}
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              {label("每個攤位僅允許一台核准裝置在斷線時建立訂單，其餘裝置維持唯讀。")}
            </p>
          </div>
          <span className={`text-sm font-semibold ${data.policy.offlineEnabled ? "text-emerald-700" : "text-stone-500"}`}>
            {data.policy.offlineEnabled ? label("已啟用") : label("已停用")}
          </span>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className={`flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-md border px-3 text-sm font-medium ${fieldErrors.offlineEnabled ? "border-red-500 bg-red-50" : "border-stone-300"} ${!featureAvailable ? "opacity-50" : ""}`}>
            <span>{label("允許離線收單")}</span>
            <input
              type="checkbox"
              role="switch"
              checked={policy.offlineEnabled}
              data-field-key="offlineEnabled"
              aria-invalid={Boolean(fieldErrors.offlineEnabled)}
              aria-describedby={fieldErrors.offlineEnabled ? fieldErrorId("offlineEnabled") : undefined}
              disabled={!featureAvailable || busyKey !== null}
              onChange={(event) => {
                clearFieldError("offlineEnabled");
                clearFieldError("offlineLeaderDeviceId");
                setPolicy((current) => ({
                  ...current,
                  offlineEnabled: event.target.checked,
                  offlineLeaderDeviceId: event.target.checked
                    ? current.offlineLeaderDeviceId
                    : null,
                }));
              }}
              className="h-5 w-5"
            />
            {fieldErrors.offlineEnabled ? <FieldError field="offlineEnabled" error={fieldErrors.offlineEnabled} /> : null}
          </label>
          <label className="text-sm font-medium">
            {label("Leader 裝置")}
            <select
              value={policy.offlineLeaderDeviceId ?? ""}
              data-field-key="offlineLeaderDeviceId"
              aria-invalid={Boolean(fieldErrors.offlineLeaderDeviceId)}
              aria-describedby={fieldErrors.offlineLeaderDeviceId ? fieldErrorId("offlineLeaderDeviceId") : undefined}
              disabled={!featureAvailable || !policy.offlineEnabled || busyKey !== null}
              onChange={(event) => {
                clearFieldError("offlineLeaderDeviceId");
                setPolicy((current) => ({
                  ...current,
                  offlineLeaderDeviceId: event.target.value || null,
                }));
              }}
              className={`form-input mt-1 ${fieldErrors.offlineLeaderDeviceId ? "border-red-500 bg-red-50" : ""}`}
            >
              <option value="">{label("請選擇已登錄裝置")}</option>
              {leaderCandidates.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.displayName} · {device.platform}
                </option>
              ))}
            </select>
            {fieldErrors.offlineLeaderDeviceId ? <FieldError field="offlineLeaderDeviceId" error={fieldErrors.offlineLeaderDeviceId} /> : null}
          </label>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            label={label("最長離線時間（分鐘）")}
            fieldKey="maxOfflineDurationMinutes"
            error={fieldErrors.maxOfflineDurationMinutes}
            min={15}
            max={720}
            value={policy.maxOfflineDurationMinutes}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("maxOfflineDurationMinutes", value)}
          />
          <NumberField
            label={label("待同步訂單上限")}
            fieldKey="maxPendingOrders"
            error={fieldErrors.maxPendingOrders}
            min={1}
            max={500}
            value={policy.maxPendingOrders}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("maxPendingOrders", value)}
          />
          <NumberField
            label={label("離線累計金額上限")}
            fieldKey="maxTotalAmount"
            error={fieldErrors.maxTotalAmount}
            min={0}
            max={99_999_999.99}
            value={policy.maxTotalAmount}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("maxTotalAmount", value)}
          />
          <NumberField
            label={label("單筆訂單金額上限")}
            fieldKey="maxSingleOrderAmount"
            error={fieldErrors.maxSingleOrderAmount}
            min={0}
            max={99_999_999.99}
            value={policy.maxSingleOrderAmount}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("maxSingleOrderAmount", value)}
          />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            label={label("單筆人工付款上限")}
            fieldKey="maxManualPaymentAmount"
            error={fieldErrors.maxManualPaymentAmount}
            min={0}
            max={100_000_000}
            value={policy.maxManualPaymentAmount}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("maxManualPaymentAmount", value)}
          />
          <NumberField
            label={label("人工付款累計上限")}
            fieldKey="maxTotalManualPaymentAmount"
            error={fieldErrors.maxTotalManualPaymentAmount}
            min={0}
            max={100_000_000}
            value={policy.maxTotalManualPaymentAmount}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("maxTotalManualPaymentAmount", value)}
          />
          <NumberField
            label={label("需留聯絡方式門檻")}
            fieldKey="requireCustomerContactAboveAmount"
            error={fieldErrors.requireCustomerContactAboveAmount}
            min={0}
            max={100_000_000}
            value={policy.requireCustomerContactAboveAmount}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("requireCustomerContactAboveAmount", value)}
          />
          <NumberField
            label={label("管理者操作門檻")}
            fieldKey="managerApprovalThreshold"
            error={fieldErrors.managerApprovalThreshold}
            min={0}
            max={100_000_000}
            value={policy.managerApprovalThreshold}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("managerApprovalThreshold", value)}
          />
        </div>

        <label className="mt-5 block text-sm font-medium">
          {label("異動原因")}
          <input
            type="text"
            value={reason}
            data-field-key="reason"
            aria-invalid={Boolean(fieldErrors.reason)}
            aria-describedby={fieldErrors.reason ? fieldErrorId("reason") : undefined}
            minLength={5}
            maxLength={500}
            onChange={(event) => { clearFieldError("reason"); setReason(event.target.value); }}
            placeholder={label("例如：核准櫃台平板作為離線主機")}
            className={`form-input mt-1 ${fieldErrors.reason ? "border-red-500 bg-red-50" : ""}`}
          />
          {fieldErrors.reason ? <FieldError field="reason" error={fieldErrors.reason} /> : null}
        </label>
        <button
          type="button"
          disabled={busyKey !== null || (!featureAvailable && policy.offlineEnabled)}
          onClick={() => void savePolicy()}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busyKey === "policy" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {label("儲存離線政策")}
        </button>
      </section>

      <section>
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
          <div>
            <h2 className="text-xl font-semibold">{label("已登錄裝置")}</h2>
            <p className="mt-1 text-sm text-stone-600">
              {label("裝置須先由店員端送出登錄，再由管理者核准。撤銷或遺失會使 Permit 失效。")}
            </p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
          {data.devices.length === 0 ? (
            <p className="py-6 text-sm text-stone-500">{label("尚無裝置送出登錄申請。")}</p>
          ) : data.devices.map((device) => (
            <article key={device.id} className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{device.displayName}</h3>
                  <StatusBadge status={device.status} />
                  <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700">
                    {label(roleLabel(device.offlineRole))}
                  </span>
                </div>
                <p className="mt-1 text-sm text-stone-600">
                  {device.platform} {label("· 應用程式")} {device.appVersion} · {device.pwaInstalled ? label("已安裝 PWA") : label("瀏覽器模式")}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {label("最後上線：")}{device.lastOnlineAt ? formatAppDateTime(locale, device.lastOnlineAt, { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }) : label("尚無紀錄")}
                  {device.activePermitExpiresAt
                    ? m(" · Permit 到期：{value0}", { value0: formatAppDateTime(locale, device.activePermitExpiresAt, { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }) })
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!terminalDeviceStatuses.has(device.status)
                  && !(device.status === "ACTIVE" && device.offlineRole !== "NONE") ? (
                  <button
                    type="button"
                    disabled={!featureAvailable || busyKey !== null}
                    onClick={() => void updateDevice(device, "APPROVE_READ_ONLY")}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-300 px-3 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    {label("核准唯讀")}
                  </button>
                ) : null}
                {device.status === "ACTIVE" ? (
                  <button
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() => void updateDevice(device, "DISABLE")}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-50"
                  >
                    <Ban className="h-4 w-4" />
                    {label("停用")}
                  </button>
                ) : null}
                {!terminalDeviceStatuses.has(device.status) ? (
                  <>
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => void updateDevice(device, "REVOKE")}
                      className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-xs font-semibold text-red-700 disabled:opacity-50"
                    >
                      {label("撤銷")}
                    </button>
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => void updateDevice(device, "MARK_LOST")}
                      className="inline-flex min-h-10 items-center gap-2 rounded-md border border-amber-400 px-3 text-xs font-semibold text-amber-800 disabled:opacity-50"
                    >
                      <TriangleAlert className="h-4 w-4" />
                      {label("標記遺失")}
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <p className="text-xs leading-5 text-stone-500">
        {label("瀏覽器儲存空間可能被系統清除；非持久儲存裝置會自動套用較低的時間、訂單與金額上限。")}
      </p>
      {message ? (
        <p
          role={hasError ? "alert" : "status"}
          className={`text-sm font-medium ${hasError ? "text-red-700" : "text-emerald-700"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  fieldKey,
  error,
  min,
  max,
  value,
  disabled,
  onChange,
}: {
  label: string;
  fieldKey: string;
  error?: string;
  min: number;
  max: number;
  value: number | string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        data-field-key={fieldKey}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? fieldErrorId(fieldKey) : undefined}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`form-input mt-1 ${error ? "border-red-500 bg-red-50" : ""}`}
      />
      {error ? <FieldError field={fieldKey} error={error} /> : null}
    </label>
  );
}

function FieldError({ field, error }: { field: string; error: string }) {
  return <span id={fieldErrorId(field)} role="alert" className="mt-1 block w-full text-xs text-red-700">{error}</span>;
}

function fieldErrorId(field: string) {
  return `offline-device-${field}-error`;
}

function numberOrOriginal(value: number | string) {
  if (typeof value === "number") return value;
  return value.trim() === "" ? value : Number(value);
}

function StatusBadge({ status }: { status: string }) {
  const { label } = useMerchantMessages();
  const statusLabel = ({
    ACTIVE: "已核准",
    DISABLED: "待核准／已停用",
    REVOKED: "已撤銷",
    LOST: "已遺失",
    REPLACED: "已更換",
  } as Record<string, string>)[status];
  const styles = status === "ACTIVE"
    ? "bg-emerald-50 text-emerald-800"
    : ["REVOKED", "LOST"].includes(status)
      ? "bg-red-50 text-red-800"
      : "bg-stone-100 text-stone-700";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${styles}`}>
      {statusLabel ? label(statusLabel) : status}
    </span>
  );
}

function roleLabel(role: string) {
  return ({
    OFFLINE_LEADER: "離線 Leader",
    OFFLINE_READ_ONLY: "離線唯讀",
    NONE: "未指派",
  } as Record<string, string>)[role] ?? role;
}
