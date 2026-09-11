"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { readApiJson } from "@/lib/api-response";
import { productAvailabilityLabel } from "@/lib/product-availability";
import type { StockAssignment } from "./product-stock-editor";

type Mode = "AVAILABLE" | "TEMPORARY" | "TODAY" | "UNTIL_DATE" | "PERMANENT";
const modes: Array<{ value: Mode; label: string; help: string }> = [
  { value: "AVAILABLE", label: "供應中", help: "立即解除暫停或下架。" },
  { value: "TODAY", label: "今日售完", help: "下一個營業日開始時，自動恢復供應。" },
  { value: "TEMPORARY", label: "暫時停止供應", help: "補料或備餐後自動恢復。" },
  { value: "UNTIL_DATE", label: "指定日期恢復", help: "所選日期的營業日開始時恢復供應。" },
  { value: "PERMANENT", label: "永久下架", help: "從點餐菜單隱藏，需手動重新開放。" },
];

export function useAvailabilityClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  return now;
}

export function ProductAvailabilityButton({ name, assignment, onClick, disabled }: {
  name: string; assignment: Pick<StockAssignment, "isEnabled" | "isSoldOut" | "soldOutUntil"> & { stockRemaining?: number | null };
  onClick: () => void; disabled?: boolean;
}) {
  const now = useAvailabilityClock();
  const label = productAvailabilityLabel(assignment, now);
  return <button type="button" aria-label={`${name}：${label}，設定供應狀態`} disabled={disabled} onClick={onClick}
    className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40 ${label === "供應中" ? "border-teal-300 bg-teal-50 text-teal-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${label === "供應中" ? "bg-teal-700" : "bg-amber-700"}`} />{label}<ChevronDown aria-hidden="true" className="h-4 w-4" />
  </button>;
}

export function ProductAvailabilityEditor({ stallId, products, onSaved, onClose }: {
  stallId: string; products: Array<{ productId: string; name: string; soldOutUntil?: string | null }>;
  onSaved: (rows: StockAssignment[]) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("TODAY");
  const [minutes, setMinutes] = useState(15);
  const [resumeDate, setResumeDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/products`, {
        method: "PATCH", headers: csrfHeaders(),
        body: JSON.stringify({ operation: "BULK_AVAILABILITY", productIds: products.map((row) => row.productId), mode,
          ...(mode === "TEMPORARY" ? { minutes } : {}), ...(mode === "UNTIL_DATE" ? { resumeDate } : {}),
        }),
      });
      const payload = await readApiJson<{ products: StockAssignment[]; error?: string }>(response, "供應狀態暫時無法儲存，請稍後再試。");
      if (!response.ok) throw new Error(payload.error ?? "供應狀態儲存失敗，請稍後再試。");
      onSaved(payload.products); onClose();
    } catch (failure) { setError(failure instanceof Error && !(failure instanceof TypeError) ? failure.message : "連線中斷，請稍後再試。"); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby="availability-editor-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 text-stone-900 shadow-xl backdrop:bg-stone-950/60 sm:p-5">
    <div className="flex items-center justify-between gap-3"><h2 id="availability-editor-title" className="text-xl font-bold">設定供應狀態</h2><button type="button" aria-label="關閉供應狀態設定" disabled={busy} onClick={onClose} className="grid h-11 w-11 place-items-center rounded-lg border border-stone-300"><X className="h-5 w-5" /></button></div>
    <p className="my-3 break-words text-sm text-stone-600">{products.length === 1 ? products[0].name : `已選 ${products.length} 項商品`}</p>
    <div className="grid gap-2">{modes.map((option) => <div key={option.value}>
      <button type="button" aria-pressed={mode === option.value} onClick={() => setMode(option.value)} disabled={busy}
        className={`flex min-h-12 w-full items-center gap-3 rounded-lg border p-3 text-left ${mode === option.value ? "border-teal-700 bg-teal-50" : "border-stone-200"}`}>
        <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${mode === option.value ? "border-teal-700 bg-teal-700 text-white" : "border-stone-400"}`}>{mode === option.value ? <Check className="h-3.5 w-3.5" /> : null}</span>
        <span><span className="block font-semibold">{option.label}</span><span className="mt-0.5 block text-xs text-stone-600">{option.help}</span></span>
      </button>
      {mode === option.value && mode === "TEMPORARY" ? <div className="mt-2 grid grid-cols-2 gap-2 pl-8">{[15,30,60,120].map((value) => <button type="button" key={value} disabled={busy} aria-pressed={minutes === value} onClick={() => setMinutes(value)} className="min-h-11 rounded-lg border border-stone-300 px-2 text-sm aria-pressed:border-teal-700 aria-pressed:bg-teal-50">{value < 60 ? `${value} 分鐘` : `${value / 60} 小時`}</button>)}</div> : null}
      {mode === option.value && mode === "UNTIL_DATE" ? <label className="mt-2 block pl-8 text-sm">恢復供應日期<input type="date" required disabled={busy} value={resumeDate} onChange={(event) => setResumeDate(event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-stone-300 px-3" /></label> : null}
    </div>)}</div>
    <p className="mt-4 text-xs leading-relaxed text-stone-600">以店家時區與營業日切換時間計算。恢復供應不會補回庫存；庫存為 0、主檔停用或不在供應排程的商品仍無法點餐。</p>
    {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    <div className="mt-4 flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 flex-1 rounded-lg border border-stone-300 font-semibold">取消</button><button type="button" disabled={busy || (mode === "UNTIL_DATE" && !resumeDate)} onClick={() => void save()} className="min-h-11 flex-[2] rounded-lg bg-teal-700 px-3 font-semibold text-white disabled:opacity-40">{busy ? "儲存中…" : `確認${modes.find((option) => option.value === mode)?.label}`}</button></div>
  </dialog>;
}
