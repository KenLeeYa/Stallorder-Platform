"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";

export type MerchantCategory = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type MerchantProduct = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  sortOrder: number;
  isAvailable: boolean;
};

type ProductDraft = Omit<MerchantProduct, "id"> & { id?: string };
type CategoryDraft = Omit<MerchantCategory, "id"> & { id?: string };
type PendingDelete = { kind: "product" | "category"; id: string; name: string };

type Props = {
  stall: { slug: string; currency: string };
  initialProducts: MerchantProduct[];
  initialCategories: MerchantCategory[];
};

export function MerchantCatalog({ stall, initialProducts, initialCategories }: Props) {
  const [products, setProducts] = useState(initialProducts);
  const [categories, setCategories] = useState(initialCategories);
  const [expandedCategories, setExpandedCategories] = useState(
    () => new Set(initialCategories.map((category) => category.id)),
  );
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const sortedCategories = useMemo(
    () => [...categories].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-TW")),
    [categories],
  );

  function productsInCategory(categoryId: string) {
    return products
      .filter((product) => product.categoryId === categoryId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-TW"));
  }

  async function requestCatalog(url: string, method: "POST" | "PATCH" | "DELETE", body?: object) {
    const response = await fetch(url, {
      method,
      headers: csrfHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(payload?.error ?? "目前無法更新商品資料。");
    return payload;
  }

  function startProductCreate() {
    const category = sortedCategories.find((candidate) => candidate.isActive) ?? sortedCategories[0];
    if (!category) {
      setMessage("請先建立商品分類。");
      setCategoryDraft({ name: "", sortOrder: 0, isActive: true });
      return;
    }
    setMessage("");
    setProductDraft({
      categoryId: category.id,
      name: "",
      description: "",
      price: 0,
      sortOrder: products.length + 1,
      isAvailable: true,
    });
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productDraft) return;
    const busy = productDraft.id ? `product:${productDraft.id}` : "product:new";
    setBusyKey(busy);
    setMessage("");
    try {
      const payload = await requestCatalog(
        productDraft.id
          ? `/api/stalls/${stall.slug}/products/${productDraft.id}`
          : `/api/stalls/${stall.slug}/products`,
        productDraft.id ? "PATCH" : "POST",
        {
          categoryId: productDraft.categoryId,
          name: productDraft.name,
          description: productDraft.description,
          price: productDraft.price,
          sortOrder: productDraft.sortOrder,
          isAvailable: productDraft.isAvailable,
        },
      );
      const product: MerchantProduct = payload.product;
      setProducts((current) => productDraft.id
        ? current.map((item) => item.id === product.id ? product : item)
        : [...current, product]);
      setExpandedCategories((current) => new Set(current).add(product.categoryId));
      setProductDraft(null);
      setMessage(productDraft.id ? "商品已更新。" : "商品已新增。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleAvailability(product: MerchantProduct) {
    const busy = `product:${product.id}`;
    setBusyKey(busy);
    setMessage("");
    try {
      const payload = await requestCatalog(
        `/api/stalls/${stall.slug}/products/${product.id}`,
        "PATCH",
        { isAvailable: !product.isAvailable },
      );
      setProducts((current) => current.map((item) => item.id === product.id ? payload.product : item));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryDraft) return;
    const busy = categoryDraft.id ? `category:${categoryDraft.id}` : "category:new";
    setBusyKey(busy);
    setMessage("");
    try {
      const payload = await requestCatalog(
        categoryDraft.id
          ? `/api/stalls/${stall.slug}/categories/${categoryDraft.id}`
          : `/api/stalls/${stall.slug}/categories`,
        categoryDraft.id ? "PATCH" : "POST",
        {
          name: categoryDraft.name,
          sortOrder: categoryDraft.sortOrder,
          isActive: categoryDraft.isActive,
        },
      );
      const category: MerchantCategory = payload.category;
      setCategories((current) => categoryDraft.id
        ? current.map((item) => item.id === category.id ? category : item)
        : [...current, category]);
      setExpandedCategories((current) => new Set(current).add(category.id));
      setCategoryDraft(null);
      setMessage(categoryDraft.id ? "分類已更新。" : "分類已新增。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const busy = `${pendingDelete.kind}:${pendingDelete.id}`;
    setBusyKey(busy);
    setMessage("");
    try {
      await requestCatalog(
        `/api/stalls/${stall.slug}/${pendingDelete.kind === "product" ? "products" : "categories"}/${pendingDelete.id}`,
        "DELETE",
      );
      if (pendingDelete.kind === "product") {
        setProducts((current) => current.filter((product) => product.id !== pendingDelete.id));
      } else {
        setCategories((current) => current.filter((category) => category.id !== pendingDelete.id));
      }
      setPendingDelete(null);
      setMessage(pendingDelete.kind === "product" ? "商品已刪除。" : "分類已刪除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setBusyKey(null);
    }
  }

  function toggleCategory(categoryId: string) {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  return (
    <section aria-labelledby="catalog-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="catalog-heading" className="text-2xl font-semibold">商品供應</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoryDraft({ name: "", sortOrder: categories.length + 1, isActive: true })}
            className="inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold hover:bg-stone-100"
          >
            <Plus className="h-4 w-4" />新增分類
          </button>
          <button
            type="button"
            onClick={startProductCreate}
            className="inline-flex items-center gap-2 rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-800"
          >
            <Plus className="h-4 w-4" />新增商品
          </button>
        </div>
      </div>
      {message ? <p role="alert" className="mt-3 text-sm text-stone-700">{message}</p> : null}

      <div className="mt-5 border-y border-stone-200">
        {sortedCategories.map((category) => {
          const categoryProducts = productsInCategory(category.id);
          const expanded = expandedCategories.has(category.id);
          return (
            <section key={category.id} className="border-b border-stone-200 last:border-b-0">
              <div className="flex min-h-14 items-center gap-1">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggleCategory(category.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-3 text-left hover:bg-stone-50"
                >
                  {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <span className="truncate font-semibold">{category.name}</span>
                  {!category.isActive ? <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600">已停用</span> : null}
                  <span className="ml-auto shrink-0 text-xs text-stone-500">{categoryProducts.length} 品項</span>
                </button>
                <button
                  type="button"
                  title="編輯分類"
                  onClick={() => setCategoryDraft({ ...category })}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-stone-600 hover:bg-stone-100"
                >
                  <Pencil className="h-4 w-4" /><span className="sr-only">編輯 {category.name}</span>
                </button>
                <button
                  type="button"
                  title={categoryProducts.length > 0 ? "分類內仍有商品" : "刪除分類"}
                  disabled={categoryProducts.length > 0}
                  onClick={() => setPendingDelete({ kind: "category", id: category.id, name: category.name })}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" /><span className="sr-only">刪除 {category.name}</span>
                </button>
              </div>

              {expanded ? (
                <div className="divide-y divide-stone-100 border-t border-stone-100 bg-white">
                  {categoryProducts.map((product) => (
                    <div key={product.id} className="grid gap-3 px-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold">{product.name}</h3>
                        {product.description ? <p className="mt-1 line-clamp-2 text-sm text-stone-600">{product.description}</p> : null}
                        <p className="mt-2 text-sm font-semibold">{formatMoney(product.price, stall.currency)}</p>
                      </div>
                      <div className="flex items-center gap-1 sm:justify-end">
                        <button
                          type="button"
                          role="switch"
                          aria-label={`${product.name}供應狀態`}
                          aria-checked={product.isAvailable}
                          disabled={busyKey === `product:${product.id}`}
                          onClick={() => void toggleAvailability(product)}
                          className={`inline-flex h-10 min-w-24 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-50 ${product.isAvailable ? "border border-stone-300" : "bg-stone-900 text-white"}`}
                        >
                          {product.isAvailable ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          {product.isAvailable ? "供應中" : "已售完"}
                        </button>
                        <button
                          type="button"
                          title="編輯商品"
                          onClick={() => setProductDraft({ ...product })}
                          className="grid h-10 w-10 place-items-center rounded-md text-stone-600 hover:bg-stone-100"
                        >
                          <Pencil className="h-4 w-4" /><span className="sr-only">編輯 {product.name}</span>
                        </button>
                        <button
                          type="button"
                          title="刪除商品"
                          onClick={() => setPendingDelete({ kind: "product", id: product.id, name: product.name })}
                          className="grid h-10 w-10 place-items-center rounded-md text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" /><span className="sr-only">刪除 {product.name}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                  {categoryProducts.length === 0 ? <p className="px-3 py-5 text-sm text-stone-500">此分類尚無商品。</p> : null}
                </div>
              ) : null}
            </section>
          );
        })}
        {sortedCategories.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">尚未建立商品分類。</p> : null}
      </div>

      {productDraft ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4">
          <form onSubmit={saveProduct} role="dialog" aria-modal="true" aria-labelledby="product-editor-title" className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 id="product-editor-title" className="text-lg font-semibold">{productDraft.id ? "編輯商品" : "新增商品"}</h2>
              <button type="button" title="關閉" onClick={() => setProductDraft(null)} className="grid h-9 w-9 place-items-center rounded-md hover:bg-stone-100"><X className="h-4 w-4" /><span className="sr-only">關閉</span></button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-stone-700 sm:col-span-2">商品名稱<input required maxLength={80} value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-stone-700">分類<select required value={productDraft.categoryId} onChange={(event) => setProductDraft({ ...productDraft, categoryId: event.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2">{sortedCategories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.isActive ? "" : "（已停用）"}</option>)}</select></label>
              <label className="text-sm font-medium text-stone-700">售價<input required type="number" min={0} max={10_000_000} value={productDraft.price} onChange={(event) => setProductDraft({ ...productDraft, price: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-stone-700 sm:col-span-2">商品描述<textarea maxLength={500} rows={3} value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} className="mt-1 w-full resize-y rounded-md border border-stone-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-stone-700">排序<input required type="number" min={0} max={10_000} value={productDraft.sortOrder} onChange={(event) => setProductDraft({ ...productDraft, sortOrder: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>
              <label className="flex items-center gap-2 self-end py-2 text-sm font-medium text-stone-700"><input type="checkbox" checked={productDraft.isAvailable} onChange={(event) => setProductDraft({ ...productDraft, isAvailable: event.target.checked })} className="h-4 w-4" />供應中</label>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setProductDraft(null)} className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold hover:bg-stone-100">取消</button>
              <button disabled={busyKey !== null} type="submit" className="inline-flex items-center justify-center gap-2 rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存商品</button>
            </div>
          </form>
        </div>
      ) : null}

      {categoryDraft ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <form onSubmit={saveCategory} role="dialog" aria-modal="true" aria-labelledby="category-editor-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 id="category-editor-title" className="text-lg font-semibold">{categoryDraft.id ? "編輯分類" : "新增分類"}</h2>
              <button type="button" title="關閉" onClick={() => setCategoryDraft(null)} className="grid h-9 w-9 place-items-center rounded-md hover:bg-stone-100"><X className="h-4 w-4" /><span className="sr-only">關閉</span></button>
            </div>
            <div className="mt-4 grid gap-4">
              <label className="text-sm font-medium text-stone-700">分類名稱<input required maxLength={50} value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-stone-700">排序<input required type="number" min={0} max={10_000} value={categoryDraft.sortOrder} onChange={(event) => setCategoryDraft({ ...categoryDraft, sortOrder: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>
              <label className="flex items-center gap-2 text-sm font-medium text-stone-700"><input type="checkbox" checked={categoryDraft.isActive} onChange={(event) => setCategoryDraft({ ...categoryDraft, isActive: event.target.checked })} className="h-4 w-4" />啟用分類</label>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setCategoryDraft(null)} className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold hover:bg-stone-100">取消</button>
              <button disabled={busyKey !== null} type="submit" className="inline-flex items-center justify-center gap-2 rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存分類</button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="catalog-delete-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-700"><TriangleAlert className="h-5 w-5" /></span>
              <div className="min-w-0"><h2 id="catalog-delete-title" className="text-lg font-semibold">確認刪除{pendingDelete.kind === "product" ? "商品" : "分類"}？</h2><p className="mt-1 break-words text-sm font-medium text-stone-800">{pendingDelete.name}</p></div>
            </div>
            <p className="mt-4 text-sm leading-6 text-stone-600">刪除後無法恢復，歷史訂單內容不會受影響。</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" autoFocus disabled={busyKey !== null} onClick={() => setPendingDelete(null)} className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold hover:bg-stone-100 disabled:opacity-50">返回</button>
              <button type="button" disabled={busyKey !== null} onClick={() => void confirmDelete()} className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">確認刪除</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
