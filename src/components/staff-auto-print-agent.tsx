"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { Printer, TriangleAlert } from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import { csrfHeaders } from "@/lib/csrf-client";
import { reportStarWebPrntFailure } from "@/lib/star-webprnt-diagnostics";
import type {
  PrinterView,
  PrintQueueCommandResponse,
  PrintQueueState,
} from "@/lib/print-center-types";
import {
  detectStarWebPrntEnvironment,
  isStarWebPrntSdkReady,
  openStarCashDrawer,
  printWithStarWebPrnt,
  probeStarWebPrnt,
  StarWebPrntError,
  STAR_WEBPRNT_SDK_LOAD_TIMEOUT_MS,
  withStarWebPrntDiagnostics,
} from "@/lib/star-webprnt-client";

const printQueueChangedEvent = "stallorder:print-queue-changed";

export function notifyStaffPrintQueueChanged(stallSlug: string) {
  window.dispatchEvent(new CustomEvent(printQueueChangedEvent, { detail: stallSlug }));
}

type AgentStatus = "CHECKING" | "READY" | "CONNECTED_NO_RULE" | "UNSUPPORTED" | "NOT_CONFIGURED" | "ERROR";
export type StaffAutoPrintState = { stallSlug: string; status: AgentStatus; detail: string };

export function StaffAutoPrintAgent({ stallSlug, onStatusChange }: {
  stallSlug: string;
  onStatusChange?: (state: StaffAutoPrintState) => void;
}) {
  const { t } = useOperationsLocale();
  const [environment, setEnvironment] = useState<ReturnType<typeof detectStarWebPrntEnvironment> | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [status, setStatus] = useState<AgentStatus>("CHECKING");
  const [detail, setDetail] = useState("");
  const busyRef = useRef(false);
  const activePrinterRef = useRef<PrinterView | null>(null);

  useEffect(() => {
    onStatusChange?.({ stallSlug, status, detail });
  }, [stallSlug, status, detail, onStatusChange]);

  useEffect(() => {
    const detectEnvironment = window.setTimeout(() => {
      const detected = detectStarWebPrntEnvironment(window.navigator.userAgent);
      setEnvironment(detected);
      if (detected === "STAR_WEBPRNT") {
        setScriptReady(isStarWebPrntSdkReady());
      } else {
        setStatus("UNSUPPORTED");
        setDetail(detected === "IOS_SAFARI"
          ? t("print.bluetooth.safariBlocked")
          : t("print.bluetooth.starBrowserRequired"));
      }
    }, 0);
    return () => window.clearTimeout(detectEnvironment);
  }, [t]);

  useEffect(() => {
    if (environment !== "STAR_WEBPRNT" || scriptReady) return;
    const watchdog = window.setTimeout(() => {
      const ready = isStarWebPrntSdkReady();
      setScriptReady(ready);
      if (!ready) {
        setStatus("ERROR");
        setDetail(t("print.bluetooth.bridgeFailed"));
      }
    }, STAR_WEBPRNT_SDK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(watchdog);
  }, [environment, scriptReady, t]);

  useEffect(() => {
    if (environment !== "STAR_WEBPRNT" || !scriptReady) return;
    let disposed = false;
    let refreshRequested = false;
    let snapshotRequest: AbortController | null = null;

    async function runAgent() {
      if (busyRef.current || disposed || document.hidden) return;
      busyRef.current = true;
      const checkoutPrinter = refreshRequested ? activePrinterRef.current : null;
      refreshRequested = false;
      let claimedJobId: string | null = null;
      let selectedPrinter: PrinterView | null = null;
      async function claimFromQueue() {
        const controller = new AbortController();
        snapshotRequest = controller;
        let refreshed;
        try {
          refreshed = await postPrintCommand(stallSlug, { operation: "REFRESH" }, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) return null;
          throw error;
        } finally {
          snapshotRequest = null;
        }
        if (disposed || controller.signal.aborted) return null;
        const printer = selectAutomaticPrinter(refreshed.state, stallSlug);
        selectedPrinter = printer;
        if (!printer) {
          activePrinterRef.current = null;
          setStatus("NOT_CONFIGURED");
          setDetail(t("print.agent.noPrinter"));
          return null;
        }

        await probeStarWebPrnt();
        if (disposed || document.visibilityState === "hidden") return null;
        activePrinterRef.current = printer;
        window.localStorage.setItem(`stallorder_printer_${stallSlug}`, printer.id);
        const automatic = hasAutomaticPrintRule(refreshed.state, printer.id);
        const job = automatic && [...refreshed.state.jobs].reverse().find((candidate) => (
          candidate.status === "PENDING"
          && candidate.printRule?.autoPrint
          && (!candidate.printer || candidate.printer.id === printer.id)
        ));
        if (!job) {
          await postPrintCommand(stallSlug, { operation: "HEARTBEAT", printerId: printer.id });
        }
        if (!automatic) {
          setStatus("CONNECTED_NO_RULE");
          setDetail(t("print.agent.noAutoRule"));
          return null;
        }
        setStatus("READY");
        setDetail(t("print.device.detected", { printer: printer.name }));
        if (!job) return null;
        const claimed = await postPrintCommand<Pick<PrintQueueCommandResponse, "printPayload">>(stallSlug, {
          operation: "CLAIM",
          jobId: job.id,
          printerId: printer.id,
        });
        return { entityId: job.id, printPayload: claimed.printPayload };
      }

      try {
        let claimed;
        if (checkoutPrinter) {
          selectedPrinter = checkoutPrinter;
          await probeStarWebPrnt();
          if (disposed || document.hidden) return;
          claimed = await postPrintCommand<{ entityId: string | null; printPayload?: PrintQueueCommandResponse["printPayload"] }>(
            stallSlug, { operation: "CLAIM_NEXT", printerId: checkoutPrinter.id },
          );
        } else {
          claimed = await claimFromQueue();
        }
        if (!claimed?.entityId) return;
        claimedJobId = claimed.entityId;
        if (!claimed.printPayload) throw new Error(t("print.bluetooth.payloadMissing"));
        await printWithStarWebPrnt(claimed.printPayload.dataBase64);
        claimedJobId = null;
        try {
          await postPrintCommand(stallSlug, { operation: "SUCCESS", jobId: claimed.entityId });
        } catch {
          setStatus("ERROR");
          setDetail(t("print.bluetooth.statusUnknown"));
          return;
        }
        setDetail(t("print.agent.printed"));
      } catch (error) {
        activePrinterRef.current = null;
        if (selectedPrinter) reportStarWebPrntFailure(stallSlug, selectedPrinter.id, claimedJobId ? "PRINT" : "PROBE", error);
        if (claimedJobId) {
          try {
            await postPrintCommand(stallSlug, {
              operation: "FAIL",
              jobId: claimedJobId,
              error: printAgentError(t, error),
            });
          } catch {
            // The server lease will mark an unknown result if recording also fails.
          }
        }
        setStatus("ERROR");
        setDetail(printAgentError(t, error));
      } finally {
        busyRef.current = false;
        if (refreshRequested && !disposed) void runAgent();
      }
    }

    function handleQueueChanged(event: Event) {
      if ((event as CustomEvent<string>).detail !== stallSlug) return;
      refreshRequested = true;
      if (activePrinterRef.current) snapshotRequest?.abort();
      void runAgent();
    }

    void runAgent();
    const timer = window.setInterval(() => void runAgent(), 5_000);
    document.addEventListener("visibilitychange", runAgent);
    window.addEventListener("pageshow", runAgent);
    window.addEventListener(printQueueChangedEvent, handleQueueChanged);
    return () => {
      disposed = true;
      snapshotRequest?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", runAgent);
      window.removeEventListener("pageshow", runAgent);
      window.removeEventListener(printQueueChangedEvent, handleQueueChanged);
    };
  }, [environment, scriptReady, stallSlug, t]);

  useEffect(() => {
    async function handleCashPayment() {
      let printer = activePrinterRef.current;
      if (!printer && environment === "STAR_WEBPRNT" && scriptReady) {
        try {
          const refreshed = await postPrintCommand(stallSlug, { operation: "REFRESH" });
          printer = selectAutomaticPrinter(refreshed.state, stallSlug);
          if (printer) {
            await probeStarWebPrnt();
            activePrinterRef.current = printer;
          }
        } catch (error) {
          setStatus("ERROR");
          setDetail(printAgentError(t, error));
          return;
        }
      }
      if (!printer?.openCashDrawerOnCashPayment) return;
      try {
        await openStarCashDrawer();
        setDetail(t("print.drawer.opened"));
      } catch (error) {
        activePrinterRef.current = null;
        reportStarWebPrntFailure(stallSlug, printer.id, "DRAWER", error);
        setStatus("ERROR");
        setDetail(printAgentError(t, error));
      }
    }
    window.addEventListener("stallorder:cash-payment-completed", handleCashPayment);
    return () => window.removeEventListener("stallorder:cash-payment-completed", handleCashPayment);
  }, [environment, scriptReady, stallSlug, t]);

  return <>
    {environment === "STAR_WEBPRNT" ? <Script
      src="/vendor/star-webprnt/StarWebPrintTrader-1.2.0.js"
      strategy="afterInteractive"
      integrity="sha256-0CXgr7eC9MfHOAgmVuwbMSnHbU6onTIP4w86ORtm9UQ="
      crossOrigin="anonymous"
      onReady={() => {
        const ready = isStarWebPrntSdkReady();
        setScriptReady(ready);
        if (!ready) {
          setStatus("ERROR");
          setDetail(t("print.bluetooth.bridgeFailed"));
        }
      }}
      onError={() => {
        setScriptReady(false);
        setStatus("ERROR");
        setDetail(t("print.bluetooth.bridgeFailed"));
      }}
    /> : null}
    <p
      id={`staff-printer-status-${stallSlug}`}
      data-testid="staff-printer-status"
      role="status"
      className={status === "READY" || status === "CHECKING" ? "sr-only" : "mt-2 flex min-h-8 items-center gap-2 border-y border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-950 print:hidden"}
    >
      {status === "READY" || status === "CHECKING" ? <Printer className="h-4 w-4 shrink-0" /> : <TriangleAlert className="h-4 w-4 shrink-0" />}
      <span>{detail || t("print.agent.checking")}</span>
    </p>
  </>;
}

function selectAutomaticPrinter(state: PrintQueueState, stallSlug: string) {
  const candidates = state.printers.filter((printer) => (
    printer.isEnabled
    && printer.autoDetectEnabled
    && printer.connectionType === "WEBPRNT_BLUETOOTH"
  ));
  const savedId = window.localStorage.getItem(`stallorder_printer_${stallSlug}`);
  return candidates.find((printer) => printer.id === savedId) ?? candidates[0] ?? null;
}

export function hasAutomaticPrintRule(state: Pick<PrintQueueState, "rules">, printerId: string) {
  return state.rules.some((rule) => (
    rule.printerId === printerId
    && rule.isEnabled
    && rule.autoPrint
  ));
}

async function postPrintCommand<T = PrintQueueCommandResponse>(stallSlug: string, command: Record<string, unknown>, signal?: AbortSignal) {
  const headers: Record<string, string> = csrfHeaders();
  if (command.operation === "CLAIM") headers["x-print-response"] = "ticket";
  if (["HEARTBEAT", "SUCCESS", "FAIL"].includes(String(command.operation))) headers["x-print-response"] = "ack";
  const response = await fetch(`/api/stalls/${stallSlug}/print-jobs`, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify(command),
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "PRINT_AGENT_REQUEST_FAILED");
  return payload;
}

function printAgentError(t: ReturnType<typeof useOperationsLocale>["t"], error: unknown) {
  return withStarWebPrntDiagnostics(translatedPrintAgentError(t, error), error);
}

function translatedPrintAgentError(t: ReturnType<typeof useOperationsLocale>["t"], error: unknown) {
  if (!(error instanceof StarWebPrntError)) {
    return error instanceof Error ? error.message : t("print.bluetooth.error.connection");
  }
  if (error.code === "PAPER_END") return t("print.bluetooth.error.paperEnd");
  if (error.code === "COVER_OPEN") return t("print.bluetooth.error.coverOpen");
  if (error.code === "OFFLINE") return t("print.bluetooth.error.offline");
  if (error.code === "PRINT_REJECTED") return t("print.bluetooth.error.rejected");
  if (error.code === "PRINTER_BUSY") return t("print.bluetooth.error.busy");
  if (error.code === "BRIDGE_UNRESPONSIVE") return t("print.bluetooth.error.bridgeUnresponsive");
  if (error.code === "TIMEOUT") return t("print.bluetooth.error.timeout");
  if (["CUTTER_ERROR", "ROLL_POSITION_ERROR", "HIGH_TEMPERATURE", "NON_RECOVERABLE"].includes(error.code)) {
    return t("print.bluetooth.error.hardware");
  }
  return t("print.bluetooth.error.connection");
}
