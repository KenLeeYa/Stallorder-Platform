"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, Copy, Eye, EyeOff, PackageCheck, PackageX, Save } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";
import { effectiveProductPrice } from "@/lib/shared-catalog";

export type StallCatalogProduct = {
  id: string;
  productId: string;
  categoryName: string;
  groupName: string | null;
  name: string;
  description: string;
  defaultPrice: number;
  priceOverride: number | null;
  effectivePrice: number;
  isEnabled: boolean;
  isSoldOut: boolean;
  sortOrder: number;
  availableFrom: string | null;
  availableUntil: string | null;
  masterIsActive: boolean;
};

export function StallCatalogSettings({
  stallId,
  currency,
  initialProducts,
  sourceStalls,
}: {
  stallId: string;
  currency: string;
  initialProducts: StallCatalogProduct[];
  sourceStalls: Array<{ id: string; name: string; code: string }>;
}) {
  const [products, setProducts] = useState(initialProducts);
  const productsRef = useRef(initialProducts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [sourceStallId, setSourceStallId] = useState(sourceStalls[0]?.id ?? "");
  const categories = useMemo(
    () => [...new Set(products.map((product) => product.categoryName))],
    [products],
  );
  const allSelected = products.length > 0 && products.every((product) => selectedProductIds.has(product.productId));

  function update(productId: string, changes: Partial<StallCatalogProduct>) {
    const nextProducts = productsRef.current.map((product) => product.productId === productId
      ? {
        ...product,
        ...changes,
        effectivePrice: effectiveProductPrice(
          product.defaultPrice,
          changes.priceOverride === undefined ? product.priceOverride : changes.priceOverride,
        ),
      }
      : product);
    productsRef.current = nextProducts;
    setProducts(nextProducts);
  }

  async function save(productId: string) {
    const product = productsRef.current.find((candidate) => candidate.productId === productId);
    if (!product) return;
    setBusyId(productId);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/products/${product.productId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({
          priceOverride: product.priceOverride,
          isEnabled: product.isEnabled,
          isSoldOut: product.isSoldOut,
          sortOrder: product.sortOrder,
          availableFrom: product.availableFrom,
          availableUntil: product.availableUntil,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新攤位商品。");
      update(product.productId, payload.stallProduct);
      setMessage(`「${product.name}」設定已儲存。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setBusyId(null);
    }
  }

  async function runBulk(command: Record<string, unknown>, successMessage: string) {
    setBusyId("BULK");
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/products`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法批次更新商品。");
      const nextProducts = payload.products as StallCatalogProduct[];
      productsRef.current = nextProducts;
      setProducts(nextProducts);
      setSelectedProductIds(new Set());
      setMessage(`${successMessage}（${payload.changedCount} 項）`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setBusyId(null);
    }
  }

  async function copyFromStall() {
    const source = sourceStalls.find((stall) => stall.id === sourceStallId);
    if (!source || !window.confirm(`將「${source.name}」的供應、價格、售完與排程設定合併到目前攤位？目前攤位額外商品不會被刪除。`)) return;
    await runBulk({ operation: "COPY_FROM_STALL", sourceStallId }, `已合併 ${source.name} 的商品設定`);
  }

  return (
    <section aria-labelledby="stall-products-heading">
      <div className="border-b border-stone-200 pb-4">
        <p className="text-sm font-semibold text-teal-800">攤位商品設定</p>
        <h2 id="stall-products-heading" className="mt-1 text-2xl font-semibold">供應與價格</h2>
        <p className="mt-2 text-sm text-stone-600">價格留空時使用組織主檔預設售價；售罄商品不會出現在顧客菜單。</p>
      </div>
      <div className="flex flex-col gap-3 border-b border-stone-200 py-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={allSelected} onChange={(event) => setSelectedProductIds(event.target.checked ? new Set(products.map((product) => product.productId)) : new Set())} />全選商品</label>
          <button type="button" disabled={selectedProductIds.size === 0 || busyId !== null} onClick={() => void runBulk({ operation: "BULK_SOLD_OUT", productIds: [...selectedProductIds], isSoldOut: true }, "已批次標記售完")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800 disabled:opacity-40"><PackageX className="h-4 w-4" />批次售完</button>
          <button type="button" disabled={selectedProductIds.size === 0 || busyId !== null} onClick={() => void runBulk({ operation: "BULK_SOLD_OUT", productIds: [...selectedProductIds], isSoldOut: false }, "已批次恢復供應")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-400 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-40"><PackageCheck className="h-4 w-4" />恢復供應</button>
        </div>
        {sourceStalls.length > 0 ? <div className="flex min-w-0 flex-wrap items-end gap-2"><label className="text-xs font-semibold text-stone-600">複製其他攤位設定<select value={sourceStallId} onChange={(event) => setSourceStallId(event.target.value)} className="mt-1 block h-10 max-w-56 rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900">{sourceStalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}（{stall.code}）</option>)}</select></label><button type="button" disabled={busyId !== null || !sourceStallId} onClick={() => void copyFromStall()} className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-40"><Copy className="h-4 w-4" />合併設定</button></div> : null}
      </div>
      {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
      <details open data-stall-product-list className="group mt-4">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 border-y border-stone-200 py-3 font-semibold hover:text-teal-800 [&::-webkit-details-marker]:hidden">
          <span>商品列表（{products.length}）</span>
          <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="divide-y divide-stone-200 border-b border-stone-200">
          {categories.map((category) => (
            <details key={category} open className="py-1">
              <summary className="min-h-12 cursor-pointer py-3 font-semibold">{category}</summary>
              <div className="divide-y divide-stone-100 pb-3">
                {products.filter((product) => product.categoryName === category).map((product) => (
                <div key={product.productId} className="grid gap-3 py-4 lg:grid-cols-[minmax(180px,1fr)_150px_90px_auto] lg:items-end">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="checkbox" aria-label={`選取 ${product.name}`} checked={selectedProductIds.has(product.productId)} onChange={(event) => setSelectedProductIds((current) => { const next = new Set(current); if (event.target.checked) next.add(product.productId); else next.delete(product.productId); return next; })} />
                      <h3 className="font-semibold">{product.name}</h3>
                      {product.groupName ? <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{product.groupName}</span> : null}
                      {!product.masterIsActive ? <span className="text-xs font-semibold text-red-700">主檔已停用</span> : null}
                    </div>
                    <p className="mt-1 text-sm text-stone-600">預設 {formatMoney(product.defaultPrice, currency)} · 目前 {formatMoney(product.effectivePrice, currency)}</p>
                    <p className="mt-1 text-xs font-medium text-stone-500">{availabilityLabel(product.availableFrom, product.availableUntil)}</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="text-xs font-medium text-stone-600">供應開始<input type="datetime-local" value={toDateTimeLocal(product.availableFrom)} onChange={(event) => update(product.productId, { availableFrom: toIsoDateTime(event.target.value) })} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-2 text-sm" /></label>
                      <label className="text-xs font-medium text-stone-600">供應結束<input type="datetime-local" value={toDateTimeLocal(product.availableUntil)} onChange={(event) => update(product.productId, { availableUntil: toIsoDateTime(event.target.value) })} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-2 text-sm" /></label>
                    </div>
                  </div>
                  <label className="text-sm font-medium text-stone-700">覆寫價格
                    <input
                      type="number"
                      min={0}
                      max={10_000_000}
                      placeholder="使用預設"
                      value={product.priceOverride ?? ""}
                      onChange={(event) => update(product.productId, { priceOverride: event.target.value === "" ? null : Number(event.target.value) })}
                      className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm font-medium text-stone-700">排序
                    <input type="number" min={0} max={10_000} value={product.sortOrder} onChange={(event) => update(product.productId, { sortOrder: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
                  </label>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <button type="button" role="switch" aria-checked={product.isEnabled} onClick={() => update(product.productId, { isEnabled: !product.isEnabled })} className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold ${product.isEnabled ? "border border-stone-300" : "bg-stone-900 text-white"}`}>{product.isEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}{product.isEnabled ? "已啟用" : "已停用"}</button>
                    <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-red-800"><input type="checkbox" checked={product.isSoldOut} onChange={(event) => update(product.productId, { isSoldOut: event.target.checked })} />售罄</label>
                    <button type="button" title={`儲存 ${product.name}`} disabled={busyId !== null} onClick={() => void save(product.productId)} className="grid h-10 w-10 place-items-center rounded-md bg-teal-700 text-white disabled:opacity-50"><Save className="h-4 w-4" /><span className="sr-only">儲存 {product.name}</span></button>
                  </div>
                </div>
                ))}
              </div>
            </details>
          ))}
          {products.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">組織尚未分派商品至此攤位。</p> : null}
        </div>
      </details>
    </section>
  );
}

function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function availabilityLabel(availableFrom: string | null, availableUntil: string | null) {
  if (!availableFrom && !availableUntil) return "無供應排程限制";
  const now = Date.now();
  const starts = availableFrom ? new Date(availableFrom).getTime() : null;
  const ends = availableUntil ? new Date(availableUntil).getTime() : null;
  if (starts !== null && starts > now) return `排程於 ${new Date(starts).toLocaleString("zh-TW")} 開始供應`;
  if (ends !== null && ends <= now) return `排程已於 ${new Date(ends).toLocaleString("zh-TW")} 結束`;
  if (ends !== null) return `供應至 ${new Date(ends).toLocaleString("zh-TW")}`;
  return `自 ${new Date(starts!).toLocaleString("zh-TW")} 起供應`;
}
