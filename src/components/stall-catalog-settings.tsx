"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, Save } from "lucide-react";
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
  masterIsActive: boolean;
};

export function StallCatalogSettings({
  stallId,
  currency,
  initialProducts,
}: {
  stallId: string;
  currency: string;
  initialProducts: StallCatalogProduct[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const categories = useMemo(
    () => [...new Set(products.map((product) => product.categoryName))],
    [products],
  );

  function update(productId: string, changes: Partial<StallCatalogProduct>) {
    setProducts((current) => current.map((product) => product.productId === productId
      ? {
        ...product,
        ...changes,
        effectivePrice: effectiveProductPrice(
          product.defaultPrice,
          changes.priceOverride === undefined ? product.priceOverride : changes.priceOverride,
        ),
      }
      : product));
  }

  async function save(product: StallCatalogProduct) {
    setBusyId(product.productId);
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

  return (
    <section aria-labelledby="stall-products-heading">
      <div className="border-b border-stone-200 pb-4">
        <p className="text-sm font-semibold text-teal-800">攤位商品設定</p>
        <h2 id="stall-products-heading" className="mt-1 text-2xl font-semibold">供應與價格</h2>
        <p className="mt-2 text-sm text-stone-600">價格留空時使用組織主檔預設售價；售罄商品不會出現在顧客菜單。</p>
      </div>
      {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
      <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
        {categories.map((category) => (
          <details key={category} open className="py-1">
            <summary className="min-h-12 cursor-pointer py-3 font-semibold">{category}</summary>
            <div className="divide-y divide-stone-100 pb-3">
              {products.filter((product) => product.categoryName === category).map((product) => (
                <div key={product.productId} className="grid gap-3 py-4 lg:grid-cols-[minmax(180px,1fr)_150px_90px_auto] lg:items-end">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{product.name}</h3>
                      {product.groupName ? <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{product.groupName}</span> : null}
                      {!product.masterIsActive ? <span className="text-xs font-semibold text-red-700">主檔已停用</span> : null}
                    </div>
                    <p className="mt-1 text-sm text-stone-600">預設 {formatMoney(product.defaultPrice, currency)} · 目前 {formatMoney(product.effectivePrice, currency)}</p>
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
                    <button type="button" title={`儲存 ${product.name}`} disabled={busyId !== null} onClick={() => void save(product)} className="grid h-10 w-10 place-items-center rounded-md bg-teal-700 text-white disabled:opacity-50"><Save className="h-4 w-4" /><span className="sr-only">儲存 {product.name}</span></button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
        {products.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">組織尚未分派商品至此攤位。</p> : null}
      </div>
    </section>
  );
}
