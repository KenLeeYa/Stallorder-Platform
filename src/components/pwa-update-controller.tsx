"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { RefreshCw } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";

const SERVICE_WORKER_ENABLED = process.env.NODE_ENV === "production"
  || process.env.NEXT_PUBLIC_ENABLE_PWA_IN_DEVELOPMENT === "true";
const SERVICE_WORKER_UPDATE_INTERVAL_MS = 5 * 60_000;
const SAFE_AUTO_UPDATE_IDLE_MS = 30_000;
const CLIENT_BUILD_REVISION = process.env.NEXT_PUBLIC_STALLORDER_BUILD_REVISION ?? "local";

export function PwaUpdateController({ activeMutationsRef }: {
  activeMutationsRef: MutableRefObject<number>;
}) {
  const { t } = useAppLocale();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateBlocked, setUpdateBlocked] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const deploymentUpdateAvailableRef = useRef(false);
  const applyingUpdateRef = useRef(false);
  const lastInteractionAtRef = useRef(0);
  const updateSafetyPendingRef = useRef<number | null>(null);
  const autoUpdateTimerRef = useRef<number | null>(null);

  const applyServiceWorkerUpdate = useCallback(() => {
    const worker = waitingWorkerRef.current;
    if (!worker && !deploymentUpdateAvailableRef.current) return;
    if (
      (updateSafetyPendingRef.current ?? 1) > 0
      || activeMutationsRef.current > 0
      || hasUnsavedFormChanges()
    ) {
      setUpdateBlocked(true);
      navigator.serviceWorker.controller?.postMessage({ type: "CHECK_UPDATE_SAFETY" });
      return;
    }
    applyingUpdateRef.current = true;
    setUpdateBlocked(false);
    if (worker) worker.postMessage({ type: "ACTIVATE_UPDATE" });
    else window.location.reload();
  }, [activeMutationsRef]);

  useEffect(() => {
    lastInteractionAtRef.current = Date.now();
    let disposed = false;
    let serviceWorkerUpdateTimer: number | null = null;
    let activeRegistration: ServiceWorkerRegistration | null = null;
    const clearAutoUpdateTimer = () => {
      if (autoUpdateTimerRef.current !== null) window.clearTimeout(autoUpdateTimerRef.current);
      autoUpdateTimerRef.current = null;
    };
    const scheduleSafeAutoUpdate = () => {
      clearAutoUpdateTimer();
      if (
        (!waitingWorkerRef.current && !deploymentUpdateAvailableRef.current)
        || (updateSafetyPendingRef.current ?? 1) > 0
      ) return;
      const remainingIdle = Math.max(
        0,
        SAFE_AUTO_UPDATE_IDLE_MS - (Date.now() - lastInteractionAtRef.current),
      );
      autoUpdateTimerRef.current = window.setTimeout(() => {
        const hasUnsavedChanges = hasUnsavedFormChanges();
        const stillActive = Date.now() - lastInteractionAtRef.current < SAFE_AUTO_UPDATE_IDLE_MS;
        if (
          disposed
          || document.visibilityState !== "visible"
          || !navigator.onLine
          || (!waitingWorkerRef.current && !deploymentUpdateAvailableRef.current)
          || (updateSafetyPendingRef.current ?? 1) > 0
          || activeMutationsRef.current > 0
          || stillActive
          || hasUnsavedChanges
        ) {
          setUpdateBlocked(
            hasUnsavedChanges
            || activeMutationsRef.current > 0
            || (updateSafetyPendingRef.current ?? 0) > 0,
          );
          autoUpdateTimerRef.current = window.setTimeout(
            scheduleSafeAutoUpdate,
            SAFE_AUTO_UPDATE_IDLE_MS,
          );
          return;
        }
        applyingUpdateRef.current = true;
        const worker = waitingWorkerRef.current;
        if (worker) worker.postMessage({ type: "ACTIVATE_UPDATE" });
        else window.location.reload();
      }, Math.max(remainingIdle, 1_000));
    };
    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_UPDATE_AVAILABLE") setUpdateAvailable(true);
      if (event.data?.type === "SW_UPDATE_SAFETY") {
        updateSafetyPendingRef.current = Number(event.data.pendingRecords ?? 0);
        setUpdateBlocked(updateSafetyPendingRef.current > 0 || hasUnsavedFormChanges());
        if (updateSafetyPendingRef.current === 0) scheduleSafeAutoUpdate();
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

    const checkForUpdate = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void activeRegistration?.update();
      waitingWorkerRef.current?.postMessage({ type: "CHECK_UPDATE_SAFETY" });
      void fetch(`/api/version?current=${encodeURIComponent(CLIENT_BUILD_REVISION)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      }).then(async (response) => {
        if (!response.ok || disposed) return;
        const payload = await response.json() as { revision?: unknown };
        if (
          typeof payload.revision !== "string"
          || payload.revision.length === 0
          || payload.revision === CLIENT_BUILD_REVISION
        ) return;
        deploymentUpdateAvailableRef.current = true;
        updateSafetyPendingRef.current = null;
        setUpdateAvailable(true);
        const controller = navigator.serviceWorker.controller;
        if (controller) controller.postMessage({ type: "CHECK_UPDATE_SAFETY" });
        else {
          updateSafetyPendingRef.current = 0;
          setUpdateBlocked(hasUnsavedFormChanges());
          scheduleSafeAutoUpdate();
        }
      }).catch(() => undefined);
    };

    if ("serviceWorker" in navigator && SERVICE_WORKER_ENABLED) {
      navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
      void navigator.serviceWorker.register("/sw.js?pwa-enabled=1", { scope: "/" }).then((registration) => {
        if (!registration || disposed) return;
        const markWaiting = (worker: ServiceWorker) => {
          waitingWorkerRef.current = worker;
          updateSafetyPendingRef.current = null;
          setUpdateAvailable(true);
          worker.postMessage({ type: "CHECK_UPDATE_SAFETY" });
        };
        activeRegistration = registration;
        if (registration.waiting && navigator.serviceWorker.controller) markWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) markWaiting(worker);
          });
        });
        serviceWorkerUpdateTimer = window.setInterval(
          checkForUpdate,
          SERVICE_WORKER_UPDATE_INTERVAL_MS,
        );
        checkForUpdate();
      }).catch(() => undefined);
    }

    const markInteraction = () => {
      lastInteractionAtRef.current = Date.now();
      if (waitingWorkerRef.current || deploymentUpdateAvailableRef.current) scheduleSafeAutoUpdate();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    window.addEventListener("focus", checkForUpdate);
    window.addEventListener("pointerdown", markInteraction, { passive: true });
    window.addEventListener("keydown", markInteraction);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      if (serviceWorkerUpdateTimer !== null) window.clearInterval(serviceWorkerUpdateTimer);
      clearAutoUpdateTimer();
      window.removeEventListener("focus", checkForUpdate);
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
    };
  }, [activeMutationsRef]);

  if (!updateAvailable) return null;
  return (
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
  );
}

export function hasUnsavedFormChanges(root: ParentNode = document) {
  for (const element of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")) {
    if (element.disabled || element.closest("[data-update-ignore-dirty='true']")) continue;
    if (element instanceof HTMLInputElement) {
      if (["button", "submit", "reset", "hidden", "search"].includes(element.type)) continue;
      if (["checkbox", "radio"].includes(element.type)) {
        if (element.checked !== element.defaultChecked) return true;
      } else if (!element.readOnly && element.value !== element.defaultValue) return true;
      continue;
    }
    if (element instanceof HTMLTextAreaElement) {
      if (!element.readOnly && element.value !== element.defaultValue) return true;
      continue;
    }
    if ([...element.options].some((option) => option.selected !== option.defaultSelected)) return true;
  }
  return false;
}
