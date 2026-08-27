"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleAlert, RefreshCw, WifiOff } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";

const SERVICE_WORKER_ENABLED = process.env.NODE_ENV === "production"
  || process.env.NEXT_PUBLIC_ENABLE_PWA_IN_DEVELOPMENT === "true";

type NetworkQuality = "GOOD" | "POOR" | "OFFLINE";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type NetworkInformation = EventTarget & {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

type WakeLockSentinel = EventTarget & {
  released: boolean;
  release: () => Promise<void>;
};

type PwaContextValue = {
  online: boolean;
  quality: NetworkQuality;
  latencyMs: number | null;
  effectiveType: string | null;
  installAvailable: boolean;
  requestInstall: () => Promise<boolean>;
  wakeLockSupported: boolean;
  wakeLockActive: boolean;
  toggleWakeLock: () => Promise<boolean>;
  updateAvailable: boolean;
  updateBlocked: boolean;
  applyServiceWorkerUpdate: () => void;
};

const PwaContext = createContext<PwaContextValue | null>(null);

function connectionInfo() {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection ?? null;
}

function detectedQuality(online: boolean, latencyMs: number | null) {
  if (!online) return "OFFLINE" as const;
  const connection = connectionInfo();
  if (
    connection?.saveData
    || connection?.effectiveType === "slow-2g"
    || connection?.effectiveType === "2g"
    || (connection?.rtt ?? 0) >= 1_200
    || (connection?.downlink ?? Number.POSITIVE_INFINITY) < 0.5
    || (latencyMs ?? 0) >= 2_000
  ) return "POOR" as const;
  return "GOOD" as const;
}

export function PwaRuntime({ children }: { children: ReactNode }) {
  const { t } = useAppLocale();
  const [online, setOnline] = useState(true);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [effectiveType, setEffectiveType] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [wakeLockSupported, setWakeLockSupported] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateBlocked, setUpdateBlocked] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeLockRequestedRef = useRef(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const applyingUpdateRef = useRef(false);

  const updateConnection = useCallback(() => {
    const nextOnline = navigator.onLine;
    setOnline(nextOnline);
    setEffectiveType(connectionInfo()?.effectiveType ?? null);
    setWakeLockSupported("wakeLock" in navigator);
    if (!nextOnline) setLatencyMs(null);
  }, []);

  const measureConnection = useCallback(async () => {
    updateConnection();
    if (!navigator.onLine) return;
    const startedAt = performance.now();
    try {
      const response = await fetch(`/api/health?pwa=${Date.now()}`, {
        method: "HEAD",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("HEALTH_CHECK_FAILED");
      setLatencyMs(Math.round(performance.now() - startedAt));
    } catch {
      setLatencyMs(null);
    }
  }, [updateConnection]);

  const requestWakeLock = useCallback(async () => {
    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    }).wakeLock;
    if (!wakeLockApi || document.visibilityState !== "visible") return false;
    try {
      const sentinel = await wakeLockApi.request("screen");
      wakeLockRef.current = sentinel;
      setWakeLockActive(true);
      sentinel.addEventListener("release", () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
        setWakeLockActive(false);
      }, { once: true });
      return true;
    } catch {
      setWakeLockActive(false);
      return false;
    }
  }, []);

  const toggleWakeLock = useCallback(async () => {
    if (wakeLockRequestedRef.current) {
      wakeLockRequestedRef.current = false;
      const current = wakeLockRef.current;
      wakeLockRef.current = null;
      if (current && !current.released) await current.release();
      setWakeLockActive(false);
      return false;
    }
    wakeLockRequestedRef.current = true;
    return requestWakeLock();
  }, [requestWakeLock]);

  const requestInstall = useCallback(async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    return choice.outcome === "accepted";
  }, [installPrompt]);

  const applyServiceWorkerUpdate = useCallback(() => {
    const worker = waitingWorkerRef.current;
    if (!worker) return;
    applyingUpdateRef.current = true;
    setUpdateBlocked(false);
    worker.postMessage({ type: "ACTIVATE_UPDATE" });
  }, []);

  useEffect(() => {
    let disposed = false;
    let serviceWorkerUpdateTimer: number | null = null;
    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_UPDATE_AVAILABLE") setUpdateAvailable(true);
      if (event.data?.type === "SW_UPDATE_SAFETY") {
        setUpdateBlocked((event.data.pendingRecords ?? 0) > 0);
      }
      if (event.data?.type === "SW_UPDATE_BLOCKED") {
        applyingUpdateRef.current = false;
        setUpdateBlocked(true);
        setUpdateAvailable(true);
      }
    };
    const onControllerChange = () => {
      if (applyingUpdateRef.current) window.location.reload();
    };

    if ("serviceWorker" in navigator && !SERVICE_WORKER_ENABLED) {
      void (async () => {
        const hadController = Boolean(navigator.serviceWorker.controller);
        const registrations = await navigator.serviceWorker.getRegistrations();
        const unregistered = await Promise.all(
          registrations.map((registration) => registration.unregister()),
        );
        if ("caches" in window) {
          const keys = await window.caches.keys();
          await Promise.all(
            keys
              .filter((key) => key.startsWith("stallorder-shell-"))
              .map((key) => window.caches.delete(key)),
          );
        }
        if (!disposed && hadController && unregistered.some(Boolean)) window.location.reload();
      })().catch(() => undefined);
    }

    if ("serviceWorker" in navigator && SERVICE_WORKER_ENABLED) {
      navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
      void navigator.serviceWorker.register("/sw.js?pwa-enabled=1", { scope: "/" }).then((registration) => {
        if (disposed) return;
        const markWaiting = (worker: ServiceWorker) => {
          waitingWorkerRef.current = worker;
          setUpdateAvailable(true);
          worker.postMessage({ type: "CHECK_UPDATE_SAFETY" });
        };
        if (registration.waiting && navigator.serviceWorker.controller) {
          markWaiting(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              markWaiting(worker);
            }
          });
        });
        serviceWorkerUpdateTimer = window.setInterval(
          () => void registration.update(),
          60 * 60_000,
        );
      });
    }

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const clearInstallPrompt = () => setInstallPrompt(null);
    const connection = connectionInfo();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", clearInstallPrompt);
    connection?.addEventListener("change", updateConnection);
    const initialCheck = window.setTimeout(() => void measureConnection(), 0);
    const timer = window.setInterval(() => void measureConnection(), 30_000);
    return () => {
      disposed = true;
      window.clearTimeout(initialCheck);
      window.clearInterval(timer);
      if (serviceWorkerUpdateTimer !== null) window.clearInterval(serviceWorkerUpdateTimer);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", clearInstallPrompt);
      connection?.removeEventListener("change", updateConnection);
      navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
    };
  }, [measureConnection, updateConnection]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (!navigator.onLine && !["GET", "HEAD", "OPTIONS"].includes(method)) {
        return Promise.reject(new Error("OFFLINE_READ_ONLY"));
      }
      return originalFetch(input, init);
    };
    const preventOfflineSubmit = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!navigator.onLine && form && form.method.toUpperCase() !== "GET") {
        event.preventDefault();
      }
    };
    document.addEventListener("submit", preventOfflineSubmit, true);
    return () => {
      window.fetch = originalFetch;
      document.removeEventListener("submit", preventOfflineSubmit, true);
    };
  }, []);

  useEffect(() => {
    const restoreWakeLock = () => {
      if (
        document.visibilityState === "visible"
        && wakeLockRequestedRef.current
        && !wakeLockRef.current
      ) {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", restoreWakeLock);
    return () => document.removeEventListener("visibilitychange", restoreWakeLock);
  }, [requestWakeLock]);

  const quality = detectedQuality(online, latencyMs);
  const value = useMemo<PwaContextValue>(() => ({
    online,
    quality,
    latencyMs,
    effectiveType,
    installAvailable: Boolean(installPrompt),
    requestInstall,
    wakeLockSupported,
    wakeLockActive,
    toggleWakeLock,
    updateAvailable,
    updateBlocked,
    applyServiceWorkerUpdate,
  }), [
    applyServiceWorkerUpdate,
    effectiveType,
    installPrompt,
    latencyMs,
    online,
    quality,
    requestInstall,
    toggleWakeLock,
    updateAvailable,
    updateBlocked,
    wakeLockActive,
    wakeLockSupported,
  ]);

  return (
    <PwaContext.Provider value={value}>
      {quality !== "GOOD" ? (
        <div
          role="status"
          className={`sticky top-0 z-50 flex min-h-9 items-center justify-center gap-2 px-4 py-2 text-center text-xs font-semibold ${
            quality === "OFFLINE" ? "bg-red-700 text-white" : "bg-amber-100 text-amber-950"
          }`}
        >
          {quality === "OFFLINE"
            ? <WifiOff className="h-4 w-4 shrink-0" />
            : <CircleAlert className="h-4 w-4 shrink-0" />}
          {quality === "OFFLINE"
            ? t("pwa.runtime.offline")
            : latencyMs
              ? t("pwa.runtime.poorNetworkLatency", { latency: latencyMs })
              : t("pwa.runtime.poorNetwork")}
        </div>
      ) : null}
      {updateAvailable ? (
        <div
          role="status"
          className="sticky top-0 z-50 flex min-h-10 flex-wrap items-center justify-center gap-3 bg-emerald-50 px-4 py-2 text-center text-xs font-semibold text-emerald-950"
        >
          <span>{updateBlocked ? t("pwa.runtime.updateBlocked") : t("pwa.runtime.updateReady")}</span>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-2 border border-emerald-800 bg-white px-3 py-1.5 text-emerald-950"
            onClick={applyServiceWorkerUpdate}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t("pwa.runtime.safeUpdate")}
          </button>
        </div>
      ) : null}
      {children}
    </PwaContext.Provider>
  );
}

export function usePwaRuntime() {
  const value = useContext(PwaContext);
  if (!value) throw new Error("usePwaRuntime must be used within PwaRuntime");
  return value;
}
