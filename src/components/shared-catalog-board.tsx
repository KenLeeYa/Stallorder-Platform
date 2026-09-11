"use client";

import { ProductAvailabilityButton, ProductAvailabilityEditor, useAvailabilityClock } from "@/components/product-availability-editor";
import { isProductSoldOut } from "@/lib/product-availability";
import { useMemo, useState } from "react";
import { Layers3, Pencil } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";
import { ProductStockEditor, type StockAssignment, type StockProduct } from "@/components/product-stock-editor";

type Category = { id: string; name: string; isActive: boolean; sortOrder: number };
type Group = { id: string; categoryId: string; name: string; isActive: boolean; sortOrder: number };
type Product = {
  id: string; categoryId: string; groupId: string | null; name: string;
  defaultPrice: number; isActive: boolean; sortOrder: number;
  stallProducts: Array<{ stallId: string; isEnabled: boolean; isSoldOut: boolean; soldOutUntil?: string | null; priceOverride: number | null; stockRemaining?: number | null; stockVersion?: number }>;
};

export function SharedCatalogBoard({ currency, categories, groups, products, stalls, onEdit, onEditCategory, onEditGroup, onMore, onUpdated }: {
  currency: string;
  categories: Category[]; groups: Group[]; products: Product[];
  stalls: Array<{ id: string; name: string }>;
  onEdit: (id: string) => void; onMore: (id: string) => void;
  onEditCategory: (id: string) => void; onEditGroup: (id: string) => void;
  onUpdated: (stallId: string, rows: StockAssignment[]) => void;
}) {
  const [stallId, setStallId] = useState(stalls[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [soldOutOnly, setSoldOutOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stockProducts, setStockProducts] = useState<StockProduct[] | null>(null);
  const [availabilityProducts, setAvailabilityProducts] = useState<StockProduct[] | null>(null);
  const now = useAvailabilityClock();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const catalogRows = useMemo(() => products.map((product) => {
    const assignment = product.stallProducts.find((row) => row.stallId === stallId);
    return { ...product, isAssigned: Boolean(assignment), assignment: assignment ?? { stallId, isEnabled: false, isSoldOut: false, priceOverride: null, stockRemaining: null, stockVersion: 0 } };
  }), [products, stallId]);
  const assigned = catalogRows.filter((row) => row.isAssigned);
  const soldCount = assigned.filter((row) => isProductSoldOut(row.assignment, now) || row.assignment.stockRemaining === 0).length;
  const visible = catalogRows.filter((row) =>
    (!categoryId || row.categoryId === categoryId)
    && (groupId === null || (groupId === "" ? row.groupId === null : row.groupId === groupId))
    && (!soldOutOnly || isProductSoldOut(row.assignment, now) || row.assignment.stockRemaining === 0)
    && row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  ).sort((a,b) => a.sortOrder-b.sortOrder || a.name.localeCompare(b.name,"zh-TW"));
  const selectable = visible.filter((row) => row.isAssigned);
  const selectedIds = selectable.filter((row) => selected.has(row.id)).map((row) => row.id);
  const allSelected = selectable.length > 0 && selectedIds.length === selectable.length;
  const selectedCategory = categories.find((row) => row.id === categoryId);
  const selectedGroup = groups.find((row) => row.id === groupId);
  function resetSelection() { setSelected(new Set()); setMessage(""); }
  function stockRows(rows: typeof assigned) {
    return rows.map((row) => ({ productId: row.id, name: row.name, stockRemaining: row.assignment.stockRemaining, stockVersion: row.assignment.stockVersion }));
  }
  async function bulk(operation: "BULK_SOLD_OUT" | "BULK_ENABLED", value: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/products`, {
        method: "PATCH", headers: csrfHeaders(),
        body: JSON.stringify({ operation, productIds: selectedIds, ...(operation === "BULK_SOLD_OUT" ? { isSoldOut: value } : { isEnabled: value }) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "目前無法更新商品。");
      onUpdated(stallId, payload.products); setSelected(new Set());
      setMessage(`已更新 ${payload.changedCount} 項商品。庫存為 0、主檔停用或不在供應時間的商品仍無法點選。`);
    } catch(error) { setMessage(error instanceof Error ? error.message : "連線中斷，請稍後再試。"); }
    finally { setBusy(false); }
  }
  const button = "min-h-11 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold disabled:opacity-40";
  return <section aria-label="商品批次管理" className="mt-5 min-w-0">
    <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-stone-200 bg-stone-50 p-3">
      <label className="flex min-w-0 items-center gap-2 text-sm font-semibold">管理攤位
        <select aria-label="管理攤位" value={stallId} onChange={(e) => { setStallId(e.target.value); resetSelection(); }} className="h-11 min-w-0 max-w-52 rounded-md border border-stone-300 bg-white px-2">
          {stalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}</option>)}
        </select>
      </label>
      <button type="button" aria-pressed={soldOutOnly} onClick={() => { setSoldOutOnly(!soldOutOnly); setCategoryId(""); setGroupId(null); resetSelection(); }} className={button + (soldOutOnly ? " border-red-500 text-red-800" : "")}>已售完（{soldCount}）</button>
      <button type="button" disabled={!assigned.length} onClick={() => setStockProducts(stockRows(assigned))} className={button}>全部商品庫存</button>
      <input type="search" maxLength={80} aria-label="搜尋管理商品" placeholder="搜尋商品" value={search} onChange={(e) => { setSearch(e.target.value); resetSelection(); }} className="h-11 w-full rounded-md border border-stone-300 bg-white px-3 md:w-48" />
    </div>
    <p className="border-x border-stone-200 px-3 py-2 text-xs leading-5 text-stone-600">批次售完、供應與庫存僅影響上方選定攤位。編輯主檔會影響共用該商品的所有攤位。</p>
    {message ? <p role="status" className="border-x border-stone-200 bg-amber-50 p-3 text-sm">{message}</p> : null}
    <div className={`${soldOutOnly ? "grid" : "hidden md:grid"} min-w-0 border border-stone-200 md:h-[75vh] md:min-h-[32rem] md:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]`}>
      <nav aria-label="分類與群組" className="max-h-[65vh] overflow-y-auto border-b border-stone-200 bg-stone-50 p-2 md:min-h-0 md:max-h-none md:border-r md:border-b-0">
        <p className="px-2 pb-2 text-sm font-semibold text-stone-600">分類 → 群組</p>
        <button type="button" aria-pressed={!categoryId} onClick={() => { setCategoryId(""); setGroupId(null); resetSelection(); }} className={button + " w-full text-left aria-pressed:border-teal-700 aria-pressed:bg-teal-50"}>全部商品（{products.length}）</button>
        {[...categories].sort((a,b) => a.sortOrder-b.sortOrder).map((category) => {
          const categoryProducts = products.filter((row) => row.categoryId === category.id);
          const ungroupedCount = categoryProducts.filter((row) => row.groupId === null).length;
          return <div key={category.id} className="mt-4 overflow-hidden rounded-lg border border-stone-300 bg-white">
            <div className="flex items-center bg-stone-200 p-1">
              <button type="button" aria-label={`篩選分類 ${category.name}`} aria-pressed={categoryId===category.id && groupId===null} onClick={() => { setCategoryId(category.id); setGroupId(null); resetSelection(); }} className="min-h-11 min-w-0 flex-1 rounded-md px-2 py-1 text-left aria-pressed:bg-teal-700 aria-pressed:text-white">
                <span className="block text-xs">分類 · {categoryProducts.length} 項</span>
                <span className="break-words font-bold">{category.name}{!category.isActive ? "（停用）" : ""}</span>
              </button>
              <button type="button" aria-label={`編輯分類 ${category.name}`} title={`編輯分類 ${category.name}`} onClick={() => onEditCategory(category.id)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-teal-800 hover:bg-white"><Pencil aria-hidden="true" className="h-4 w-4" /></button>
            </div>
            <div className="my-2 ml-3 border-l-2 border-stone-200 pl-1">
              {groups.filter((row) => row.categoryId===category.id).sort((a,b) => a.sortOrder-b.sortOrder).map((group) => <div key={group.id} className="flex items-center">
                <button type="button" aria-label={`篩選群組 ${group.name}`} aria-pressed={categoryId===category.id && groupId===group.id} onClick={() => { setCategoryId(category.id); setGroupId(group.id); resetSelection(); }} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm aria-pressed:bg-teal-100 aria-pressed:font-bold aria-pressed:text-teal-950">
                  <Layers3 aria-hidden="true" className="h-4 w-4 shrink-0 text-teal-700" />
                  <span className="min-w-0 flex-1 break-words">{group.name}{!group.isActive ? "（停用）" : ""}<span className="block text-xs text-stone-600">群組 · {categoryProducts.filter((row) => row.groupId===group.id).length} 項</span></span>
                </button>
                <button type="button" aria-label={`編輯群組 ${group.name}`} title={`編輯群組 ${group.name}`} onClick={() => onEditGroup(group.id)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-teal-800 hover:bg-stone-100"><Pencil aria-hidden="true" className="h-4 w-4" /></button>
              </div>)}
              {ungroupedCount > 0 ? <button type="button" aria-label={`篩選未分組商品 ${category.name}`} aria-pressed={categoryId===category.id && groupId===""} onClick={() => { setCategoryId(category.id); setGroupId(""); resetSelection(); }} className="min-h-11 w-full rounded-md px-2 py-2 text-left text-sm text-stone-600 aria-pressed:bg-teal-100 aria-pressed:text-teal-950">未分組商品（{ungroupedCount}）<span className="block text-xs">系統清單</span></button> : null}
            </div>
          </div>;
        })}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="border-b border-stone-200 bg-stone-50 p-3">
          <h3 data-testid="catalog-list-heading" className="break-words font-semibold"><span className="mb-1 block text-xs text-stone-600">商品品項 · {visible.length} 項</span>{selectedCategory ? `${selectedCategory.name} / ${groupId === "" ? "未分組商品" : selectedGroup?.name ?? "全部群組"}` : "全部商品"}</h3>
          {groupId === "" ? <p className="mt-2 text-sm text-stone-600">系統清單：這些商品尚未指定群組。請編輯商品的「群組」欄位完成歸組。</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 p-3">
          <label className="flex min-h-11 items-center gap-2 text-sm"><input className="ordering-checkbox" type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((row) => row.id)) : new Set())} />全選本清單（{visible.length}）</label>
          <span className="text-sm text-stone-500">已選 {selectedIds.length} 項</span>
          <button type="button" disabled={busy || !selectedIds.length} onClick={() => setAvailabilityProducts(stockRows(visible.filter((row) => selected.has(row.id))))} className={button}>批次供應設定</button>
          <button type="button" disabled={busy || !selectedIds.length} onClick={() => void bulk("BULK_SOLD_OUT",false)} className={button}>恢復供應</button>
          <button type="button" disabled={busy || !selectedIds.length} onClick={() => setStockProducts(stockRows(visible.filter((row) => selected.has(row.id))))} className={button}>設定所選庫存</button>
        </div>
        <div className="max-h-[65vh] min-h-0 overflow-y-auto md:max-h-none md:flex-1">
          {visible.map((row) => <article key={row.id} data-testid="catalog-management-row" className="flex flex-wrap items-center gap-3 border-b border-stone-100 p-3">
            <input className="ordering-checkbox" type="checkbox" aria-label={`選取 ${row.name}`} disabled={!row.isAssigned} checked={selected.has(row.id)} onChange={(e) => setSelected((current) => { const next=new Set(current); if(e.target.checked) next.add(row.id); else next.delete(row.id); return next; })} />
            <div className="min-w-32 flex-1"><p className="text-xs text-stone-600">{categories.find((category) => category.id === row.categoryId)?.name} / {groups.find((group) => group.id === row.groupId)?.name ?? "未分組商品"}</p><h3 className="font-semibold">{row.name}</h3><p className="text-xs text-stone-500">{!row.isAssigned ? "未指派此攤位 · " : ""}{!row.isActive ? "主檔停用 · " : ""}{!row.assignment.isEnabled ? "未供應 · " : ""}{isProductSoldOut(row.assignment, now) ? "手動售完 · " : ""}{row.assignment.stockRemaining === 0 ? "庫存售完" : row.assignment.stockRemaining == null ? "不限量" : `剩餘 ${row.assignment.stockRemaining} 份`}</p></div>
            <span className="text-sm tabular-nums">{formatMoney(row.assignment.priceOverride ?? row.defaultPrice, currency, "zh-TW")}</span>
            <ProductAvailabilityButton name={row.name} assignment={row.assignment} disabled={!row.isAssigned || busy} onClick={() => setAvailabilityProducts(stockRows([row]))} />
            <button type="button" disabled={!row.isAssigned} onClick={() => setStockProducts(stockRows([row]))} className={button}>庫存</button>
            <button type="button" onClick={() => onEdit(row.id)} className={button}>編輯</button>
            <button type="button" aria-label={`更多操作 ${row.name}`} onClick={() => onMore(row.id)} className={button}>更多</button>
          </article>)}
          {!visible.length ? <p className="p-8 text-center text-stone-500">此清單沒有商品。</p> : null}
        </div>
      </div>
    </div>
    {stockProducts ? <ProductStockEditor stallId={stallId} stallName={stalls.find((row) => row.id===stallId)?.name ?? ""} products={stockProducts} onSaved={(rows) => onUpdated(stallId,rows)} onClose={() => setStockProducts(null)} /> : null}
    {availabilityProducts ? <ProductAvailabilityEditor stallId={stallId} products={availabilityProducts} onSaved={(rows) => { onUpdated(stallId, rows); resetSelection(); }} onClose={() => setAvailabilityProducts(null)} /> : null}
  </section>;
}
