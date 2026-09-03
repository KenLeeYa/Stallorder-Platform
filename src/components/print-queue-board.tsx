"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { Bluetooth, Check, ChevronLeft, ChevronRight, CircleOff, Cloud, ExternalLink, Printer, RefreshCw, RotateCcw, X } from "lucide-react";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { useOperationsLocale } from "@/components/operations-locale";
import { PrintCenterSettings } from "@/components/print-center-settings";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatAppDateTime } from "@/lib/locale-format";
import { formatMoney } from "@/lib/money";
import {
  OPERATIONS_PAGE_SIZES,
  type OperationsPageMeta,
  type OperationsPageSize,
} from "@/lib/operations-pagination";
import type {
  PrinterView,
  PrintJobView,
  PrintQueueCommandResponse,
  PrintQueueState,
} from "@/lib/print-center-types";
import {
  filterPrintJobsByDate,
  printJobDateRange,
  slicePrintJobPage,
  type PrintJobDatePreset,
} from "@/lib/print-job-list";
import {
  detectStarWebPrntEnvironment,
  openStarCashDrawer,
  printWithStarWebPrnt,
  probeStarWebPrnt,
  StarWebPrntError,
  starWebPrntLaunchUrl,
  type StarWebPrntEnvironment,
} from "@/lib/star-webprnt-client";

export type { PrintQueueState } from "@/lib/print-center-types";

type DetectedPrintEnvironment = StarWebPrntEnvironment | "CHECKING";

export function PrintQueueBoard({ stall, initialState }: {
  stall: { slug: string; name: string; currency: string };
  initialState: PrintQueueState;
}) {
  const { locale, t } = useOperationsLocale();
  const [state, setState] = useState(initialState);
  const [activePrinterId, setActivePrinterId] = useState<string | null>(null);
  const [printingJobId, setPrintingJobId] = useState<string | null>(null);
  const [systemPrintContent, setSystemPrintContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [printEnvironment, setPrintEnvironment] = useState<DetectedPrintEnvironment>("CHECKING");
  const [webPrntScriptReady, setWebPrntScriptReady] = useState(false);
  const [webPrntLaunchHref, setWebPrntLaunchHref] = useState("");
  const [jobDateRange, setJobDateRange] = useState({ dateFrom: "", dateTo: "" });
  const [jobPageSize, setJobPageSize] = useState<OperationsPageSize>(5);
  const [visibleJobPage, setVisibleJobPage] = useState(1);
  const [cancelledJobPage, setCancelledJobPage] = useState(1);
  const probingRef = useRef(false);
  const autoDetectPrintersRef = useRef<PrinterView[]>([]);
  const activePrinter = state.printers.find((printer) => printer.id === activePrinterId) ?? null;
  const activeConnectionType = activePrinter?.connectionType ?? null;
  const filteredJobs = useMemo(() => filterPrintJobsByDate(
    state.jobs,
    jobDateRange.dateFrom,
    jobDateRange.dateTo,
  ), [jobDateRange.dateFrom, jobDateRange.dateTo, state.jobs]);
  const visibleJobs = useMemo(() => filteredJobs.filter((job) => job.status !== "CANCELLED"), [filteredJobs]);
  const cancelledJobs = useMemo(() => filteredJobs.filter((job) => job.status === "CANCELLED"), [filteredJobs]);
  const visibleJobsPage = useMemo(() => slicePrintJobPage(
    visibleJobs,
    visibleJobPage,
    jobPageSize,
  ), [jobPageSize, visibleJobPage, visibleJobs]);
  const cancelledJobsPage = useMemo(() => slicePrintJobPage(
    cancelledJobs,
    cancelledJobPage,
    jobPageSize,
  ), [cancelledJobPage, cancelledJobs, jobPageSize]);
  const autoDetectSignature = state.printers
    .filter((printer) => printer.isEnabled && printer.autoDetectEnabled && printer.connectionType === "WEBPRNT_BLUETOOTH")
    .map((printer) => `${printer.id}:${printer.name}`)
    .join("|");

  function applyJobDatePreset(preset: PrintJobDatePreset) {
    setJobDateRange(printJobDateRange(preset));
    setVisibleJobPage(1);
    setCancelledJobPage(1);
  }

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/print-jobs`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "REFRESH" }),
      });
      const payload = await response.json();
      if (response.ok) setState(payload.state);
    } catch {
      // Keep the last known queue state until the next bounded refresh.
    }
  }, [stall.slug]);

  const run = useCallback(async (command: Record<string, unknown>, successMessage = "") => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/print-jobs`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : t("print.updateFailed"));
      setState(payload.state);
      if (successMessage) setMessage(successMessage);
      return payload as PrintQueueCommandResponse;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("common.networkError"));
      return null;
    } finally {
      setBusy(false);
    }
  }, [stall.slug, t]);

  const sendHeartbeat = useCallback(async (printerId: string) => {
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/print-jobs`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "HEARTBEAT", printerId }),
      });
      if (!response.ok) return;
      const payload = await response.json() as PrintQueueCommandResponse;
      setState(payload.state);
    } catch {
      // The 90-second server-side lease will surface a lost connection.
    }
  }, [stall.slug]);

  useEffect(() => {
    autoDetectPrintersRef.current = state.printers.filter((printer) => (
      printer.isEnabled
      && printer.autoDetectEnabled
      && printer.connectionType === "WEBPRNT_BLUETOOTH"
    ));
  }, [state.printers]);

  useEffect(() => {
    const detectEnvironment = window.setTimeout(() => {
      const environment = detectStarWebPrntEnvironment(window.navigator.userAgent);
      setPrintEnvironment(environment);
      if (environment === "IOS_SAFARI") setWebPrntLaunchHref(starWebPrntLaunchUrl(window.location.href));
    }, 0);
    return () => window.clearTimeout(detectEnvironment);
  }, []);

  useEffect(() => {
    const restorePrinter = window.setTimeout(() => {
      const saved = window.localStorage.getItem(`stallorder_printer_${stall.slug}`);
      const printer = initialState.printers.find((candidate) => candidate.id === saved && candidate.isEnabled);
      if (printer?.connectionType === "SYSTEM_PRINT") setActivePrinterId(printer.id);
    }, 0);
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => void refresh(), 5_000);
    return () => {
      window.clearTimeout(restorePrinter);
      window.clearTimeout(initialRefresh);
      window.clearInterval(poll);
    };
  }, [initialState.printers, refresh, stall.slug]);

  useEffect(() => {
    if (printEnvironment !== "STAR_WEBPRNT" || !webPrntScriptReady) return;
    const candidates = autoDetectPrintersRef.current;
    if (candidates.length === 0) return;
    const detect = async () => {
      if (probingRef.current) return;
      probingRef.current = true;
      try {
        await probeStarWebPrnt();
        const saved = window.localStorage.getItem(`stallorder_printer_${stall.slug}`);
        const detected = candidates.find((printer) => printer.id === saved) ?? candidates[0];
        setActivePrinterId(detected.id);
        window.localStorage.setItem(`stallorder_printer_${stall.slug}`, detected.id);
        await sendHeartbeat(detected.id);
        setMessage(t("print.device.detected", { printer: detected.name }));
      } catch (error) {
        setActivePrinterId((current) => candidates.some((printer) => printer.id === current) ? null : current);
        setMessage(starWebPrntErrorMessage(t, error));
      } finally {
        probingRef.current = false;
      }
    };
    void detect();
    const timer = window.setInterval(() => void detect(), 30_000);
    return () => window.clearInterval(timer);
  }, [autoDetectSignature, printEnvironment, sendHeartbeat, stall.slug, t, webPrntScriptReady]);

  useEffect(() => {
    if (!activePrinterId || activeConnectionType === "CLOUDPRNT" || printEnvironment === "CHECKING") return;
    if (activeConnectionType === "WEBPRNT_BLUETOOTH"
        && (printEnvironment !== "STAR_WEBPRNT" || !webPrntScriptReady)) return;
    const heartbeat = () => void sendHeartbeat(activePrinterId);
    heartbeat();
    const timer = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(timer);
  }, [activeConnectionType, activePrinterId, printEnvironment, sendHeartbeat, webPrntScriptReady]);

  const takeOverPrinter = useCallback(async (printer: PrinterView) => {
    if (printer.connectionType === "WEBPRNT_BLUETOOTH" && printEnvironment !== "STAR_WEBPRNT") {
      setMessage(printEnvironment === "IOS_SAFARI" ? t("print.bluetooth.safariBlocked") : t("print.bluetooth.starBrowserRequired"));
      return;
    }
    if (printer.connectionType === "WEBPRNT_BLUETOOTH") {
      try {
        await probeStarWebPrnt();
      } catch (error) {
        setMessage(starWebPrntErrorMessage(t, error));
        return;
      }
    }
    setActivePrinterId(printer.id);
    window.localStorage.setItem(`stallorder_printer_${stall.slug}`, printer.id);
    setMessage(t("print.takeoverStarted"));
  }, [printEnvironment, stall.slug, t]);

  const openCashDrawer = useCallback(async (printer: PrinterView) => {
    if (printer.connectionType !== "WEBPRNT_BLUETOOTH" || activePrinterId !== printer.id) {
      setMessage(t("print.drawer.selectPrinter"));
      return;
    }
    const authorizationInput = window.prompt(t("print.drawer.codePrompt"));
    if (authorizationInput === null) return;
    const managerAuthorizationCode = authorizationInput.trim();
    const authorized = await run({
      operation: "AUTHORIZE_CASH_DRAWER",
      printerId: printer.id,
      ...(managerAuthorizationCode ? { managerAuthorizationCode } : {}),
    });
    if (!authorized) return;
    try {
      await openStarCashDrawer();
      setMessage(t("print.drawer.opened"));
    } catch (error) {
      setMessage(starWebPrntErrorMessage(t, error));
    }
  }, [activePrinterId, run, t]);

  const startPrint = useCallback(async (job: PrintJobView, selectedPrinter?: PrinterView | null) => {
    const printer = selectedPrinter ?? activePrinter;
    if (!printer) {
      setMessage(t("print.selectPrinter"));
      return;
    }
    if (job.printer && job.printer.id !== printer.id) {
      setMessage(t("print.job.assignedElsewhere", { printer: job.printer.name }));
      return;
    }
    if (printer.connectionType === "CLOUDPRNT") {
      setMessage(t("print.cloud.waiting"));
      return;
    }
    if (printer.connectionType === "WEBPRNT_BLUETOOTH") {
      if (printEnvironment === "CHECKING") {
        setMessage(t("print.bluetooth.checking"));
        return;
      }
      if (printEnvironment === "IOS_SAFARI") {
        setMessage(t("print.bluetooth.safariBlocked"));
        return;
      }
      if (printEnvironment !== "STAR_WEBPRNT") {
        setMessage(t("print.bluetooth.starBrowserRequired"));
        return;
      }
      if (!webPrntScriptReady) {
        setMessage(t("print.bluetooth.bridgeLoading"));
        return;
      }
    }

    const claimed = await run({ operation: "CLAIM", jobId: job.id, printerId: printer.id });
    if (!claimed) return;
    const printPayload = claimed.printPayload;
    if (!printPayload) {
      await run({ operation: "FAIL", jobId: job.id, error: t("print.bluetooth.payloadMissing") }, t("print.failedRecorded"));
      return;
    }
    setPrintingJobId(job.id);

    if (printer.connectionType === "WEBPRNT_BLUETOOTH") {
      try {
        await printWithStarWebPrnt(printPayload.dataBase64);
        const recorded = await run({ operation: "SUCCESS", jobId: job.id }, t("print.bluetooth.success"));
        if (!recorded) setMessage(t("print.bluetooth.statusUnknown"));
      } catch (error) {
        const failure = starWebPrntErrorMessage(t, error);
        const recorded = await run({ operation: "FAIL", jobId: job.id, error: failure }, t("print.failedRecorded"));
        if (!recorded) setMessage(t("print.bluetooth.statusUnknown"));
      } finally {
        setPrintingJobId(null);
      }
      return;
    }

    setSystemPrintContent(printPayload.content);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      window.print();
      setPrintingJobId(null);
    }));
  }, [activePrinter, printEnvironment, run, t, webPrntScriptReady]);

  const testPrinter = useCallback(async (printer: PrinterView) => {
    if (printer.connectionType === "CLOUDPRNT") {
      setMessage(t("print.device.cloudTestUnavailable"));
      return;
    }
    if (printer.connectionType === "WEBPRNT_BLUETOOTH" && printEnvironment !== "STAR_WEBPRNT") {
      setMessage(printEnvironment === "IOS_SAFARI" ? t("print.bluetooth.safariBlocked") : t("print.bluetooth.starBrowserRequired"));
      return;
    }
    const tested = await run({ operation: "TEST_PRINTER", printerId: printer.id });
    if (!tested?.printPayload) return;
    setActivePrinterId(printer.id);
    window.localStorage.setItem(`stallorder_printer_${stall.slug}`, printer.id);
    if (printer.connectionType === "SYSTEM_PRINT") {
      setSystemPrintContent(tested.printPayload.content);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
      return;
    }
    try {
      await printWithStarWebPrnt(tested.printPayload.dataBase64);
      setMessage(t("print.device.testSucceeded"));
    } catch (error) {
      setMessage(starWebPrntErrorMessage(t, error));
    }
  }, [printEnvironment, run, stall.slug, t]);

  useEffect(() => {
    if (busy || printingJobId || printEnvironment !== "STAR_WEBPRNT" || !webPrntScriptReady) return;
    if (!activePrinter || activePrinter.connectionType !== "WEBPRNT_BLUETOOTH") return;
    const job = [...state.jobs].reverse().find((candidate) => (
      candidate.status === "PENDING"
      && candidate.printRule?.autoPrint
      && (!candidate.printer || candidate.printer.id === activePrinter.id)
    ));
    if (!job) return;
    const automaticPrint = window.setTimeout(() => void startPrint(job, activePrinter), 0);
    return () => window.clearTimeout(automaticPrint);
  }, [activePrinter, busy, printEnvironment, printingJobId, startPrint, state.jobs, webPrntScriptReady]);

  return <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 md:px-8">
    {printEnvironment === "STAR_WEBPRNT" ? <Script
      src="/vendor/star-webprnt/StarWebPrintTrader-1.2.0.js"
      strategy="afterInteractive"
      integrity="sha256-0CXgr7eC9MfHOAgmVuwbMSnHbU6onTIP4w86ORtm9UQ="
      crossOrigin="anonymous"
      onLoad={() => setWebPrntScriptReady(Boolean(window.StarWebPrintTrader))}
      onError={() => setMessage(t("print.bluetooth.bridgeFailed"))}
    /> : null}

    <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
      <div><ContextualBackButton fallbackHref={`/staff/${stall.slug}`} className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-teal-800">{t("print.back")}</ContextualBackButton><h1 className="mt-2 text-3xl font-semibold">{t("print.center.title")}</h1><p className="mt-1 text-sm text-stone-500">{stall.name}</p></div>
      <button type="button" title={t("common.refresh")} onClick={() => void refresh()} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300"><RefreshCw className="h-4 w-4" /></button>
    </div>
    {!state.printModuleEnabled ? <p className="mt-5 border-y border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 print:hidden">{t("print.moduleDisabled")}</p> : null}
    {printEnvironment === "STAR_WEBPRNT" ? <p className={`mt-4 flex items-center gap-2 border-y px-3 py-3 text-sm font-medium print:hidden ${webPrntScriptReady ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}><Bluetooth className="h-4 w-4 shrink-0" />{webPrntScriptReady ? t("print.bluetooth.ready") : t("print.bluetooth.bridgeLoading")}</p> : null}
    {printEnvironment === "IOS_SAFARI" ? <div className="mt-4 border-y border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 print:hidden"><p>{t("print.bluetooth.safariHint")}</p>{webPrntLaunchHref ? <a href={webPrntLaunchHref} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-3 font-semibold text-white"><Bluetooth className="h-4 w-4" />{t("print.bluetooth.openBrowser")}<ExternalLink className="h-4 w-4" /></a> : null}</div> : null}
    {message ? <p role="status" className="mt-4 border-y border-stone-200 bg-stone-50 px-3 py-3 text-sm font-medium text-stone-700 print:hidden">{message}</p> : null}

    <PrintCenterSettings state={state} busy={busy} activePrinterId={activePrinterId} onRun={run} onTakeOver={takeOverPrinter} onTest={testPrinter} onOpenCashDrawer={openCashDrawer} />

    <section className="py-6 print:hidden">
      <div className="mb-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => applyJobDatePreset("DAY")} className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold">{t("cash.historyDay")}</button>
          <button type="button" onClick={() => applyJobDatePreset("WEEK")} className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold">{t("cash.historyWeek")}</button>
          <button type="button" onClick={() => applyJobDatePreset("MONTH")} className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold">{t("cash.historyMonth")}</button>
          <button type="button" onClick={() => { setJobDateRange({ dateFrom: "", dateTo: "" }); setVisibleJobPage(1); setCancelledJobPage(1); }} className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold">{t("cash.historyAll")}</button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="text-xs font-semibold text-stone-600">{t("cash.historyDateFrom")}<input data-testid="print-jobs-date-from" type="date" value={jobDateRange.dateFrom} max={jobDateRange.dateTo || undefined} onChange={(event) => { setJobDateRange((current) => ({ ...current, dateFrom: event.target.value })); setVisibleJobPage(1); setCancelledJobPage(1); }} className="mt-1 h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900" /></label>
          <label className="text-xs font-semibold text-stone-600">{t("cash.historyDateTo")}<input data-testid="print-jobs-date-to" type="date" value={jobDateRange.dateTo} min={jobDateRange.dateFrom || undefined} onChange={(event) => { setJobDateRange((current) => ({ ...current, dateTo: event.target.value })); setVisibleJobPage(1); setCancelledJobPage(1); }} className="mt-1 h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900" /></label>
          <label className="text-xs font-semibold text-stone-600">{t("cash.historyPerPage")}<select data-testid="print-jobs-page-size" value={jobPageSize} onChange={(event) => { setJobPageSize(Number(event.target.value) as OperationsPageSize); setVisibleJobPage(1); setCancelledJobPage(1); }} className="mt-1 h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900">{OPERATIONS_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{t("print.jobs")}</h2><span className="text-sm text-stone-500">{t("common.count", { count: visibleJobs.length })}</span></div>
      <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{visibleJobsPage.items.map((job) => <article key={job.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">{job.printer?.connectionType === "CLOUDPRNT" ? <Cloud className="h-4 w-4 text-teal-700" /> : <Printer className="h-4 w-4 text-teal-700" />}<strong>{t("print.order", { orderNo: job.order.orderNo })}</strong><span className={`rounded px-2 py-0.5 text-xs font-semibold ${job.status === "FAILED" ? "bg-red-50 text-red-700" : job.status === "SUCCEEDED" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-700"}`}>{printStatusLabel(t, job.status)}</span>{job.reprintOfId && !job.isRoutingCopy ? <span className="text-xs text-amber-700">{t("print.reprint")}</span> : null}</div>
          <p className="mt-1 text-sm text-stone-600">{job.order.fulfillmentType === "DELIVERY" ? job.order.deliveryAddress ?? job.order.customerName : job.order.tableLabel ?? job.order.customerName} · {formatMoney(job.order.total, stall.currency, locale)} · {t("print.attempt", { current: job.attemptCount, max: job.maxAttempts })}</p>
          {job.order.fulfillmentType === "DELIVERY" && job.order.customerPhone ? <p className="mt-1 text-xs text-stone-500">{t("print.phone", { phone: job.order.customerPhone })}</p> : null}
          <p className="mt-1 text-xs text-stone-500">{job.printer?.name ?? t("print.unassigned")}{job.printRule ? ` · ${job.printRule.name}` : ""} · {formatAppDateTime(locale, job.queuedAt, { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" })}</p>
          {job.printer?.connectionType === "CLOUDPRNT" && job.status === "PENDING" ? <p className="mt-1 text-xs font-medium text-teal-700">{t("print.cloud.waiting")}</p> : null}
          {job.lastError ? <p className="mt-2 text-xs text-red-700">{job.lastError === "PRINT_RESULT_UNKNOWN" ? t("print.error.resultUnknown") : job.lastError}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {job.status === "PENDING" && job.printer?.connectionType !== "CLOUDPRNT" ? <button type="button" disabled={busy || !activePrinter || Boolean(printingJobId) || Boolean(job.printer && job.printer.id !== activePrinter.id)} onClick={() => void startPrint(job)} className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><Printer className="h-4 w-4" />{t("print.start")}</button> : null}
          {job.status === "PRINTING" ? <><button type="button" disabled={busy} onClick={() => void run({ operation: "SUCCESS", jobId: job.id }, t("print.successRecorded"))} className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white"><Check className="h-4 w-4" />{t("common.success")}</button><button type="button" disabled={busy} onClick={() => void run({ operation: "FAIL", jobId: job.id, error: t("print.outputIncomplete") }, t("print.failedRecorded"))} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-300 px-3 text-xs font-semibold text-red-700"><CircleOff className="h-4 w-4" />{t("common.failure")}</button></> : null}
          {job.status === "FAILED" && job.attemptCount < job.maxAttempts ? <button type="button" disabled={busy} onClick={() => void run({ operation: "RETRY", jobId: job.id }, t("print.retryQueued"))} className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold"><RotateCcw className="h-4 w-4" />{t("common.retry")}</button> : null}
          {job.status === "SUCCEEDED" || job.status === "FAILED" ? <button type="button" disabled={busy} onClick={() => void run({ operation: "REPRINT", jobId: job.id }, t("print.reprintCreated"))} className="h-9 rounded-md border border-stone-300 px-3 text-xs font-semibold">{t("print.reprint")}</button> : null}
          {job.status === "PENDING" || job.status === "FAILED" ? <button type="button" title={t("print.cancelJob")} disabled={busy} onClick={() => void run({ operation: "CANCEL", jobId: job.id }, t("print.cancelledRecorded"))} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 text-red-700"><X className="h-4 w-4" /></button> : null}
        </div>
      </article>)}</div>
      {visibleJobs.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">{t("print.empty")}</p> : null}
      <PrintJobPagination pagination={visibleJobsPage.pagination} onPageChange={setVisibleJobPage} t={t} />
    </section>

    {systemPrintContent ? <pre className="hidden whitespace-pre-wrap font-mono text-[11pt] leading-tight print:block">{systemPrintContent}</pre> : null}

    {cancelledJobs.length > 0 ? <section className="border-t border-stone-200 py-5 print:hidden">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-stone-700">{t("print.status.cancelled")}</h2>
        <span className="text-xs text-stone-500">{t("common.count", { count: cancelledJobs.length })}</span>
      </div>
      <div className="mt-2 divide-y divide-stone-100">
        {cancelledJobsPage.items.map((job) => <article key={job.id} className="flex min-h-12 items-center justify-between gap-3 py-2">
          <span className="min-w-0 truncate text-sm font-medium">{t("print.order", { orderNo: job.order.orderNo })}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run({ operation: "REPRINT", jobId: job.id }, t("print.reprintCreated"))}
            className="h-9 shrink-0 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-50"
          >
            {t("print.reprint")}
          </button>
        </article>)}
      </div>
      <PrintJobPagination pagination={cancelledJobsPage.pagination} onPageChange={setCancelledJobPage} t={t} />
    </section> : null}
  </main>;
}

function PrintJobPagination({
  pagination,
  onPageChange,
  t,
}: {
  pagination: OperationsPageMeta;
  onPageChange: (page: number) => void;
  t: ReturnType<typeof useOperationsLocale>["t"];
}) {
  if (pagination.totalPages <= 1) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-600">
      <span>{t("cash.historyRange", {
        first: pagination.firstItem,
        last: pagination.lastItem,
        total: pagination.total,
      })}</span>
      <div className="flex items-center gap-2">
        <button type="button" title={t("print.previousPage")} aria-label={t("print.previousPage")} disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
        <span className="min-w-20 text-center font-semibold text-stone-700">{t("cash.historyPageStatus", { page: pagination.page, total: pagination.totalPages })}</span>
        <button type="button" title={t("print.nextPage")} aria-label={t("print.nextPage")} disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function starWebPrntErrorMessage(t: ReturnType<typeof useOperationsLocale>["t"], error: unknown) {
  if (!(error instanceof StarWebPrntError)) return t("print.bluetooth.error.connection");
  if (error.code === "PAPER_END") return t("print.bluetooth.error.paperEnd");
  if (error.code === "COVER_OPEN") return t("print.bluetooth.error.coverOpen");
  if (error.code === "OFFLINE") return t("print.bluetooth.error.offline");
  if (["CUTTER_ERROR", "ROLL_POSITION_ERROR", "HIGH_TEMPERATURE", "NON_RECOVERABLE"].includes(error.code)) return t("print.bluetooth.error.hardware");
  if (error.code === "TIMEOUT") return t("print.bluetooth.error.timeout");
  if (error.code === "PRINT_REJECTED") return t("print.bluetooth.error.rejected");
  if (error.code === "INVALID_PAYLOAD") return t("print.bluetooth.payloadMissing");
  if (error.code === "SDK_NOT_READY") return t("print.bluetooth.bridgeLoading");
  if (error.code === "NOT_STAR_BROWSER") return t("print.bluetooth.safariBlocked");
  return t("print.bluetooth.error.connection");
}

function printStatusLabel(t: ReturnType<typeof useOperationsLocale>["t"], status: PrintJobView["status"]) {
  if (status === "PENDING") return t("print.status.pending");
  if (status === "PRINTING") return t("print.status.printing");
  if (status === "SUCCEEDED") return t("print.status.succeeded");
  if (status === "FAILED") return t("print.status.failed");
  return t("print.status.cancelled");
}
