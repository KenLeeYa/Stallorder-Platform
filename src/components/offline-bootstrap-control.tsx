"use client";

import { useEffect, useState } from "react";
import {
  DatabaseZap,
  HardDriveDownload,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import {
  OFFLINE_APP_PROTOCOL_VERSION,
  type OfflineStorageClass,
} from "@/offline/offline-contract";
import {
  getAllOfflineRecords,
  saveOfflineBootstrap,
} from "@/offline/offline-db";
import {
  assessStorageCapability,
  type StorageCapability,
} from "@/offline/storage-capability";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatAppDateTime } from "@/lib/locale-format";
import { getOperationsErrorMessage } from "@/lib/messages/operations";
import { createWebUuid } from "@/lib/web-uuid";

type DeviceRegistrationResponse = {
  device: {
    id: string;
    installationId: string;
    displayName: string;
    platform: string;
    appVersion: string;
    pwaInstalled: boolean;
    offlineEnabled: boolean;
    offlineRole: string;
    status: string;
  };
  approvalRequired: boolean;
  error?: string;
  code?: string;
};

type OfflineBootstrapResponse = {
  permitToken: string;
  permit: {
    permitId: string;
    deviceId: string;
    profileId: string;
    organizationId: string;
    stallId: string;
    roles: string[];
    allowedOfflineActions: string[];
    issuedAt: string;
    expiresAt: string;
    menuSnapshotVersion: number;
    promotionEpoch: string;
    appProtocolVersion: string;
    storageClass: OfflineStorageClass;
    riskLimits: {
      maxOfflineDurationMinutes: number;
      maxPendingOrders: number;
      maxTotalAmount: number;
      maxSingleOrderAmount: number;
      maxManualPaymentAmount: number;
      maxTotalManualPaymentAmount: number;
      requireCustomerContactAboveAmount: number;
      managerApprovalThreshold: number;
    };
  };
  device: DeviceRegistrationResponse["device"];
  menuSnapshot: {
    id: string;
    version: number;
    contentHash: string;
    currency: string;
    generatedAt: string;
    expiresAt: string;
    catalog: Record<string, unknown>;
    publicSnapshot: {
      contentHash: string;
      objectPath: string;
      path: string;
    };
  };
  cashShift: {
    id: string;
    stallId: string;
    status: "OPEN";
    openingAmount: number;
    openedAt: string;
    cashSales: number;
    cashIn: number;
    cashOut: number;
    cashRefund: number;
    correction: number;
    expectedAmount: number;
  } | null;
  error?: string;
  code?: string;
};

type LocalState = "UNKNOWN" | "PENDING" | "READ_ONLY" | "READY" | "ERROR";

function installationStorageKey(stallSlug: string) {
  return `stallorder:offline-installation:${stallSlug}`;
}

function getOrCreateInstallationId(stallSlug: string) {
  const key = installationStorageKey(stallSlug);
  const current = window.localStorage.getItem(key);
  if (current && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current)) {
    return current;
  }
  const next = createWebUuid();
  window.localStorage.setItem(key, next);
  return next;
}

function detectPlatform() {
  const platform = navigator.platform?.trim();
  return (platform || "Web").slice(0, 80);
}

function isPwaInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}

export function OfflineBootstrapControl({
  stallId,
  stallSlug,
  appVersion,
}: {
  stallId: string;
  stallSlug: string;
  appVersion: string;
}) {
  const { locale, t } = useOperationsLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<LocalState>("UNKNOWN");
  const [message, setMessage] = useState("");
  const [storage, setStorage] = useState<StorageCapability | null>(null);
  const [permitExpiresAt, setPermitExpiresAt] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function initializeLocalState() {
      await Promise.resolve();
      if (cancelled) return;
      setDisplayName(`${detectPlatform()} ${isPwaInstalled() ? "PWA" : t("offline.bootstrap.browser")}`);
      try {
        const records = await getAllOfflineRecords("offline_permit");
        if (cancelled) return;
        const active = records.find((record) => (
          record.stall_id === stallId
          && typeof record.expires_at === "string"
          && Date.parse(record.expires_at) > Date.now()
        ));
        if (active && typeof active.expires_at === "string") {
          setState("READY");
          setPermitExpiresAt(active.expires_at);
        }
      } catch {
        // IndexedDB capability is reported when the operator explicitly checks the device.
      }
    }
    void initializeLocalState();
    return () => {
      cancelled = true;
    };
  }, [stallId, t]);

  async function postJson<T>(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: csrfHeaders(),
      body: JSON.stringify(body),
    });
    const payload = await response.json() as T & { error?: string; code?: string };
    if (!response.ok) throw new Error(getOperationsErrorMessage(locale, payload.code, "offline.bootstrap.error.generic"));
    return payload;
  }

  async function registerAndBootstrap() {
    const safeName = displayName.trim();
    if (!safeName) {
      setMessage(t("offline.bootstrap.nameRequired"));
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const capability = await assessStorageCapability();
      setStorage(capability);
      const installationId = getOrCreateInstallationId(stallSlug);
      const registration = await postJson<DeviceRegistrationResponse>(
        `/api/stalls/${stallSlug}/offline/devices`,
        {
          installationId,
          displayName: safeName,
          platform: detectPlatform(),
          appVersion,
          pwaInstalled: isPwaInstalled(),
        },
      );

      if (
        capability.classification === "INSUFFICIENT"
        || capability.classification === "UNAVAILABLE"
      ) {
        setState("READ_ONLY");
        setMessage(t("offline.bootstrap.readOnlyStorage"));
        return;
      }
      if (
        registration.device.status !== "ACTIVE"
        || !registration.device.offlineEnabled
      ) {
        setState("PENDING");
        setMessage(t("offline.bootstrap.pendingApproval"));
        return;
      }
      if (registration.device.offlineRole !== "OFFLINE_LEADER") {
        setState("READ_ONLY");
        setMessage(t("offline.bootstrap.leaderRequired"));
        return;
      }

      const bootstrap = await postJson<OfflineBootstrapResponse>(
        `/api/stalls/${stallSlug}/offline/bootstrap`,
        {
          installationId,
          storageClass: capability.classification,
          requestedDurationMinutes: 120,
          appProtocolVersion: OFFLINE_APP_PROTOCOL_VERSION,
        },
      );
      await saveOfflineBootstrap({
        deviceProfile: {
          id: bootstrap.device.id,
          installation_id: installationId,
          organization_id: bootstrap.permit.organizationId,
          stall_id: bootstrap.permit.stallId,
          profile_id: bootstrap.permit.profileId,
          display_name: bootstrap.device.displayName,
          offline_role: bootstrap.device.offlineRole,
          status: bootstrap.device.status,
        },
        permit: {
          permit_id: bootstrap.permit.permitId,
          stall_id: bootstrap.permit.stallId,
          device_id: bootstrap.permit.deviceId,
          token: bootstrap.permitToken,
          roles: bootstrap.permit.roles,
          allowed_offline_actions: bootstrap.permit.allowedOfflineActions,
          issued_at: bootstrap.permit.issuedAt,
          expires_at: bootstrap.permit.expiresAt,
          menu_snapshot_version: bootstrap.permit.menuSnapshotVersion,
          promotion_epoch: bootstrap.permit.promotionEpoch,
          storage_class: bootstrap.permit.storageClass,
          risk_limits: bootstrap.permit.riskLimits,
        },
        menuSnapshot: {
          version: bootstrap.menuSnapshot.version,
          id: bootstrap.menuSnapshot.id,
          stall_id: bootstrap.permit.stallId,
          content_hash: bootstrap.menuSnapshot.contentHash,
          currency: bootstrap.menuSnapshot.currency,
          generated_at: bootstrap.menuSnapshot.generatedAt,
          expires_at: bootstrap.menuSnapshot.expiresAt,
          catalog: bootstrap.menuSnapshot.catalog,
          public_snapshot: bootstrap.menuSnapshot.publicSnapshot,
        },
        stallSettings: {
          stall_id: bootstrap.permit.stallId,
          organization_id: bootstrap.permit.organizationId,
          menu_snapshot_version: bootstrap.menuSnapshot.version,
          catalog: bootstrap.menuSnapshot.catalog,
          public_snapshot: bootstrap.menuSnapshot.publicSnapshot,
          risk_limits: bootstrap.permit.riskLimits,
        },
        availability: {
          id: bootstrap.permit.stallId,
          storage_class: capability.classification,
          persisted: capability.persisted,
          usage_bytes: capability.usageBytes,
          quota_bytes: capability.quotaBytes,
          available_bytes: capability.availableBytes,
          usage_percent: capability.usagePercent,
          assessed_at: new Date().toISOString(),
        },
        cashShiftSnapshot: bootstrap.cashShift ? {
          stall_id: bootstrap.permit.stallId,
          shift_id: bootstrap.cashShift.id,
          status: bootstrap.cashShift.status,
          opening_amount: bootstrap.cashShift.openingAmount,
          opened_at: bootstrap.cashShift.openedAt,
          cash_sales: bootstrap.cashShift.cashSales,
          cash_in: bootstrap.cashShift.cashIn,
          cash_out: bootstrap.cashShift.cashOut,
          cash_refund: bootstrap.cashShift.cashRefund,
          correction: bootstrap.cashShift.correction,
          expected_amount: bootstrap.cashShift.expectedAmount,
          pending_events: [],
        } : {
          stall_id: bootstrap.permit.stallId,
          shift_id: null,
          status: "NONE",
          pending_events: [],
        },
      });
      window.dispatchEvent(new CustomEvent("stallorder:offline-data-changed"));
      setState("READY");
      setPermitExpiresAt(bootstrap.permit.expiresAt);
      setMessage(t("offline.bootstrap.readyMessage"));
    } catch (error) {
      setState("ERROR");
      setMessage(error instanceof Error ? error.message : t("offline.bootstrap.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        title={t("staff.action.offlineDevice")}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-md border ${
          state === "READY"
            ? "border-emerald-600 bg-emerald-50 text-emerald-800"
            : "border-stone-300 bg-white text-stone-700"
        }`}
      >
        <DatabaseZap className="h-4 w-4" />
        <span className="sr-only">{t("staff.action.offlineDevice")}</span>
      </button>
      {open ? (
        <section
          aria-label={t("staff.action.offlineDevice")}
          className="fixed inset-x-4 top-20 z-50 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-md border border-stone-300 bg-white p-4 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-5 w-5 text-teal-700" />
                {t("staff.action.offlineDevice")}
              </h2>
              <p className="mt-1 text-xs leading-5 text-stone-600">
                {t("offline.bootstrap.description")}
              </p>
            </div>
            <button
              type="button"
              title={t("offline.bootstrap.close")}
              onClick={() => setOpen(false)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <label className="mt-4 block text-sm font-medium">
            {t("offline.bootstrap.deviceName")}
            <input
              type="text"
              value={displayName}
              maxLength={80}
              disabled={busy}
              onChange={(event) => setDisplayName(event.target.value)}
              className="form-input mt-1"
            />
          </label>
          <div className="mt-4 border-y border-stone-200 py-3 text-xs text-stone-600">
            <p>{t("offline.bootstrap.localState", { state: stateLabel(state, t) })}</p>
            <p className="mt-1">
              {t("offline.bootstrap.storageCapability", { storage: storageLabel(storage?.classification ?? null, t) })}
            </p>
            {permitExpiresAt ? (
              <p className="mt-1">
                {t("offline.bootstrap.permitExpires", { time: formatAppDateTime(locale, permitExpiresAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }) })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void registerAndBootstrap()}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
            {state === "READY" ? t("offline.bootstrap.refresh") : t("offline.bootstrap.register")}
          </button>
          {message ? (
            <p
              role="status"
              className={`mt-3 text-xs leading-5 ${state === "ERROR" ? "text-red-700" : "text-stone-700"}`}
            >
              {message}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

type OperationsTranslator = ReturnType<typeof useOperationsLocale>["t"];

function storageLabel(storageClass: OfflineStorageClass | null, t: OperationsTranslator) {
  switch (storageClass) {
    case "PERSISTENT": return t("offline.bootstrap.storage.persistent");
    case "BEST_EFFORT": return t("offline.bootstrap.storage.bestEffort");
    case "INSUFFICIENT": return t("offline.bootstrap.storage.insufficient");
    default: return t("offline.bootstrap.storage.unavailable");
  }
}

function stateLabel(state: LocalState, t: OperationsTranslator) {
  switch (state) {
    case "PENDING": return t("offline.bootstrap.state.pending");
    case "READ_ONLY": return t("offline.bootstrap.state.readOnly");
    case "READY": return t("offline.bootstrap.state.ready");
    case "ERROR": return t("offline.bootstrap.state.error");
    default: return t("offline.bootstrap.state.unknown");
  }
}
