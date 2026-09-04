"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { Printer, TriangleAlert } from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import { csrfHeaders } from "@/lib/csrf-client";
import type {
  PrinterView,
  PrintJobView,
  PrintQueueCommandResponse,
  PrintQueueState,
} from "@/lib/print-center-types";
import {
  detectStarWebPrntEnvironment,
  openStarCashDrawer,
  printWithStarWebPrnt,
  probeStarWebPrnt,
  StarWebPrntError,
} from "@/lib/star-webprnt-client";

type AgentStatus = "CHECKING" | "READY" | "UNSUPPORTED" | "NOT_CONFIGURED" | "ERROR";

export function StaffAutoPrintAgent({ stallSlug }: { stallSlug: string }) {
  const { t } = useOperationsLocale();
  const [environment, setEnvironment] = useState<ReturnType<typeof detectStarWebPrntEnvironment> | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [status, setStatus] = useState<AgentStatus>("CHECKING");
  const [detail, setDetail] = useState("");
  const busyRef = useRef(false);
  const activePrinterRef = useRef<PrinterView | null>(null);

  useEffect(() => {
    const detectEnvironment = window.setTimeout(() => {
      const detected = detectStarWebPrntEnvironment(window.navigator.userAgent);
      setEnvironment(detected);
      if (detected !== "STAR_WEBPRNT") {
        setStatus("UNSUPPORTED");
        setDetail(detected === "IOS_SAFARI"
          ? t("print.bluetooth.safariBlocked")
          : t("print.bluetooth.starBrowserRequired"));
      }
    }, 0);
    return () => window.clearTimeout(detectEnvironment);
  }, [t]);

  useEffect(() => {
    if (environment !== "STAR_WEBPRNT" || !scriptReady) return;

    async function runAgent() {
      if (busyRef.current) return;
      busyRef.current = true;
      let claimedJob: PrintJobView | null = null;
      try {
        const refreshed = await postPrintCommand(stallSlug, { operation: "REFRESH" });
        const printer = selectAutomaticPrinter(refreshed.state, stallSlug);
        if (!printer) {
          activePrinterRef.current = null;
          setStatus("NOT_CONFIGURED");
          setDetail(t("print.agent.noPrinter"));
          return;
        }

        await probeStarWebPrnt();
        activePrinterRef.current = printer;
        window.localStorage.setItem(`stallorder_printer_${stallSlug}`, printer.id);
        await postPrintCommand(stallSlug, { operation: "HEARTBEAT", printerId: printer.id });
        if (!hasAutomaticPrintRule(refreshed.state, printer.id)) {
          setStatus("NOT_CONFIGURED");
          setDetail(t("print.agent.noAutoRule"));
          return;
        }
        setStatus("READY");
        setDetail(t("print.device.detected", { printer: printer.name }));

        const job = [...refreshed.state.jobs].reverse().find((candidate) => (
          candidate.status === "PENDING"
          && candidate.printRule?.autoPrint
          && (!candidate.printer || candidate.printer.id === printer.id)
        ));
        if (!job) return;
        claimedJob = job;
        const claimed = await postPrintCommand(stallSlug, {
          operation: "CLAIM",
          jobId: job.id,
          printerId: printer.id,
        });
        if (!claimed.printPayload) throw new Error(t("print.bluetooth.payloadMissing"));
        await printWithStarWebPrnt(claimed.printPayload.dataBase64);
        claimedJob = null;
        try {
          await postPrintCommand(stallSlug, { operation: "SUCCESS", jobId: job.id });
        } catch {
          setStatus("ERROR");
          setDetail(t("print.bluetooth.statusUnknown"));
          return;
        }
        setDetail(t("print.agent.printed"));
      } catch (error) {
        if (claimedJob) {
          try {
            await postPrintCommand(stallSlug, {
              operation: "FAIL",
              jobId: claimedJob.id,
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
      }
    }

    void runAgent();
    const timer = window.setInterval(() => void runAgent(), 5_000);
    return () => window.clearInterval(timer);
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
      onLoad={() => setScriptReady(Boolean(window.StarWebPrintTrader))}
      onError={() => {
        setStatus("ERROR");
        setDetail(t("print.bluetooth.bridgeFailed"));
      }}
    /> : null}
    <p
      role="status"
      className={`mt-2 flex min-h-8 items-center gap-2 border-y px-2 py-1 text-xs font-medium print:hidden ${status === "READY" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : status === "ERROR" || status === "UNSUPPORTED" || status === "NOT_CONFIGURED" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-stone-200 bg-stone-50 text-stone-600"}`}
    >
      {status === "ERROR" || status === "UNSUPPORTED" || status === "NOT_CONFIGURED" ? <TriangleAlert className="h-4 w-4 shrink-0" /> : <Printer className="h-4 w-4 shrink-0" />}
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

async function postPrintCommand(stallSlug: string, command: Record<string, unknown>) {
  const response = await fetch(`/api/stalls/${stallSlug}/print-jobs`, {
    method: "POST",
    headers: csrfHeaders(),
    body: JSON.stringify(command),
  });
  const payload = await response.json() as PrintQueueCommandResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "PRINT_AGENT_REQUEST_FAILED");
  return payload;
}

function printAgentError(t: ReturnType<typeof useOperationsLocale>["t"], error: unknown) {
  if (!(error instanceof StarWebPrntError)) {
    return error instanceof Error ? error.message : t("print.bluetooth.error.connection");
  }
  if (error.code === "PAPER_END") return t("print.bluetooth.error.paperEnd");
  if (error.code === "COVER_OPEN") return t("print.bluetooth.error.coverOpen");
  if (error.code === "OFFLINE") return t("print.bluetooth.error.offline");
  if (error.code === "TIMEOUT") return t("print.bluetooth.error.timeout");
  if (["CUTTER_ERROR", "ROLL_POSITION_ERROR", "HIGH_TEMPERATURE", "NON_RECOVERABLE"].includes(error.code)) {
    return t("print.bluetooth.error.hardware");
  }
  return t("print.bluetooth.error.connection");
}
