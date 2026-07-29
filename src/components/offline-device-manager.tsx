"use client";

import { useMemo, useState } from "react";
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
import { formatTaipeiDateTime } from "@/lib/date-time";
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

function normalizePolicy(policy: OfflinePolicy) {
  return {
    offlineEnabled: policy.offlineEnabled,
    offlineLeaderDeviceId: policy.offlineLeaderDeviceId,
    maxOfflineDurationMinutes: policy.maxOfflineDurationMinutes,
    maxPendingOrders: policy.maxPendingOrders,
    maxTotalAmount: policy.maxTotalAmount,
    maxSingleOrderAmount: policy.maxSingleOrderAmount,
  };
}

export function OfflineDeviceManager({
  stallId,
  initialData,
}: {
  stallId: string;
  initialData: OfflineManagementState;
}) {
  const [data, setData] = useState(initialData);
  const [policy, setPolicy] = useState(() => normalizePolicy(initialData.policy));
  const [savedPolicy, setSavedPolicy] = useState(() => normalizePolicy(initialData.policy));
  const [reason, setReason] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
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

  async function submit(command: Record<string, unknown>, busyId: string) {
    setBusyKey(busyId);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/offline`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as OfflineManagementState & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "無法更新離線裝置設定。");
      setData(payload);
      const nextPolicy = normalizePolicy(payload.policy);
      setPolicy(nextPolicy);
      setSavedPolicy(nextPolicy);
      setReason("");
      setMessage("離線裝置設定已更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法更新離線裝置設定。");
    } finally {
      setBusyKey(null);
    }
  }

  async function savePolicy() {
    if (reason.trim().length < 5) {
      setMessage("請輸入至少 5 個字元的異動原因。");
      return;
    }
    if (policy.offlineEnabled && !policy.offlineLeaderDeviceId) {
      setMessage("啟用離線收單前，請先選擇一台 Leader 裝置。");
      return;
    }
    await submit({
      operation: "UPDATE_POLICY",
      offlineEnabled: policy.offlineEnabled,
      offlineWriteMode: policy.offlineEnabled ? "SINGLE_DEVICE_ONLY" : "DISABLED",
      offlineLeaderDeviceId: policy.offlineEnabled ? policy.offlineLeaderDeviceId : null,
      limits: {
        maxOfflineDurationMinutes: policy.maxOfflineDurationMinutes,
        maxPendingOrders: policy.maxPendingOrders,
        maxTotalAmount: policy.maxTotalAmount,
        maxSingleOrderAmount: policy.maxSingleOrderAmount,
      },
      reason,
    }, "policy");
  }

  async function updateDevice(
    device: OfflineDevice,
    action: "APPROVE_READ_ONLY" | "DISABLE" | "REVOKE" | "MARK_LOST",
  ) {
    if (reason.trim().length < 5) {
      setMessage("請先輸入至少 5 個字元的異動原因。");
      return;
    }
    if (
      ["REVOKE", "MARK_LOST"].includes(action)
      && !window.confirm(
        action === "REVOKE"
          ? `確定撤銷「${device.displayName}」？現有離線 Permit 將立即失效。`
          : `確定將「${device.displayName}」標記為遺失？此裝置將無法同步。`,
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
    key: "maxOfflineDurationMinutes" | "maxPendingOrders" | "maxTotalAmount" | "maxSingleOrderAmount",
    value: string,
  ) {
    setPolicy((current) => ({ ...current, [key]: Number(value) }));
  }

  return (
    <div className="space-y-7">
      {!featureAvailable ? (
        <section className="border-y border-amber-300 bg-amber-50 px-4 py-4 text-amber-950">
          <div className="flex gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h2 className="font-semibold">離線收單模組尚未開放</h2>
              <p className="mt-1 text-sm">
                目前裝置維持線上操作；啟用模組後仍須由管理者核准裝置並指定唯一 Leader。
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
              離線收單政策
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              每個攤位僅允許一台核准裝置在斷線時建立訂單，其餘裝置維持唯讀。
            </p>
          </div>
          <span className={`text-sm font-semibold ${data.policy.offlineEnabled ? "text-emerald-700" : "text-stone-500"}`}>
            {data.policy.offlineEnabled ? "已啟用" : "已停用"}
          </span>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className={`flex min-h-12 items-center justify-between gap-3 rounded-md border border-stone-300 px-3 text-sm font-medium ${!featureAvailable ? "opacity-50" : ""}`}>
            <span>允許離線收單</span>
            <input
              type="checkbox"
              role="switch"
              checked={policy.offlineEnabled}
              disabled={!featureAvailable || busyKey !== null}
              onChange={(event) => setPolicy((current) => ({
                ...current,
                offlineEnabled: event.target.checked,
                offlineLeaderDeviceId: event.target.checked
                  ? current.offlineLeaderDeviceId
                  : null,
              }))}
              className="h-5 w-5"
            />
          </label>
          <label className="text-sm font-medium">
            Leader 裝置
            <select
              value={policy.offlineLeaderDeviceId ?? ""}
              disabled={!featureAvailable || !policy.offlineEnabled || busyKey !== null}
              onChange={(event) => setPolicy((current) => ({
                ...current,
                offlineLeaderDeviceId: event.target.value || null,
              }))}
              className="form-input mt-1"
            >
              <option value="">請選擇已登錄裝置</option>
              {leaderCandidates.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.displayName} · {device.platform}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            label="最長離線時間（分鐘）"
            min={15}
            max={720}
            value={policy.maxOfflineDurationMinutes}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("maxOfflineDurationMinutes", value)}
          />
          <NumberField
            label="待同步訂單上限"
            min={1}
            max={500}
            value={policy.maxPendingOrders}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("maxPendingOrders", value)}
          />
          <NumberField
            label="離線累計金額上限"
            min={0}
            max={99_999_999.99}
            value={policy.maxTotalAmount}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("maxTotalAmount", value)}
          />
          <NumberField
            label="單筆訂單金額上限"
            min={0}
            max={99_999_999.99}
            value={policy.maxSingleOrderAmount}
            disabled={!featureAvailable || busyKey !== null}
            onChange={(value) => updateLimit("maxSingleOrderAmount", value)}
          />
        </div>

        <label className="mt-5 block text-sm font-medium">
          異動原因
          <input
            type="text"
            value={reason}
            minLength={5}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：核准櫃台平板作為離線主機"
            className="form-input mt-1"
          />
        </label>
        <button
          type="button"
          disabled={!dirty || busyKey !== null || (!featureAvailable && policy.offlineEnabled)}
          onClick={() => void savePolicy()}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busyKey === "policy" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          儲存離線政策
        </button>
      </section>

      <section>
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
          <div>
            <h2 className="text-xl font-semibold">已登錄裝置</h2>
            <p className="mt-1 text-sm text-stone-600">
              裝置須先由店員端送出登錄，再由管理者核准。撤銷或遺失會使 Permit 失效。
            </p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
          {data.devices.length === 0 ? (
            <p className="py-6 text-sm text-stone-500">尚無裝置送出登錄申請。</p>
          ) : data.devices.map((device) => (
            <article key={device.id} className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{device.displayName}</h3>
                  <StatusBadge status={device.status} />
                  <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700">
                    {roleLabel(device.offlineRole)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-stone-600">
                  {device.platform} · 應用程式 {device.appVersion} · {device.pwaInstalled ? "已安裝 PWA" : "瀏覽器模式"}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  最後上線：{device.lastOnlineAt ? formatTaipeiDateTime(device.lastOnlineAt) : "尚無紀錄"}
                  {device.activePermitExpiresAt
                    ? ` · Permit 到期：${formatTaipeiDateTime(device.activePermitExpiresAt)}`
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
                    核准唯讀
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
                    停用
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
                      撤銷
                    </button>
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => void updateDevice(device, "MARK_LOST")}
                      className="inline-flex min-h-10 items-center gap-2 rounded-md border border-amber-400 px-3 text-xs font-semibold text-amber-800 disabled:opacity-50"
                    >
                      <TriangleAlert className="h-4 w-4" />
                      標記遺失
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <p className="text-xs leading-5 text-stone-500">
        瀏覽器儲存空間可能被系統清除；非持久儲存裝置會自動套用較低的時間、訂單與金額上限。
      </p>
      {message ? (
        <p
          role="status"
          className={`text-sm font-medium ${/(無法|失敗|請|不可|尚未)/.test(message) ? "text-red-700" : "text-emerald-700"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  min,
  max,
  value,
  disabled,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
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
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="form-input mt-1"
      />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles = status === "ACTIVE"
    ? "bg-emerald-50 text-emerald-800"
    : ["REVOKED", "LOST"].includes(status)
      ? "bg-red-50 text-red-800"
      : "bg-stone-100 text-stone-700";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${styles}`}>
      {({
        ACTIVE: "已核准",
        DISABLED: "待核准／已停用",
        REVOKED: "已撤銷",
        LOST: "已遺失",
        REPLACED: "已更換",
      } as Record<string, string>)[status] ?? status}
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
