"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { readApiJson } from "@/lib/api-response";
import { productAvailabilityLabel } from "@/lib/product-availability";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
import type { StockAssignment } from "./product-stock-editor";

type Mode = "AVAILABLE" | "TEMPORARY" | "TODAY" | "UNTIL_DATE" | "PERMANENT";
const modes: Mode[] = ["AVAILABLE", "TODAY", "TEMPORARY", "UNTIL_DATE", "PERMANENT"];

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
  const { m } = useMerchantMessages();
  const status = productAvailabilityLabel(assignment, now);
  const available = status === "供應中";
  const label = m(status === "永久下架" ? "availability.PERMANENT" : status === "暫停供應" ? "availability.paused" : status === "庫存售完" ? "availability.stockEmpty" : "availability.AVAILABLE");
  return <button type="button" aria-label={m("availability.open", { name, status: label })} disabled={disabled} onClick={onClick}
    className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40 ${available ? "border-teal-300 bg-teal-50 text-teal-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${available ? "bg-teal-700" : "bg-amber-700"}`} />{label}<ChevronDown aria-hidden="true" className="h-4 w-4" />
  </button>;
}

export function ProductAvailabilityEditor({ stallId, products, onSaved, onClose }: {
  stallId: string; products: Array<{ productId: string; name: string; soldOutUntil?: string | null }>;
  onSaved: (rows: StockAssignment[]) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const { m } = useMerchantMessages();
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
    if (saving.current) return;
    saving.current = true;
    dialog.current?.focus();
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/products`, {
        method: "PATCH", headers: csrfHeaders(),
        body: JSON.stringify({ operation: "BULK_AVAILABILITY", productIds: products.map((row) => row.productId), mode,
          ...(mode === "TEMPORARY" ? { minutes } : {}), ...(mode === "UNTIL_DATE" ? { resumeDate } : {}),
        }),
      });
      const payload = await readApiJson<{ products: StockAssignment[]; error?: string }>(response, m("availability.error"));
      if (!response.ok) throw new Error(payload.error ?? m("availability.error"));
      onSaved(payload.products); onClose();
    } catch (failure) { setError(failure instanceof Error && !(failure instanceof TypeError) ? failure.message : m("availability.connection")); }
    finally { saving.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} tabIndex={-1} onKeyDown={(event) => {
    // Let the native cancel event close an idle dialog after ancestor key handlers.
    // Removing it during keydown would make the parent navigator close as well.
    if (event.key === "Escape" && saving.current) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']")).filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }} aria-labelledby="availability-editor-title" onCancel={(event) => { event.preventDefault(); if (!saving.current) onClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 text-stone-900 shadow-xl backdrop:bg-stone-950/60 sm:p-5">
    <div className="flex items-center justify-between gap-3"><h2 id="availability-editor-title" className="text-xl font-bold">{m("availability.title")}</h2><button type="button" aria-label={m("availability.close")} disabled={busy} onClick={onClose} className="grid h-11 w-11 place-items-center rounded-lg border border-stone-300"><X className="h-5 w-5" /></button></div>
    <p className="my-3 break-words text-sm text-stone-600">{products.length === 1 ? products[0].name : m("availability.selected", { count: products.length })}</p>
    <div className="grid gap-2">{modes.map((option) => <div key={option}>
      <button type="button" aria-pressed={mode === option} onClick={() => setMode(option)} disabled={busy}
        className={`flex min-h-12 w-full items-center gap-3 rounded-lg border p-3 text-left ${mode === option ? "border-teal-700 bg-teal-50" : "border-stone-200"}`}>
        <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${mode === option ? "border-teal-700 bg-teal-700 text-white" : "border-stone-400"}`}>{mode === option ? <Check className="h-3.5 w-3.5" /> : null}</span>
        <span><span className="block font-semibold">{m(`availability.${option}`)}</span><span className="mt-0.5 block text-xs text-stone-600">{m(`availability.help.${option}`)}</span></span>
      </button>
      {mode === option && mode === "TEMPORARY" ? <div className="mt-2 grid grid-cols-2 gap-2 pl-8">{[15,30,60,120].map((value) => <button type="button" key={value} disabled={busy} aria-pressed={minutes === value} onClick={() => setMinutes(value)} className="min-h-11 rounded-lg border border-stone-300 px-2 text-sm aria-pressed:border-teal-700 aria-pressed:bg-teal-50">{m(value < 60 ? "availability.minutes" : "availability.hours", { count: value < 60 ? value : value / 60 })}</button>)}</div> : null}
      {mode === option && mode === "UNTIL_DATE" ? <label className="mt-2 block pl-8 text-sm">{m("availability.date")}<input type="date" required disabled={busy} value={resumeDate} onChange={(event) => setResumeDate(event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-stone-300 px-3" /></label> : null}
    </div>)}</div>
    <p className="mt-4 text-xs leading-relaxed text-stone-600">{m("availability.constraints")}</p>
    {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    <div className="mt-4 flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 flex-1 rounded-lg border border-stone-300 font-semibold">{m("取消")}</button><button type="button" disabled={busy || (mode === "UNTIL_DATE" && !resumeDate)} onClick={() => void save()} className="min-h-11 flex-[2] rounded-lg bg-teal-700 px-3 font-semibold text-white disabled:opacity-40">{busy ? m("儲存中...") : m("availability.confirm", { status: m(`availability.${mode}`) })}</button></div>
  </dialog>;
}
