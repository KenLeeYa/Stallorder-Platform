"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowDown, ArrowUp, CheckCircle2, RefreshCw, WalletCards } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatTaipeiDateTime } from "@/lib/date-time";
import { formatMoney } from "@/lib/money";

type Movement = {
  id: string;
  type: "CASH_IN" | "CASH_OUT";
  amount: number;
  reason: string;
  createdAt: string;
  recordedBy: { displayName: string };
};
type Shift = {
  id: string;
  status: "OPEN" | "CLOSED";
  openingAmount: number;
  systemExpectedAmount: number | null;
  countedAmount: number | null;
  varianceAmount: number | null;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
  openedBy: { displayName: string };
  closedBy: { displayName: string } | null;
  movements: Movement[];
};
export type CashShiftState = {
  openShift: (Shift & { cashSales: number; cashIn: number; cashOut: number; expectedAmount: number }) | null;
  history: Shift[];
};

export function CashShiftBoard({ stall, initialState }: { stall: { slug: string; name: string; currency: string }; initialState: CashShiftState }) {
  const [state, setState] = useState(initialState);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openNote, setOpenNote] = useState("");
  const [movementType, setMovementType] = useState<"CASH_IN" | "CASH_OUT">("CASH_IN");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [countedAmount, setCountedAmount] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/stalls/${stall.slug}/cash-shifts`, { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) setState(payload.state);
  }, [stall.slug]);

  const run = useCallback(async (command: Record<string, unknown>, successMessage: string) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/cash-shifts`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新現金交班資料。");
      setState(payload.state);
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      return false;
    } finally {
      setBusy(false);
    }
  }, [stall.slug]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function openShift() {
    const amount = Number(openingAmount);
    if (!Number.isInteger(amount) || amount < 0) return;
    if (await run({ operation: "OPEN", openingAmount: amount, note: openNote.trim() || null }, "現金班次已開啟。")) {
      setOpeningAmount("");
      setOpenNote("");
    }
  }

  async function addMovement() {
    if (!state.openShift) return;
    const amount = Number(movementAmount);
    if (!Number.isInteger(amount) || amount <= 0 || !movementReason.trim()) return;
    if (await run({ operation: "MOVE", shiftId: state.openShift.id, type: movementType, amount, reason: movementReason }, "現金收支已記錄。")) {
      setMovementAmount("");
      setMovementReason("");
    }
  }

  async function closeShift() {
    if (!state.openShift) return;
    const amount = Number(countedAmount);
    if (!Number.isInteger(amount) || amount < 0) return;
    if (await run({ operation: "CLOSE", shiftId: state.openShift.id, countedAmount: amount, note: closeNote.trim() || null }, "現金班次已完成交班。")) {
      setCountedAmount("");
      setCloseNote("");
    }
  }

  const counted = countedAmount === "" ? null : Number(countedAmount);
  const liveVariance = state.openShift && counted !== null && Number.isFinite(counted) ? counted - state.openShift.expectedAmount : null;

  return <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 md:px-8">
    <div className="flex items-start justify-between gap-4"><div><Link href={`/staff/${stall.slug}`} className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回訂單看板</Link><h1 className="mt-2 text-3xl font-semibold">現金交班</h1><p className="mt-1 text-sm text-stone-500">{stall.name}</p></div><button type="button" title="重新整理" onClick={() => void refresh()} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300"><RefreshCw className="h-4 w-4" /></button></div>
    {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}

    {!state.openShift ? <section className="mt-6 border-y border-stone-200 py-6"><div className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-teal-700" /><h2 className="text-xl font-semibold">開啟現金班次</h2></div><div className="mt-4 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end"><MoneyInput label="開班金額" value={openingAmount} onChange={setOpeningAmount} /><TextInput label="備註（選填）" value={openNote} onChange={setOpenNote} maxLength={500} /><button type="button" disabled={busy || openingAmount === ""} onClick={() => void openShift()} className="h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">開始班次</button></div></section> : <>
      <section className="mt-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">進行中的班次</h2><p className="mt-1 text-xs text-stone-500">{state.openShift.openedBy.displayName} · {formatTaipeiDateTime(state.openShift.openedAt)}</p></div><span className="rounded bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">班次進行中</span></div><div className="mt-4 grid grid-cols-2 border-l border-t border-stone-200 sm:grid-cols-5"><Metric label="開班金額" value={formatMoney(state.openShift.openingAmount, stall.currency)} /><Metric label="現金銷售" value={formatMoney(state.openShift.cashSales, stall.currency)} /><Metric label="現金收入" value={formatMoney(state.openShift.cashIn, stall.currency)} /><Metric label="現金支出" value={`-${formatMoney(state.openShift.cashOut, stall.currency)}`} /><Metric label="系統應有" value={formatMoney(state.openShift.expectedAmount, stall.currency)} strong /></div></section>

      <section className="mt-7 border-y border-stone-200 py-5"><h2 className="text-lg font-semibold">記錄現金收支</h2><div className="mt-3 grid gap-3 sm:grid-cols-[140px_160px_minmax(0,1fr)_auto] sm:items-end"><label className="text-xs font-semibold text-stone-600">類型<select value={movementType} onChange={(event) => setMovementType(event.target.value as "CASH_IN" | "CASH_OUT")} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"><option value="CASH_IN">現金收入</option><option value="CASH_OUT">現金支出</option></select></label><MoneyInput label="金額" value={movementAmount} onChange={setMovementAmount} /><TextInput label="原因" value={movementReason} onChange={setMovementReason} maxLength={200} /><button type="button" disabled={busy || !movementAmount || !movementReason.trim()} onClick={() => void addMovement()} className="h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">新增紀錄</button></div><div className="mt-4 divide-y divide-stone-100">{state.openShift.movements.map((movement) => <div key={movement.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3 text-sm">{movement.type === "CASH_IN" ? <ArrowDown className="h-4 w-4 text-emerald-700" /> : <ArrowUp className="h-4 w-4 text-red-700" />}<div><strong>{movement.reason}</strong><p className="mt-0.5 text-xs text-stone-500">{movement.recordedBy.displayName} · {formatTaipeiDateTime(movement.createdAt)}</p></div><span className={movement.type === "CASH_IN" ? "text-emerald-700" : "text-red-700"}>{movement.type === "CASH_IN" ? "+" : "-"}{formatMoney(movement.amount, stall.currency)}</span></div>)}</div></section>

      <section className="py-6"><h2 className="text-xl font-semibold">盤點並交班</h2><div className="mt-4 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]"><MoneyInput label="實際盤點金額" value={countedAmount} onChange={setCountedAmount} /><TextInput label="交班備註（選填）" value={closeNote} onChange={setCloseNote} maxLength={500} /></div>{liveVariance !== null ? <div className={`mt-4 flex items-center justify-between rounded-md px-4 py-3 text-sm font-semibold ${liveVariance === 0 ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}><span>{liveVariance === 0 ? "帳款相符" : liveVariance > 0 ? "溢收" : "短收"}</span><span>{liveVariance > 0 ? "+" : ""}{formatMoney(liveVariance, stall.currency)}</span></div> : null}<button type="button" disabled={busy || counted === null || counted < 0} onClick={() => void closeShift()} className="mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />完成交班</button></section>
    </>}

    <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">交班紀錄</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{state.history.map((shift) => <article key={shift.id} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><strong>{formatTaipeiDateTime(shift.openedAt)}</strong><p className="mt-1 text-xs text-stone-500">{shift.openedBy.displayName} → {shift.closedBy?.displayName ?? "-"} · {shift.closedAt ? formatTaipeiDateTime(shift.closedAt) : "-"}</p></div><div className="text-sm sm:text-right"><div>應有 {formatMoney(shift.systemExpectedAmount ?? 0, stall.currency)} · 盤點 {formatMoney(shift.countedAmount ?? 0, stall.currency)}</div><strong className={(shift.varianceAmount ?? 0) === 0 ? "text-emerald-700" : "text-amber-800"}>差額 {(shift.varianceAmount ?? 0) > 0 ? "+" : ""}{formatMoney(shift.varianceAmount ?? 0, stall.currency)}</strong></div></article>)}</div>{state.history.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">尚無已完成的交班紀錄。</p> : null}</section>
  </main>;
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className="min-w-0 border-b border-r border-stone-200 p-3"><div className="text-xs text-stone-500">{label}</div><div className={`mt-1 truncate ${strong ? "text-lg font-semibold text-teal-800" : "text-sm font-semibold"}`}>{value}</div></div>; }
function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-xs font-semibold text-stone-600">{label}<input inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 9))} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3 text-sm" /></label>; }
function TextInput({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (value: string) => void; maxLength: number }) { return <label className="text-xs font-semibold text-stone-600">{label}<input value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3 text-sm" /></label>; }
