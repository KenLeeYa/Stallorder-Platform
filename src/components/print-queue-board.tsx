"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleOff, Printer, RefreshCw, RotateCcw, Wifi, WifiOff, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatTaipeiDateTime } from "@/lib/date-time";
import { formatMoney } from "@/lib/money";

type PrinterView = {
  id: string;
  name: string;
  isEnabled: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
};
type PrintJobView = {
  id: string;
  status: "PENDING" | "PRINTING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  queuedAt: string;
  printedAt: string | null;
  reprintOfId: string | null;
  printer: { id: string; name: string } | null;
  order: {
    id: string;
    orderNo: string;
    customerName: string;
    customerPhone: string | null;
    deliveryAddress: string | null;
    tableLabel: string | null;
    fulfillmentType: "TAKEOUT" | "DINE_IN" | "DELIVERY";
    total: number;
    createdAt: string;
    items: Array<{
      id: string;
      name: string;
      quantity: number;
      note: string | null;
      noteOptions: Array<{ groupName: string; optionName: string }>;
    }>;
  };
};
export type PrintQueueState = {
  printModuleEnabled: boolean;
  printers: PrinterView[];
  jobs: PrintJobView[];
};

const statusLabels: Record<PrintJobView["status"], string> = {
  PENDING: "待列印",
  PRINTING: "列印中",
  SUCCEEDED: "列印成功",
  FAILED: "列印失敗",
  CANCELLED: "已取消",
};

export function PrintQueueBoard({ stall, initialState }: { stall: { slug: string; name: string; currency: string }; initialState: PrintQueueState }) {
  const [state, setState] = useState(initialState);
  const [printerName, setPrinterName] = useState("");
  const [activePrinterId, setActivePrinterId] = useState<string | null>(null);
  const [printingJobId, setPrintingJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activePrinter = state.printers.find((printer) => printer.id === activePrinterId) ?? null;
  const visibleJobs = useMemo(() => state.jobs.filter((job) => job.status !== "CANCELLED"), [state.jobs]);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/stalls/${stall.slug}/print-jobs`, { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) setState(payload.state);
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
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新列印工作。");
      setState(payload.state);
      if (successMessage) setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      return false;
    } finally {
      setBusy(false);
    }
  }, [stall.slug]);

  useEffect(() => {
    const saved = window.localStorage.getItem(`stallorder_printer_${stall.slug}`);
    const restorePrinter = window.setTimeout(() => {
      if (saved) setActivePrinterId(saved);
    }, 0);
    const poll = window.setInterval(() => void refresh(), 5_000);
    return () => {
      window.clearTimeout(restorePrinter);
      window.clearInterval(poll);
    };
  }, [refresh, stall.slug]);

  useEffect(() => {
    if (!activePrinterId) return;
    const heartbeat = () => void run({ operation: "HEARTBEAT", printerId: activePrinterId });
    heartbeat();
    const timer = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(timer);
  }, [activePrinterId, run]);

  async function registerPrinter() {
    if (!printerName.trim()) return;
    if (await run({ operation: "REGISTER_PRINTER", name: printerName }, "印表機已新增。")) setPrinterName("");
  }

  function takeOverPrinter(printerId: string) {
    setActivePrinterId(printerId);
    window.localStorage.setItem(`stallorder_printer_${stall.slug}`, printerId);
    setMessage("此裝置已開始回報印表機連線狀態。");
  }

  async function startPrint(job: PrintJobView) {
    if (!activePrinterId) {
      setMessage("請先選擇由此裝置接手的印表機。");
      return;
    }
    const claimed = await run({ operation: "CLAIM", jobId: job.id, printerId: activePrinterId });
    if (!claimed) return;
    setPrintingJobId(job.id);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
  }

  return <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 md:px-8">
    <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
      <div><Link href={`/staff/${stall.slug}`} className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回訂單看板</Link><h1 className="mt-2 text-3xl font-semibold">列印工作佇列</h1><p className="mt-1 text-sm text-stone-500">{stall.name}</p></div>
      <button type="button" title="重新整理" onClick={() => void refresh()} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300"><RefreshCw className="h-4 w-4" /></button>
    </div>
    {!state.printModuleEnabled ? <p className="mt-5 border-y border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 print:hidden">列印模組目前已關閉。既有工作仍保留，但新確認訂單不會自動排入。</p> : null}
    {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700 print:hidden">{message}</p> : null}

    <section className="mt-6 border-y border-stone-200 py-5 print:hidden">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">印表機連線</h2><p className="mt-1 text-xs text-stone-500">超過 90 秒未收到心跳即顯示離線。</p></div><div className="flex gap-2"><label className="text-xs font-semibold text-stone-600">印表機名稱<input type="text" value={printerName} maxLength={80} onChange={(event) => setPrinterName(event.target.value)} className="mt-1 h-10 rounded-md border border-stone-300 px-3 text-sm" /></label><button type="button" disabled={busy || !printerName.trim()} onClick={() => void registerPrinter()} className="mt-5 h-10 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white disabled:opacity-50">新增</button></div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">{state.printers.map((printer) => <article key={printer.id} className="flex items-center justify-between gap-3 rounded-md border border-stone-200 p-3"><div className="flex min-w-0 items-center gap-3">{printer.isOnline ? <Wifi className="h-4 w-4 shrink-0 text-emerald-700" /> : <WifiOff className="h-4 w-4 shrink-0 text-red-700" />}<div className="min-w-0"><strong className="block truncate text-sm">{printer.name}</strong><span className="text-xs text-stone-500">{printer.isOnline ? "線上" : "離線"}{activePrinterId === printer.id ? " · 本機接手中" : ""}</span></div></div><button type="button" disabled={!printer.isEnabled || activePrinterId === printer.id} onClick={() => takeOverPrinter(printer.id)} className="h-9 shrink-0 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-40">本機接手</button></article>)}</div>
      {state.printers.length === 0 ? <p className="mt-4 text-sm text-red-700">尚未設定印表機，列印工作會保留在待列印狀態。</p> : null}
    </section>

    <section className="py-6 print:hidden"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">工作清單</h2><span className="text-sm text-stone-500">{visibleJobs.length} 筆</span></div><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{visibleJobs.map((job) => <article key={job.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Printer className="h-4 w-4 text-teal-700" /><strong>訂單 {job.order.orderNo}</strong><span className={`rounded px-2 py-0.5 text-xs font-semibold ${job.status === "FAILED" ? "bg-red-50 text-red-700" : job.status === "SUCCEEDED" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-700"}`}>{statusLabels[job.status]}</span>{job.reprintOfId ? <span className="text-xs text-amber-700">補印</span> : null}</div><p className="mt-1 text-sm text-stone-600">{job.order.fulfillmentType === "DELIVERY" ? job.order.deliveryAddress ?? job.order.customerName : job.order.tableLabel ?? job.order.customerName} · {formatMoney(job.order.total, stall.currency)} · 嘗試 {job.attemptCount}/{job.maxAttempts}</p>{job.order.fulfillmentType === "DELIVERY" && job.order.customerPhone ? <p className="mt-1 text-xs text-stone-500">聯絡電話：{job.order.customerPhone}</p> : null}<p className="mt-1 text-xs text-stone-500">{job.printer?.name ?? "尚未指派印表機"} · {formatTaipeiDateTime(job.queuedAt)}</p>{job.lastError ? <p className="mt-2 text-xs text-red-700">{job.lastError}</p> : null}</div><div className="flex flex-wrap gap-2">{job.status === "PENDING" ? <button type="button" disabled={busy || !activePrinter} onClick={() => void startPrint(job)} className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><Printer className="h-4 w-4" />開始列印</button> : null}{job.status === "PRINTING" ? <><button type="button" disabled={busy} onClick={() => void run({ operation: "SUCCESS", jobId: job.id }, "已記錄列印成功。")} className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white"><Check className="h-4 w-4" />成功</button><button type="button" disabled={busy} onClick={() => void run({ operation: "FAIL", jobId: job.id, error: "印表機未完成輸出" }, "已記錄列印失敗，可重新排入。")} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-300 px-3 text-xs font-semibold text-red-700"><CircleOff className="h-4 w-4" />失敗</button></> : null}{job.status === "FAILED" && job.attemptCount < job.maxAttempts ? <button type="button" disabled={busy} onClick={() => void run({ operation: "RETRY", jobId: job.id }, "已重新排入列印佇列。")} className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold"><RotateCcw className="h-4 w-4" />重試</button> : null}{job.status === "SUCCEEDED" || job.status === "FAILED" ? <button type="button" disabled={busy} onClick={() => void run({ operation: "REPRINT", jobId: job.id }, "補印工作已建立。")} className="h-9 rounded-md border border-stone-300 px-3 text-xs font-semibold">補印</button> : null}{job.status === "PENDING" || job.status === "FAILED" ? <button type="button" title="取消列印工作" disabled={busy} onClick={() => void run({ operation: "CANCEL", jobId: job.id }, "列印工作已取消。")} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 text-red-700"><X className="h-4 w-4" /></button> : null}</div></article>)}</div>{visibleJobs.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">目前沒有列印工作。</p> : null}</section>

    {printingJobId ? <PrintTicket job={state.jobs.find((job) => job.id === printingJobId) ?? null} stallName={stall.name} currency={stall.currency} /> : null}
  </main>;
}

function PrintTicket({ job, stallName, currency }: { job: PrintJobView | null; stallName: string; currency: string }) {
  if (!job) return null;
  return <article className="hidden print:block"><h1 className="text-2xl font-bold">{stallName}</h1><p className="mt-1">訂單 {job.order.orderNo} · {job.order.fulfillmentType === "DELIVERY" ? "外送" : job.order.tableLabel ?? job.order.customerName}</p>{job.order.fulfillmentType === "DELIVERY" ? <div className="mt-2"><div>地址：{job.order.deliveryAddress}</div><div>電話：{job.order.customerPhone}</div></div> : null}<ul className="my-4 divide-y border-y">{job.order.items.map((item) => <li key={item.id} className="py-2"><strong>{item.quantity} × {item.name}</strong>{item.noteOptions.length > 0 ? <div>{item.noteOptions.map((note) => `${note.groupName}：${note.optionName}`).join("、")}</div> : null}{item.note ? <div>備註：{item.note}</div> : null}</li>)}</ul><strong>合計 {formatMoney(job.order.total, currency)}</strong></article>;
}
