"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

export type StockProduct = { productId: string; name: string; stockRemaining?: number | null; stockVersion?: number };
export type StockAssignment = { productId: string; stockRemaining: number | null; stockVersion: number; isSoldOut: boolean; isEnabled: boolean; soldOutUntil?: string | null };
type StockDraft = { mode: "SET" | "ADD" | "UNLIMITED"; quantity: number };

export function ProductStockEditor({ stallId, stallName, products, onSaved, onClose }: {
  stallId: string; stallName: string; products: StockProduct[];
  onSaved: (products: StockAssignment[]) => void; onClose: () => void;
}) {
  const { label } = useMerchantMessages();
  const [rows, setRows] = useState(products);
  const [drafts, setDrafts] = useState<Record<string, StockDraft>>({});
  const [bulk, setBulk] = useState<StockDraft>({ mode: "SET", quantity: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", trap); previous?.focus(); };
  }, []);
  const changes = Object.entries(drafts).map(([productId, draft]) => ({
    productId, expectedVersion: rows.find((row) => row.productId === productId)?.stockVersion ?? 0, ...draft,
  }));
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/merchant/stalls/" + stallId + "/products", {
        method: "PATCH", headers: csrfHeaders(), body: JSON.stringify({ operation: "BULK_STOCK", items: changes }),
      });
      const payload = await response.json();
      if (!response.ok) { setError(label(payload.error ?? "庫存儲存失敗，請稍後再試。")); return; }
      onSaved(payload.products); onClose();
    } catch { setError(label("庫存儲存失敗，請稍後再試。")); }
    finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/merchant/stalls/" + stallId + "/products", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { products: StockAssignment[] };
      setRows((current) => current.map((row) => ({ ...row, ...payload.products.find((item) => item.productId === row.productId) })));
      onSaved(payload.products); setDrafts({}); setError("");
    } catch { setError(label("目前無法更新庫存，請稍後再試。")); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-stone-950/65 p-3" onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="stock-editor-title" className="flex max-h-[90dvh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
      <header className="flex shrink-0 items-center justify-between border-b border-stone-200 p-4">
        <h2 id="stock-editor-title" className="text-lg font-semibold">{label("庫存份數")} · {stallName}</h2>
        <button type="button" aria-label={label("關閉庫存設定")} disabled={busy} onClick={onClose} className="grid h-11 w-11 place-items-center"><X /></button>
      </header>
      <div className="min-h-0 overflow-y-auto p-4">
        <p className="text-sm leading-6 text-stone-700">{label("設定目前剩餘可售份數，0 份即無法販售。新訂單與預約單成立即占用；未製作取消才回補，不每日重設。不限量商品不扣庫存。")}</p>
        <p className="mt-1 text-xs leading-5 text-stone-500">{label("啟用計數時不會回扣既有訂單；套餐以整份套餐計數，非食材用量。手動標記售完的商品，補貨後仍需恢復供應。")}</p>
        <div className="my-4 flex flex-wrap items-end gap-2 rounded-lg bg-stone-50 p-3">
          <label className="text-xs font-semibold">{label("批次方式")}<select aria-label={label("批次庫存方式")} value={bulk.mode} onChange={(event) => setBulk({ ...bulk, mode: event.target.value as StockDraft["mode"] })} className="mt-1 block h-11 rounded border border-stone-300 bg-white px-2"><option value="SET">{label("設定剩餘")}</option><option value="ADD">{label("增加補貨")}</option><option value="UNLIMITED">{label("不限量")}</option></select></label>
          <label className="text-xs font-semibold">{label("份數")}<input aria-label={label("批次庫存份數")} type="number" min={0} max={1000000} disabled={bulk.mode === "UNLIMITED"} value={bulk.quantity} onChange={(event) => setBulk({ ...bulk, quantity: Number(event.target.value) })} className="mt-1 block h-11 w-28 rounded border border-stone-300 px-2" /></label>
          <button type="button" disabled={busy} onClick={() => setDrafts(Object.fromEntries(rows.map((row) => [row.productId, { ...bulk }])))} className="min-h-11 rounded border border-teal-700 px-3 font-semibold text-teal-800">{label("套用至本清單全部商品")}</button>
        </div>
        <div className="divide-y divide-stone-200">{rows.map((row) => {
          const draft = drafts[row.productId];
          const value = draft ?? { mode: row.stockRemaining == null ? "UNLIMITED" : "SET", quantity: row.stockRemaining ?? 0 };
          return <div key={row.productId} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_140px_110px] sm:items-center">
            <label className="flex min-w-0 items-center gap-2 font-semibold"><input type="checkbox" checked={Boolean(draft)} onChange={(event) => setDrafts((current) => { const next = { ...current }; if (event.target.checked) next[row.productId] = value; else delete next[row.productId]; return next; })} /><span className="break-words">{row.name}<span className="block text-xs font-normal text-stone-500">{label("目前剩餘")}：{row.stockRemaining ?? label("不限量")}</span></span></label>
            <select aria-label={label("庫存方式") + " " + row.name} value={value.mode} disabled={busy} onChange={(event) => setDrafts({ ...drafts, [row.productId]: { ...value, mode: event.target.value as StockDraft["mode"] } })} className="h-11 rounded border border-stone-300 bg-white px-2 text-sm"><option value="SET">{label("設定剩餘")}</option><option value="ADD">{label("增加補貨")}</option><option value="UNLIMITED">{label("不限量")}</option></select>
            <input type="number" min={0} max={1000000} aria-label={label("庫存份數") + " " + row.name} disabled={busy || value.mode === "UNLIMITED"} value={value.quantity} onChange={(event) => setDrafts({ ...drafts, [row.productId]: { ...value, quantity: Number(event.target.value) } })} className="h-11 w-full rounded border border-stone-300 px-2" />
          </div>;
        })}</div>
        {error ? <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      </div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-stone-200 p-4">
        <button type="button" disabled={busy} onClick={() => void refresh()} className="min-h-11 rounded border border-stone-300 px-3 text-sm">{label("重新讀取（捨棄未儲存庫存）")}</button>
        <button type="button" disabled={busy || !changes.length || changes.some((item) => !Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > 1000000)} onClick={() => void save()} className="min-h-11 rounded bg-teal-800 px-4 font-semibold text-white disabled:opacity-40">{label("儲存庫存")}（{changes.length}）</button>
      </footer>
    </div>
  </div>;
}
