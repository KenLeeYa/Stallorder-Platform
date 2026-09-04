"use client";

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleAlert, WifiOff } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAppLocale } from "@/components/locale-provider";
import {
  readWakeLockPreference,
  writeWakeLockPreference,
} from "@/components/wake-lock-preference";

const PwaUpdateController = lazy(() => import("@/components/pwa-update-controller")
  .then((module) => ({ default: module.PwaUpdateController })));

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
  const pathname = usePathname();
  const [online, setOnline] = useState(true);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [effectiveType, setEffectiveType] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [wakeLockSupported, setWakeLockSupported] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeLockRequestedRef = useRef(false);
  const activeMutationsRef = useRef(0);

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
    if (wakeLockRef.current && !wakeLockRef.current.released) return true;
    try {
      const sentinel = await wakeLockApi.request("screen");
      if (!wakeLockRequestedRef.current) {
        await sentinel.release();
        return false;
      }
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
      writeWakeLockPreference(window.localStorage, false);
      const current = wakeLockRef.current;
      wakeLockRef.current = null;
      if (current && !current.released) await current.release();
      setWakeLockActive(false);
      return false;
    }
    wakeLockRequestedRef.current = true;
    writeWakeLockPreference(window.localStorage, true);
    return requestWakeLock();
  }, [requestWakeLock]);

  const requestInstall = useCallback(async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    return choice.outcome === "accepted";
  }, [installPrompt]);

  useEffect(() => {
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
      window.clearTimeout(initialCheck);
      window.clearInterval(timer);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", clearInstallPrompt);
      connection?.removeEventListener("change", updateConnection);
    };
  }, [measureConnection, updateConnection]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (!navigator.onLine && !["GET", "HEAD", "OPTIONS"].includes(method)) {
        return Promise.reject(new Error("OFFLINE_READ_ONLY"));
      }
      if (["GET", "HEAD", "OPTIONS"].includes(method)) return originalFetch(input, init);
      activeMutationsRef.current += 1;
      try {
        return originalFetch(input, init).finally(() => {
          activeMutationsRef.current = Math.max(0, activeMutationsRef.current - 1);
        });
      } catch (error) {
        activeMutationsRef.current = Math.max(0, activeMutationsRef.current - 1);
        throw error;
      }
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
    wakeLockRequestedRef.current = readWakeLockPreference(window.localStorage);
  }, []);

  useEffect(() => {
    if (
      document.visibilityState === "visible"
      && wakeLockRequestedRef.current
      && !wakeLockRef.current
    ) {
      void requestWakeLock();
    }
  }, [pathname, requestWakeLock]);

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
  }), [
    effectiveType,
    installPrompt,
    latencyMs,
    online,
    quality,
    requestInstall,
    toggleWakeLock,
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
      <Suspense fallback={null}>
        <PwaUpdateController activeMutationsRef={activeMutationsRef} />
      </Suspense>
      {children}
    </PwaContext.Provider>
  );
}

export function usePwaRuntime() {
  const value = useContext(PwaContext);
  if (!value) throw new Error("usePwaRuntime must be used within PwaRuntime");
  return value;
}
